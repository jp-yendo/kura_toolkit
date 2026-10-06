import React from 'react';
import {
    Box,
    Button,
    Checkbox,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import PathField from '../common/PathField';
import ProgressDialog from '../common/ProgressDialog';
import { baseName, dirName, joinPath, sanitizeFileName } from './voiceFormat';
import { isCancelledError, voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { useSettingsStore } from '../../stores/settingsStore';
import { showNotice } from '../../stores/noticeStore';
import {
    EXPORT_BITRATES,
    EXPORT_SAMPLE_RATES,
    type AudioExportFormat,
    type AudioExportSettings,
    type ExportBitrateMode,
} from '@shared/voice/types';

export type ExportEntry = {
    key: string;
    label: string;
    // ファイル名の接尾辞 (ボーカル・伴奏など。翻訳済み)。空なら元のファイル名だけ
    suffix: string;
    // ファイル名 (拡張子なし)。指定したときは、元のファイル名と接尾辞の代わりにこれを使う
    fileName?: string;
    // 書き出す音声 (作業ディレクトリ内)。複数の音を重ねる必要があるものは書き出し時に作る
    resolve(jobId: string): Promise<string>;
    defaultChecked?: boolean;
};

type Props = {
    open: boolean;
    onClose(): void;
    entries: ExportEntry[];
    // 元のファイルのパス (ファイル名と既定の書き出し先に使う)
    sourcePath: string;
    // ファイル名の元 (拡張子なし)。省略時は元のファイルの名前を使う
    baseFileName?: string;
    // 書き出す結果がある作業
    workKey: string;
    // 書き出すものを呼び出し側で選んである (項目ごとのチェックを出さずに、渡したものをすべて書き出す)
    fixedSelection?: boolean;
};

type EntryState = { checked: boolean; name: string; customPath: string | null };

function extension(format: AudioExportFormat): string {
    return format === 'mp3' ? 'mp3' : 'flac';
}

// 音声の書き出し。書き出しの設定は音声機能で共通で、変えた時点で保存する。
// 書き出すものが複数ある場合は、書き出し先ディレクトリと項目ごとのファイル名を指定する。
// 1 つだけの場合は、形式の設定だけを示し、書き出すときに保存先とファイル名をファイルの保存ダイアログで選ぶ
export default function ExportDialog({
    open,
    onClose,
    entries,
    sourcePath,
    baseFileName,
    workKey,
    fixedSelection,
}: Props) {
    const { t } = useTranslation();
    const { settings, update } = useSettingsStore();
    // 設定は起動時に読み込み済み (読み込む前は画面を描画しない)
    const exportSettings = (settings as NonNullable<typeof settings>).voice.export;
    const [outputDir, setOutputDir] = React.useState('');
    const [states, setStates] = React.useState<Record<string, EntryState>>({});
    const [overwrite, setOverwrite] = React.useState<string[] | null>(null);
    const { job, run, cancel } = useJobRunner();
    const ext = extension(exportSettings.format);
    const base = sanitizeFileName(baseFileName || baseName(sourcePath) || 'output');

    // 開くたびに既定値 (元のファイルと同じ場所・自動のファイル名) に戻す
    React.useEffect(() => {
        if (!open) return;
        setOutputDir(dirName(sourcePath));
        const next: Record<string, EntryState> = {};
        for (const entry of entries) {
            next[entry.key] = { checked: entry.defaultChecked ?? true, name: '', customPath: null };
        }
        setStates(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点の内容で初期化する
    }, [open]);

    const single = entries.length === 1 ? entries[0] : null;
    const autoName = (entry: ExportEntry) =>
        sanitizeFileName(entry.fileName ?? (entry.suffix ? `${base}_${entry.suffix}` : base));
    const fileNameOf = (entry: ExportEntry) => {
        const state = states[entry.key];
        const name = state?.name.trim() ? state.name.trim() : autoName(entry);
        return `${name.replace(/\.(mp3|flac)$/i, '')}.${ext}`;
    };
    const destOf = (entry: ExportEntry) => {
        const state = states[entry.key];
        if (state?.customPath) return state.customPath.replace(/\.(mp3|flac)$/i, '') + `.${ext}`;
        return joinPath(outputDir, fileNameOf(entry));
    };
    const selected = entries.filter(entry => states[entry.key]?.checked);
    // 保存先を個別に指定していないものは、書き出し先ディレクトリに書く
    const needsOutputDir = selected.some(entry => !states[entry.key]?.customPath);

    const patchSettings = (patch: Partial<AudioExportSettings>) => {
        void update({ voice: { export: { ...exportSettings, ...patch } } });
    };

    // 書き出す。targets を渡した場合はその書き出し先 (保存ダイアログで選び、上書きの確認も済んでいるもの) に書く
    const start = async (confirmed: boolean, targets?: { entry: ExportEntry; dest: string }[]) => {
        const items = targets ?? selected.map(entry => ({ entry, dest: destOf(entry) }));
        const destinations = items.map(item => item.dest);
        // 同じ書き出し先が複数あると、後から書いたもので上書きされてしまうため止める
        // (Windows と macOS のファイル名は大文字小文字を区別しない)
        const normalized = destinations.map(item => item.split('\\').join('/').toLowerCase());
        if (new Set(normalized).size !== normalized.length) {
            showNotice('error', t('voice.export.duplicate'), 10000);
            return;
        }
        if (!confirmed && !targets) {
            const existing = await window.kuraToolkit.voice.export.existing(destinations);
            if (existing.length > 0) {
                setOverwrite(existing);
                return;
            }
        }
        try {
            const result = await run(t('voice.export.running'), async jobId => {
                const resolved = [];
                for (const item of items) resolved.push({ source: await item.entry.resolve(jobId), dest: item.dest });
                return window.kuraToolkit.voice.export.run(jobId, workKey, resolved, exportSettings);
            });
            if (result.cancelled) {
                showNotice('warning', t('voice.common.cancelled'));
                return;
            }
            if (result.failed.length > 0) {
                showNotice(
                    'error',
                    t('voice.export.failed', {
                        count: result.failed.length,
                        error: voiceErrorMessage(t, result.failed[0].error),
                    }),
                    10000
                );
                return;
            }
            showNotice('success', t('voice.export.done', { count: result.outputs.length }));
            onClose();
        } catch (error) {
            if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
            else showNotice('error', voiceErrorMessage(t, error), 10000);
        }
    };

    return (
        <>
            <AppDialog open={open && job === null} onClose={onClose} maxWidth='md' fullWidth>
                <DialogTitle>{t('voice.export.title')}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                            <FormControl size='small' sx={{ width: 160 }}>
                                <InputLabel id='export-format'>{t('voice.export.format')}</InputLabel>
                                <Select
                                    labelId='export-format'
                                    label={t('voice.export.format')}
                                    value={exportSettings.format}
                                    onChange={event =>
                                        patchSettings({ format: event.target.value as AudioExportFormat })
                                    }
                                >
                                    <MenuItem value='mp3'>MP3</MenuItem>
                                    <MenuItem value='flac'>FLAC</MenuItem>
                                </Select>
                            </FormControl>
                            <FormControl size='small' sx={{ width: 180 }} disabled={exportSettings.format !== 'mp3'}>
                                <InputLabel id='export-sample-rate'>{t('voice.export.sampleRate')}</InputLabel>
                                <Select
                                    labelId='export-sample-rate'
                                    label={t('voice.export.sampleRate')}
                                    value={exportSettings.sampleRate}
                                    onChange={event => patchSettings({ sampleRate: Number(event.target.value) })}
                                >
                                    {EXPORT_SAMPLE_RATES.map(rate => (
                                        <MenuItem key={rate} value={rate}>
                                            {rate} Hz
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size='small' sx={{ width: 160 }} disabled={exportSettings.format !== 'mp3'}>
                                <InputLabel id='export-bitrate-mode'>{t('voice.export.bitrateMode')}</InputLabel>
                                <Select
                                    labelId='export-bitrate-mode'
                                    label={t('voice.export.bitrateMode')}
                                    value={exportSettings.bitrateMode}
                                    onChange={event =>
                                        patchSettings({ bitrateMode: event.target.value as ExportBitrateMode })
                                    }
                                >
                                    <MenuItem value='cbr'>CBR</MenuItem>
                                    <MenuItem value='vbr'>VBR</MenuItem>
                                </Select>
                            </FormControl>
                            <FormControl size='small' sx={{ width: 160 }} disabled={exportSettings.format !== 'mp3'}>
                                <InputLabel id='export-bitrate'>{t('voice.export.bitrate')}</InputLabel>
                                <Select
                                    labelId='export-bitrate'
                                    label={t('voice.export.bitrate')}
                                    value={exportSettings.bitrate}
                                    onChange={event => patchSettings({ bitrate: Number(event.target.value) })}
                                >
                                    {EXPORT_BITRATES.map(bitrate => (
                                        <MenuItem key={bitrate} value={bitrate}>
                                            {bitrate} kbps
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Stack>
                        {!single && (
                            <>
                                <PathField
                                    label={t('voice.export.outputDir')}
                                    value={outputDir}
                                    onChange={setOutputDir}
                                    onBrowse={() =>
                                        window.kuraToolkit.dialog.openDirectory({ defaultPath: outputDir || undefined })
                                    }
                                />
                                <Box>
                                    {entries.map(entry => {
                                        const state = states[entry.key];
                                        if (!state) return null;
                                        return (
                                            <Stack
                                                key={entry.key}
                                                direction='row'
                                                spacing={1}
                                                sx={{ alignItems: 'center', py: 0.5 }}
                                            >
                                                {!fixedSelection && (
                                                    <Checkbox
                                                        checked={state.checked}
                                                        onChange={(_e, checked) =>
                                                            setStates(previous => ({
                                                                ...previous,
                                                                [entry.key]: { ...state, checked },
                                                            }))
                                                        }
                                                    />
                                                )}
                                                <Typography variant='body2' sx={{ width: 160, flexShrink: 0 }}>
                                                    {entry.label}
                                                </Typography>
                                                {state.customPath ? (
                                                    <Typography
                                                        variant='body2'
                                                        color='text.secondary'
                                                        sx={{ flexGrow: 1, wordBreak: 'break-all' }}
                                                    >
                                                        {destOf(entry)}
                                                    </Typography>
                                                ) : (
                                                    <TextField
                                                        size='small'
                                                        fullWidth
                                                        disabled={!state.checked}
                                                        value={state.name}
                                                        placeholder={`${autoName(entry)}.${ext}`}
                                                        onChange={event =>
                                                            setStates(previous => ({
                                                                ...previous,
                                                                [entry.key]: { ...state, name: event.target.value },
                                                            }))
                                                        }
                                                    />
                                                )}
                                                {state.customPath && (
                                                    <Tooltip title={t('voice.export.resetPath')}>
                                                        <IconButton
                                                            aria-label={t('voice.export.resetPath')}
                                                            onClick={() =>
                                                                setStates(previous => ({
                                                                    ...previous,
                                                                    [entry.key]: { ...state, customPath: null },
                                                                }))
                                                            }
                                                        >
                                                            <CloseIcon fontSize='small' />
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                                <Tooltip title={t('voice.export.chooseFile')}>
                                                    <span>
                                                        <IconButton
                                                            aria-label={t('voice.export.chooseFile')}
                                                            disabled={!state.checked}
                                                            onClick={async () => {
                                                                const chosen = await window.kuraToolkit.dialog.saveFile(
                                                                    {
                                                                        defaultPath: destOf(entry),
                                                                        filters: [
                                                                            {
                                                                                name: ext.toUpperCase(),
                                                                                extensions: [ext],
                                                                            },
                                                                        ],
                                                                    }
                                                                );
                                                                if (chosen) {
                                                                    setStates(previous => ({
                                                                        ...previous,
                                                                        [entry.key]: { ...state, customPath: chosen },
                                                                    }));
                                                                }
                                                            }}
                                                        >
                                                            <FolderOpenIcon fontSize='small' />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </Stack>
                                        );
                                    })}
                                </Box>
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        disabled={!single && (selected.length === 0 || (needsOutputDir && !outputDir.trim()))}
                        onClick={async () => {
                            if (!single) {
                                void start(false);
                                return;
                            }
                            const dest = await window.kuraToolkit.dialog.saveFile({
                                defaultPath: destOf(single),
                                filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
                            });
                            if (dest) void start(true, [{ entry: single, dest }]);
                        }}
                    >
                        {t('voice.export.run')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={overwrite !== null} onClose={() => setOverwrite(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.export.overwriteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.export.overwriteMessage', { count: overwrite?.length ?? 0 })}
                    </Typography>
                    {overwrite?.map(item => (
                        <Typography key={item} variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                            {item}
                        </Typography>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOverwrite(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            setOverwrite(null);
                            void start(true);
                        }}
                    >
                        {t('voice.export.overwriteRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                status={job?.status}
                message={job?.message ?? ''}
                onCancel={cancel}
            />
        </>
    );
}
