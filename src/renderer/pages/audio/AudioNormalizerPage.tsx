import React from 'react';
import {
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useTranslation } from 'react-i18next';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import PathField from '../../components/common/PathField';
import ProgressDialog from '../../components/common/ProgressDialog';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import Panel from '../../components/common/Panel';
import { showNotice } from '../../stores/noticeStore';
import { useAudioStore } from '../../stores/audioStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { AudioNormalizeItem, AudioNormalizerSettings, BitrateMode, JobEvent } from '@shared/types';

// ドラッグ&ドロップで受け付ける拡張子。ffmpeg が扱える音声形式を広めに許可し、
// 実際に正規化できるかどうかの判定は main 側のコーデック判定に委ねる
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'aac', 'flac', 'm4a', 'mp4', 'ogg', 'oga', 'opus', 'aif', 'aiff', 'wma'];
const AUDIO_FILTERS = [
    { name: 'Audio Files', extensions: AUDIO_EXTENSIONS },
    { name: 'All Files', extensions: ['*'] },
];
// loudnorm の I パラメータが受け付ける範囲
const TARGET_LUFS_MIN = -70;
const TARGET_LUFS_MAX = -5;
// ファイル一覧の列。全ての行を 1 行の高さに揃えるため、折り返しは行わない
const NO_WRAP_CELL_SX = { whiteSpace: 'nowrap' } as const;
// 収まらない文字列は末尾を省略する (全文は title 属性で表示する)
const ELLIPSIS_CELL_SX = { ...NO_WRAP_CELL_SX, overflow: 'hidden', textOverflow: 'ellipsis' } as const;
const CHANNELS_WIDTH = 112;
const LUFS_WIDTH = 88;
const SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const BITRATES = [320, 256, 224, 192, 160, 144, 128, 112, 96, 80, 64, 56, 48, 40, 32, 24, 16, 8];

type RunningJob = {
    jobId: string;
    kind: 'analyze' | 'normalize';
    percent?: number;
    current?: number;
    total?: number;
    message?: string;
};

// 入力文字列が loudnorm に渡せるターゲット LUFS かどうかを判定する
function isValidTargetLufs(text: string): boolean {
    if (text.trim() === '') return false;
    const value = Number(text);
    return Number.isFinite(value) && value >= TARGET_LUFS_MIN && value <= TARGET_LUFS_MAX;
}

function splitPath(filePath: string): { name: string; dir: string } {
    const separator = filePath.includes('\\') ? '\\' : '/';
    const index = filePath.lastIndexOf(separator);
    if (index < 0) return { name: filePath, dir: '' };
    return { name: filePath.slice(index + 1), dir: filePath.slice(0, index) };
}

export default function AudioNormalizerPage() {
    const { t } = useTranslation();
    const { files, addFiles, clearFiles, applyAnalysis } = useAudioStore();
    const { settings, update } = useSettingsStore();
    const [job, setJob] = React.useState<RunningJob | null>(null);
    const [result, setResult] = React.useState<{
        ok: number;
        failed: number;
        skipped: number;
        details: AudioNormalizeItem[];
    } | null>(null);
    // 入力途中の文字列を保持する (空文字や "-" だけの状態を設定値にしないため)
    const [lufsText, setLufsText] = React.useState<string | null>(null);
    // 出力設定は画面上で編集し、解析・正規化を実行したときにまとめて保存する
    const [draft, setDraft] = React.useState<AudioNormalizerSettings | null>(null);
    // 上書きになる出力パスの一覧 (null = 確認ダイアログを出さない)
    const [overwriteTargets, setOverwriteTargets] = React.useState<string[] | null>(null);

    // 設定の読み込みが終わったら編集用の値へ一度だけ取り込む
    React.useEffect(() => {
        setDraft(previous => previous ?? settings?.audioNormalizer ?? null);
    }, [settings]);

    // ジョブイベント購読
    const activeJobId = job?.jobId;
    React.useEffect(() => {
        if (!activeJobId) return;
        const unsubscribe = window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== activeJobId || event.kind !== 'progress') return;
            setJob(previous =>
                previous && previous.jobId === event.jobId
                    ? {
                          ...previous,
                          percent: event.percent ?? previous.percent,
                          current: event.current ?? previous.current,
                          total: event.total ?? previous.total,
                          message: event.message ?? previous.message,
                      }
                    : previous
            );
        });
        return unsubscribe;
    }, [activeJobId]);

    if (!settings || !draft) return null;
    const audioSettings = draft;

    const patchSettings = (patch: Partial<AudioNormalizerSettings>) => {
        setDraft(previous => (previous ? { ...previous, ...patch } : previous));
    };

    // 保存済みの内容と違う場合だけ設定ファイルへ書き戻す (解析・正規化の実行時に呼ぶ)
    const persistSettings = async () => {
        const saved = settings.audioNormalizer;
        const changed = (Object.keys(audioSettings) as (keyof AudioNormalizerSettings)[]).some(
            key => audioSettings[key] !== saved[key]
        );
        if (changed) await update({ audioNormalizer: audioSettings });
    };

    const formatChannels = (channels: number | null): string => {
        if (channels === null) return '';
        if (channels === 1) return t('audioPage.mono');
        if (channels === 2) return t('audioPage.stereo');
        return t('audioPage.channelsN', { count: channels });
    };

    // ファイル・ディレクトリのどちらを渡されても、対象の音声ファイルへ展開してから一覧へ追加する
    const addPaths = async (paths: string[]) => {
        if (paths.length === 0) return;
        try {
            const collected = await window.kuraToolkit.files.collect(paths, AUDIO_EXTENSIONS);
            if (collected.length === 0) {
                showNotice('warning', t('audioPage.noAudioFiles'));
                return;
            }
            addFiles(collected);
        } catch (error) {
            showNotice('warning', formatError(error));
        }
    };

    const handleAddClick = async () => {
        const paths = await window.kuraToolkit.dialog.openFiles({ filters: AUDIO_FILTERS, multi: true });
        await addPaths(paths);
    };

    const handleAddDirectoryClick = async () => {
        const selected = await window.kuraToolkit.dialog.openDirectory();
        if (selected) await addPaths([selected]);
    };

    const runAnalyze = async () => {
        if (files.length === 0) {
            showNotice('warning', t('audioPage.needFiles'));
            return;
        }
        await persistSettings();
        const jobId = crypto.randomUUID();
        setJob({ jobId, kind: 'analyze' });
        try {
            const analyzeResult = await window.kuraToolkit.audio.analyze(
                jobId,
                files.map(file => file.path)
            );
            // 中断時も解析できた分は反映し、中断したことを伝える
            applyAnalysis(analyzeResult.items);
            if (analyzeResult.cancelled) {
                showNotice('warning', t('audioPage.cancelled'));
            }
        } catch (error) {
            showNotice('warning', formatError(error));
        } finally {
            setJob(null);
        }
    };

    const runNormalize = async () => {
        if (files.length === 0) {
            showNotice('warning', t('audioPage.needFiles'));
            return;
        }
        if (!isValidTargetLufs(String(audioSettings.targetLufs))) {
            showNotice('warning', t('audioPage.invalidTargetLufs'));
            return;
        }
        let check;
        try {
            check = await window.kuraToolkit.audio.checkOutputs(
                files.map(file => file.path),
                audioSettings.outputDir
            );
        } catch (error) {
            showNotice('warning', formatError(error));
            return;
        }
        // 出力パスが重なる指定 (別ディレクトリの同名ファイルを 1 か所へ出す) は
        // どう実行しても互いを上書きしてしまうため、確認ではなく実行そのものを止める
        if (check.duplicated.length > 0) {
            showNotice('warning', t('audioPage.duplicateOutputs'));
            return;
        }
        // 既存のファイルを上書きする場合は、取り消せないため実行前に確認する
        // (出力先が空欄のときは入力と同じ場所へ出力するので、必ず元のファイルが対象になる)
        if (check.existing.length > 0) {
            setOverwriteTargets(check.existing);
            return;
        }
        await startNormalize();
    };

    const startNormalize = async () => {
        await persistSettings();
        const jobId = crypto.randomUUID();
        setJob({ jobId, kind: 'normalize' });
        try {
            const normalizeResult = await window.kuraToolkit.audio.normalize(
                jobId,
                files.map(file => file.path),
                audioSettings
            );
            const ok = normalizeResult.items.filter(item => item.ok).length;
            const skipped = normalizeResult.items.filter(item => item.skipped).length;
            // 中断されたファイルはエラーを持たないため、失敗には数えない
            const details = normalizeResult.items.filter(item => !item.ok && item.error);
            setResult({ ok, failed: details.length - skipped, skipped, details });
            if (normalizeResult.cancelled) {
                showNotice('warning', t('audioPage.cancelled'));
            }
        } catch (error) {
            showNotice('warning', formatError(error));
        } finally {
            setJob(null);
        }
    };

    const formatError = (error: unknown): string => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('FFMPEG_NOT_FOUND')) return t('common.ffmpegNotFound');
        if (message.includes('FFPROBE_NOT_FOUND')) return t('common.ffprobeNotFound');
        if (message.includes('DUPLICATE_OUTPUTS')) return t('audioPage.duplicateOutputs');
        return message;
    };

    return (
        <PageContainer>
            <Stack direction='row' spacing={1} sx={{ flexShrink: 0 }}>
                <Button variant='outlined' startIcon={<AddIcon />} onClick={handleAddClick}>
                    {t('audioPage.addFiles')}
                </Button>
                <Button variant='outlined' startIcon={<CreateNewFolderIcon />} onClick={handleAddDirectoryClick}>
                    {t('audioPage.addDirectory')}
                </Button>
                <Button variant='outlined' startIcon={<DeleteSweepIcon />} onClick={clearFiles}>
                    {t('audioPage.clearList')}
                </Button>
            </Stack>

            {files.length === 0 ? (
                <FileDropZone
                    onFiles={addPaths}
                    filters={AUDIO_FILTERS}
                    accept={AUDIO_EXTENSIONS}
                    allowDirectories
                    multiple
                    hint={t('audioPage.dropHint')}
                    // 上下のボタン列と出力設定を固定し、残りの高さを埋める
                    sx={{ flexGrow: 1, flexBasis: 0, minHeight: 180 }}
                />
            ) : (
                <FileDropZone
                    onFiles={addPaths}
                    filters={AUDIO_FILTERS}
                    accept={AUDIO_EXTENSIONS}
                    allowDirectories
                    multiple
                    // 残りの高さを埋め、あふれた分は一覧の内部でスクロールさせる
                    sx={{
                        flexGrow: 1,
                        flexBasis: 0,
                        minHeight: 180,
                        alignItems: 'stretch',
                        cursor: 'default',
                        p: 0,
                        border: 1,
                        borderStyle: 'solid',
                        overflow: 'hidden',
                    }}
                >
                    <TableContainer
                        sx={{ height: '100%', width: '100%', overflow: 'auto' }}
                        onClick={event => event.stopPropagation()}
                    >
                        {/* 列幅を固定し、全ての行を 1 行の高さに揃える */}
                        <Table size='small' stickyHeader sx={{ tableLayout: 'fixed' }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={ELLIPSIS_CELL_SX}>{t('audioPage.colFile')}</TableCell>
                                    <TableCell sx={{ ...ELLIPSIS_CELL_SX, width: '40%' }}>
                                        {t('audioPage.colDir')}
                                    </TableCell>
                                    <TableCell align='center' sx={{ ...NO_WRAP_CELL_SX, width: CHANNELS_WIDTH }}>
                                        {t('audioPage.colChannels')}
                                    </TableCell>
                                    <TableCell align='right' sx={{ ...NO_WRAP_CELL_SX, width: LUFS_WIDTH }}>
                                        {t('audioPage.colLufs')}
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {files.map(file => {
                                    const { name, dir } = splitPath(file.path);
                                    return (
                                        <TableRow key={file.path} hover>
                                            <TableCell sx={ELLIPSIS_CELL_SX} title={name}>
                                                {name}
                                            </TableCell>
                                            <TableCell sx={ELLIPSIS_CELL_SX} title={dir}>
                                                {dir}
                                            </TableCell>
                                            <TableCell align='center' sx={NO_WRAP_CELL_SX}>
                                                {formatChannels(file.channels)}
                                            </TableCell>
                                            <TableCell align='right' sx={NO_WRAP_CELL_SX}>
                                                {file.lufs !== null ? file.lufs.toFixed(1) : file.error ? '!' : ''}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </FileDropZone>
            )}

            <Stack direction='row' spacing={1} sx={{ flexShrink: 0 }}>
                <Button variant='contained' fullWidth onClick={runAnalyze} disabled={job !== null}>
                    {t('audioPage.analyze')}
                </Button>
                <Button variant='contained' fullWidth onClick={runNormalize} disabled={job !== null}>
                    {t('audioPage.normalize')}
                </Button>
            </Stack>

            <Box sx={{ flexShrink: 0 }}>
                <SectionLabel>{t('audioPage.outputSection')}</SectionLabel>
                <Panel>
                    <Stack spacing={2}>
                        <PathField
                            label={t('audioPage.outputDir')}
                            value={audioSettings.outputDir}
                            onChange={value => patchSettings({ outputDir: value })}
                            onBrowse={() =>
                                window.kuraToolkit.dialog.openDirectory({
                                    defaultPath: audioSettings.outputDir || undefined,
                                })
                            }
                        />
                        {/* 注釈は入力欄の続きとして読ませたいため、同じ枠に入れて間隔を詰める */}
                        <Box>
                            <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                                <TextField
                                    size='small'
                                    label={t('audioPage.targetLufs')}
                                    value={lufsText ?? String(audioSettings.targetLufs)}
                                    sx={{ width: 160 }}
                                    error={!isValidTargetLufs(lufsText ?? String(audioSettings.targetLufs))}
                                    helperText={t('audioPage.targetLufsRange', {
                                        min: TARGET_LUFS_MIN,
                                        max: TARGET_LUFS_MAX,
                                    })}
                                    onChange={event => {
                                        const text = event.target.value;
                                        setLufsText(text);
                                        // 有効な範囲の数値になったときだけ設定値へ反映する
                                        if (isValidTargetLufs(text)) {
                                            patchSettings({ targetLufs: Number(text) });
                                        }
                                    }}
                                />
                                <FormControl size='small' sx={{ width: 180 }}>
                                    <InputLabel id='sample-rate-label'>{t('audioPage.sampleRate')}</InputLabel>
                                    <Select
                                        labelId='sample-rate-label'
                                        label={t('audioPage.sampleRate')}
                                        value={audioSettings.sampleRate}
                                        onChange={event => patchSettings({ sampleRate: Number(event.target.value) })}
                                    >
                                        {SAMPLE_RATES.map(rate => (
                                            <MenuItem key={rate} value={rate}>
                                                {rate} Hz
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size='small' sx={{ width: 160 }}>
                                    <InputLabel id='bitrate-mode-label'>{t('audioPage.bitrateMode')}</InputLabel>
                                    <Select
                                        labelId='bitrate-mode-label'
                                        label={t('audioPage.bitrateMode')}
                                        value={audioSettings.bitrateMode}
                                        onChange={event =>
                                            patchSettings({ bitrateMode: event.target.value as BitrateMode })
                                        }
                                    >
                                        <MenuItem value='cbr'>CBR</MenuItem>
                                        <MenuItem value='vbr'>VBR</MenuItem>
                                    </Select>
                                </FormControl>
                                <FormControl size='small' sx={{ width: 160 }}>
                                    <InputLabel id='bitrate-label'>{t('audioPage.bitrate')}</InputLabel>
                                    <Select
                                        labelId='bitrate-label'
                                        label={t('audioPage.bitrate')}
                                        value={audioSettings.bitrate}
                                        onChange={event => patchSettings({ bitrate: Number(event.target.value) })}
                                    >
                                        {BITRATES.map(bitrate => (
                                            <MenuItem key={bitrate} value={bitrate}>
                                                {bitrate} kbps
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Stack>
                            {/* ターゲット LUFS は値の大小と音量の関係が直感に反するため、目安を注釈で示す */}
                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t('audioPage.targetLufsNote')}
                            </Typography>
                        </Box>
                    </Stack>
                </Panel>
            </Box>

            <ProgressDialog
                open={job !== null}
                title={job?.kind === 'analyze' ? t('audioPage.analyzing') : t('audioPage.normalizing')}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                message={job?.message ?? ''}
                onCancel={() => {
                    if (job) void window.kuraToolkit.jobs.cancel(job.jobId);
                }}
            />

            <AppDialog open={result !== null} onClose={() => setResult(null)} maxWidth='sm' fullWidth>
                <DialogTitle>
                    {result && result.failed + result.skipped > 0 ? t('audioPage.doneWithErrors') : t('common.done')}
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>
                        {t('audioPage.resultSummary', {
                            ok: result?.ok ?? 0,
                            failed: result?.failed ?? 0,
                            skipped: result?.skipped ?? 0,
                        })}
                    </Typography>
                    {result && result.details.length > 0 && (
                        <>
                            <Typography variant='body2' sx={{ mb: 0.5 }}>
                                {t('audioPage.failedFiles')}
                            </Typography>
                            {result.details.map(item => (
                                <Typography
                                    key={item.path}
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ wordBreak: 'break-all' }}
                                >
                                    {item.path}
                                    {item.error?.startsWith('UNSUPPORTED_CODEC')
                                        ? ` (${t('audioPage.unsupportedCodec')})`
                                        : ''}
                                </Typography>
                            ))}
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResult(null)}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>

            {/* 既存のファイルを上書きする場合の確認 (取り消せない操作のため実行前に必ず挟む) */}
            <AppDialog
                open={overwriteTargets !== null}
                onClose={() => setOverwriteTargets(null)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle>{t('audioPage.overwriteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('audioPage.overwriteMessage', { count: overwriteTargets?.length ?? 0 })}
                    </Typography>
                    <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                        {overwriteTargets?.map(target => (
                            <Typography
                                key={target}
                                variant='body2'
                                color='text.secondary'
                                sx={{ wordBreak: 'break-all' }}
                            >
                                {target}
                            </Typography>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOverwriteTargets(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            setOverwriteTargets(null);
                            void startNormalize();
                        }}
                    >
                        {t('audioPage.overwriteRun')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </PageContainer>
    );
}
