import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import type { Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import FileDropTarget from '../common/FileDropTarget';
import Panel from '../common/Panel';
import PathField from '../common/PathField';
import { showNotice } from '../../stores/noticeStore';
import { useVideoSplitMergeStore, type MergeItem } from '../../stores/videoSplitMergeStore';
import { formatTime, summarizeMedia, VIDEO_EXTENSIONS, videoFilters } from './videoFormat';
import type { VideoJobControls } from './useVideoJob';
import {
    canMergeWithoutReencode,
    MERGE_OUTPUT_FORMATS,
    planMerge,
    sourceExtension,
    type MergeLoss,
    type MergeOutputFormat,
    type MergeSource,
} from '@shared/video-merge';
import { codecLabel, encoderLosses, planCodecs } from '@shared/video-codecs';
import type { VideoMergeRequest } from '@shared/types';

// 一覧の行をドラッグして並べ替えるときのデータの種類 (ファイルのドロップと見分けるため)
const ROW_DRAG_TYPE = 'application/x-kura-merge-row';

const NO_WRAP_CELL_SX = { whiteSpace: 'nowrap' } as const;
const ELLIPSIS_SX = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

// パスをディレクトリ・ファイル名 (拡張子なし)・拡張子に分ける
function splitPath(filePath: string): { dir: string; base: string; extension: string; separator: string } {
    const separator = filePath.includes('\\') ? '\\' : '/';
    const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    const dir = cut >= 0 ? filePath.slice(0, cut) : '';
    const name = filePath.slice(cut + 1);
    const dot = name.lastIndexOf('.');
    return dot > 0
        ? { dir, base: name.slice(0, dot), extension: name.slice(dot + 1), separator }
        : { dir, base: name, extension: '', separator };
}

function toMergeSource(item: MergeItem): MergeSource {
    const { extension } = splitPath(item.input);
    return {
        extension: extension ? `.${extension.toLowerCase()}` : '',
        formatName: item.probe.formatName,
        streams: item.probe.streams,
        chapterCount: item.probe.chapters.length,
        formatTags: item.probe.formatTags,
    };
}

// 出力ファイル名に使えない文字 (全 OS で Windows の制約にそろえる)
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARS = /[<>:"|?*\x00-\x1f]/;

// 絶対パスか (Windows のドライブ・UNC、または / から始まるもの)
function isAbsolutePath(filePath: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('/');
}

// パスの比較用 (区切りをそろえ、大文字・小文字を区別しない)
function pathKey(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
}

// 拡張子を付け替える (動画・音声の拡張子なら置き換え、それ以外 (拡張子が無い場合を含む) は後ろに付ける)
function withExtension(filePath: string, extension: string): string {
    const { extension: current } = splitPath(filePath);
    const known =
        VIDEO_EXTENSIONS.includes(current.toLowerCase()) ||
        MERGE_OUTPUT_FORMATS.some(format => format.extension === `.${current.toLowerCase()}`);
    return known ? `${filePath.slice(0, filePath.length - current.length - 1)}${extension}` : `${filePath}${extension}`;
}

// 拡張子 (ドット付き) の表示名 (選べる出力形式の名前、無ければ拡張子の大文字)
function formatLabel(extension: string): string {
    return (
        MERGE_OUTPUT_FORMATS.find(format => format.extension === extension)?.label ?? extension.slice(1).toUpperCase()
    );
}

// 結合を押した後の確認の順番
const STAGES = ['codec', 'loss', 'overwrite'] as const;
type Stage = (typeof STAGES)[number];

type Props = {
    jobs: VideoJobControls;
    // 選んだ・ドロップしたファイルを一覧の末尾へ足す
    onAdd(paths: string[]): void;
};

// 複数のファイルを並べた順に結合する画面
export default function MergeView({ jobs, onAdd }: Props) {
    const { t } = useTranslation();
    const store = useVideoSplitMergeStore();
    const { busy, runJob } = jobs;
    const items = store.mergeItems;
    // ドラッグしている行と、離したときに入る位置 (その行の前。items.length は末尾)
    const [dragFrom, setDragFrom] = React.useState<number | null>(null);
    const [dropAt, setDropAt] = React.useState<number | null>(null);
    // 結合を押した後の確認 (コーデックの選択・含められないもの・上書き)。null = ダイアログを出さない
    const [pending, setPending] = React.useState<{ stage: Stage; request: VideoMergeRequest; exists: boolean } | null>(
        null
    );
    // コーデックの選択ダイアログで選んでいるエンコーダ
    const [codecChoice, setCodecChoice] = React.useState<{ video: string | null; audio: string | null }>({
        video: null,
        audio: null,
    });
    // 使っている ffmpeg にあるエンコーダ (undefined = 調べている途中、null = 調べられない)
    const [available, setAvailable] = React.useState<string[] | null | undefined>(undefined);
    // 色の規格を変換できるか (ffmpeg に zscale フィルタがあるか)
    const [colorConversion, setColorConversion] = React.useState(false);
    // 出力先のフォルダの有無と、同じ名前のファイルの有無 (入力中のパスについて調べた結果)
    const [outputCheck, setOutputCheck] = React.useState<{ path: string; directoryExists: boolean } | null>(null);

    const sources = items.map(toMergeSource);
    // 「元の形式」はすべてのファイルの形式が同じ場合だけ選べる (違う場合は知らせて結合させない)
    const sameExtension = sourceExtension(sources);
    const sourceBlocked = store.mergeFormat === 'source' && items.length > 0 && sameExtension === null;
    const targetExtension =
        store.mergeFormat === 'source'
            ? sameExtension
            : (MERGE_OUTPUT_FORMATS.find(format => format.id === store.mergeFormat)?.extension ?? null);
    const compatible = targetExtension === null || canMergeWithoutReencode(sources, targetExtension);
    const reencode = store.mergeReencode || !compatible;
    const output = store.mergeOutput;

    React.useEffect(() => {
        void window.kuraToolkit.videoSplitMerge.capabilities().then(capabilities => {
            setAvailable(capabilities.encoders);
            setColorConversion(capabilities.filters?.includes('zscale') ?? false);
        });
    }, []);

    // 出力ファイルの初めの値は、1 つ目のファイルと同じ場所の「{名前}-merged.{選んだ形式}」にする。
    // 出力形式を変えたときは拡張子を付け替える
    const firstInput = items[0]?.input;
    React.useEffect(() => {
        if (!targetExtension) return;
        const current = useVideoSplitMergeStore.getState().mergeOutput;
        if (current) {
            const next = withExtension(current, targetExtension);
            if (next !== current) useVideoSplitMergeStore.getState().setMergeOutput(next);
        } else if (firstInput) {
            const first = splitPath(firstInput);
            const name = `${first.base}-merged${targetExtension}`;
            useVideoSplitMergeStore
                .getState()
                .setMergeOutput(first.dir ? `${first.dir}${first.separator}${name}` : name);
        }
    }, [targetExtension, firstInput]);

    // 出力ファイルの名前の誤り (null = 誤りなし。空欄は誤りとして示さず、結合だけを押せなくする)
    const outputError = ((): string | null => {
        if (!output) return null;
        const { base, extension } = splitPath(output);
        if (!isAbsolutePath(output)) return t('videoSplitMergePage.outputNotAbsolute');
        if (!base || INVALID_NAME_CHARS.test(`${base}.${extension}`) || /[ .]$/.test(output)) {
            return t('videoSplitMergePage.outputInvalidName');
        }
        if (targetExtension && `.${extension.toLowerCase()}` !== targetExtension) {
            return t('videoSplitMergePage.outputExtension', { extension: targetExtension });
        }
        if (items.some(item => pathKey(item.input) === pathKey(output))) {
            return t('videoSplitMergePage.outputEqualsInput');
        }
        if (outputCheck?.path === output && !outputCheck.directoryExists)
            return t('videoSplitMergePage.outputNoFolder');
        return null;
    })();
    const outputSyntaxValid = output !== '' && outputError === null;

    // 出力先のフォルダがあるかを、入力が止まってから調べる
    React.useEffect(() => {
        if (!outputSyntaxValid) return;
        const timer = window.setTimeout(() => {
            void window.kuraToolkit.videoSplitMerge
                .checkOutput(output)
                .then(check => setOutputCheck({ path: output, directoryExists: check.directoryExists }));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [output, outputSyntaxValid]);
    const outputValid = outputSyntaxValid && outputCheck?.path === output && outputCheck.directoryExists;

    // 再エンコードのエンコーダ。元のコーデックがそろっていない (またはそのまま出力形式に入れられない) 場合は選んでもらう
    const codecPlans =
        targetExtension && available !== undefined ? planCodecs(sources, targetExtension, available) : null;
    const chooseVideo = reencode && !!codecPlans?.video && !codecPlans.video.uniform;
    const chooseAudio = reencode && !!codecPlans?.audio && !codecPlans.audio.uniform;
    // 長さの分からないファイルがある場合は合計を出さない
    const totalSec = items.every(item => item.probe.durationSec !== null)
        ? items.reduce((sum, item) => sum + (item.probe.durationSec ?? 0), 0)
        : null;

    const addFromDialog = async () => {
        onAdd(await window.kuraToolkit.dialog.openFiles({ filters: videoFilters(t), multi: true }));
    };

    const endDrag = () => {
        setDragFrom(null);
        setDropAt(null);
    };

    const handleRowDragOver = (event: React.DragEvent<HTMLTableRowElement>, index: number) => {
        // ファイルのドラッグは一覧の枠 (末尾への追加) に任せる
        if (dragFrom === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        setDropAt(event.clientY > rect.top + rect.height / 2 ? index + 1 : index);
    };

    const handleRowDrop = (event: React.DragEvent<HTMLTableRowElement>) => {
        if (dragFrom === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (dropAt !== null) {
            // 取り除いた後の一覧での位置に直す
            store.moveMergeItem(dragFrom, dropAt > dragFrom ? dropAt - 1 : dropAt);
        }
        endDrag();
    };

    // 出力に含められないもの。再エンコードする場合は、使う映像のエンコーダが書けない性質 (透過など) も含める
    const lossesFor = (request: VideoMergeRequest): MergeLoss[] => {
        if (!targetExtension) return [];
        const losses = planMerge(sources, targetExtension, { colorConversion }).losses;
        const videoEncoder = request.videoEncoder ?? codecPlans?.video?.auto ?? null;
        if (reencode && videoEncoder) losses.push(...encoderLosses(sources, videoEncoder, targetExtension));
        return losses;
    };

    // 確認を順に進める (コーデックの選択 -> 含められないもの -> 上書き)。確認の要らないものは飛ばし、最後に結合する
    const advance = async (request: VideoMergeRequest, exists: boolean, from: Stage) => {
        for (const stage of STAGES.slice(STAGES.indexOf(from))) {
            const needed =
                (stage === 'codec' && (chooseVideo || chooseAudio)) ||
                (stage === 'loss' && lossesFor(request).length > 0) ||
                (stage === 'overwrite' && exists);
            if (needed) {
                if (stage === 'codec') {
                    setCodecChoice({ video: codecPlans?.video?.auto ?? null, audio: codecPlans?.audio?.auto ?? null });
                }
                setPending({ stage, request, exists });
                return;
            }
        }
        setPending(null);
        await runJob(jobId => window.kuraToolkit.videoSplitMerge.merge(jobId, request));
    };

    const merge = async () => {
        if (items.length < 2) {
            showNotice('warning', t('videoSplitMergePage.needTwoFiles'));
            return;
        }
        if (!targetExtension || !outputValid) return;
        // 出力形式に使えるエンコーダが ffmpeg に無い場合は結合できない
        if (
            reencode &&
            ((codecPlans?.video && codecPlans.video.options.length === 0) ||
                (codecPlans?.audio && codecPlans.audio.options.length === 0))
        ) {
            showNotice('warning', t('videoSplitMergePage.noEncoder'));
            return;
        }
        const check = await window.kuraToolkit.videoSplitMerge.checkOutput(output);
        if (!check.directoryExists) {
            setOutputCheck({ path: output, directoryExists: false });
            return;
        }
        const addChapters = store.mergeChapters;
        const request: VideoMergeRequest = {
            items: items.map(item => ({ input: item.input, chapterTitle: addChapters ? item.chapterTitle : '' })),
            addChapters,
            reencode: store.mergeReencode,
            videoEncoder: null,
            audioEncoder: null,
            output,
        };
        await advance(request, check.exists, 'codec');
    };

    // 出力ファイルの参照 (保存のダイアログで選ぶ。結合は始めない)
    const browseOutput = () =>
        window.kuraToolkit.dialog.saveFile({
            defaultPath: output || undefined,
            filters: targetExtension
                ? [{ name: formatLabel(targetExtension), extensions: [targetExtension.slice(1)] }]
                : [{ name: t('common.fileTypes.media'), extensions: VIDEO_EXTENSIONS }],
        });

    const lossText = (loss: MergeLoss): string => {
        switch (loss.kind) {
            case 'video':
                return t('videoSplitMergePage.lossVideo');
            case 'subtitle':
                return t('videoSplitMergePage.lossSubtitle', { codec: loss.codec });
            case 'coverArt':
                return t('videoSplitMergePage.lossCoverArt');
            case 'timecode':
                return t('videoSplitMergePage.lossTimecode', { files: loss.files.join(', ') });
            case 'attachments':
                return t('videoSplitMergePage.lossAttachments');
            case 'data':
                return t('videoSplitMergePage.lossData', { codec: loss.codec });
            case 'subtitleStyle':
                return t('videoSplitMergePage.lossSubtitleStyle');
            case 'colorMismatch':
                return t('videoSplitMergePage.lossColorMismatch', { files: loss.files.join(', ') });
            case 'metadata':
                return t('videoSplitMergePage.lossMetadata', { files: loss.files.join(', ') });
            case 'trackNames':
                return t('videoSplitMergePage.lossTrackNames', { files: loss.files.join(', ') });
            case 'hdrMetadata':
                return t('videoSplitMergePage.lossHdrMetadata');
            case 'pixelFormat':
                return t('videoSplitMergePage.lossPixelFormat', {
                    items: loss.lost.map(item => t(`videoSplitMergePage.pixelLoss.${item}`)).join('、'),
                });
        }
    };

    // 離したときに入る位置の線 (行の上端、末尾の場合は最後の行の下端)
    const dropLineSx = (index: number) => {
        if (dropAt === null || dragFrom === null) return undefined;
        const line = (offset: number) => ({
            '& > td': { boxShadow: (theme: Theme) => `inset 0 ${offset}px 0 0 ${theme.palette.primary.main}` },
        });
        if (dropAt === index) return line(2);
        if (dropAt === items.length && index === items.length - 1) return line(-2);
        return undefined;
    };

    return (
        <>
            <Box sx={{ flexShrink: 0 }}>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={store.mergeChapters}
                            onChange={event => store.setMergeChapters(event.target.checked)}
                        />
                    }
                    label={t('videoSplitMergePage.addChapters')}
                />
            </Box>

            {/* 残りの高さを埋め、あふれた行はこの枠内でスクロールさせる。ファイルをドロップすると末尾に足す */}
            <FileDropTarget
                onFiles={onAdd}
                accept={VIDEO_EXTENSIONS}
                multiple
                onRejected={() => showNotice('warning', t('videoSplitMergePage.unsupportedFile'))}
                disabled={busy}
                sx={{ flexGrow: 1, flexBasis: 0, minHeight: 200, display: 'flex' }}
            >
                <Panel disablePadding sx={{ flexGrow: 1, overflow: 'auto' }}>
                    <Table size='small' stickyHeader sx={{ tableLayout: 'fixed' }}>
                        <TableHead>
                            <TableRow>
                                {/* 並べ替えのつまみの列は見出しを出さず、読み上げ用の名前だけ持たせる */}
                                <TableCell
                                    padding='checkbox'
                                    sx={{ width: 40 }}
                                    aria-label={t('videoSplitMergePage.dragToReorder')}
                                />
                                <TableCell align='right' sx={{ ...NO_WRAP_CELL_SX, width: 48 }}>
                                    {t('videoSplitMergePage.colOrder')}
                                </TableCell>
                                <TableCell>{t('videoSplitMergePage.colFile')}</TableCell>
                                {store.mergeChapters && (
                                    <TableCell sx={{ width: '32%' }}>
                                        {t('videoSplitMergePage.colChapterName')}
                                    </TableCell>
                                )}
                                <TableCell sx={{ width: 120 }} aria-label={t('videoSplitMergePage.colActions')} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={store.mergeChapters ? 5 : 4} sx={{ py: 4, border: 0 }}>
                                        <Typography color='text.secondary' align='center'>
                                            {t('videoSplitMergePage.mergeEmpty')}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {items.map((item, index) => {
                                const { base, extension } = splitPath(item.input);
                                const name = extension ? `${base}.${extension}` : base;
                                return (
                                    <TableRow
                                        key={item.key}
                                        hover
                                        selected={dragFrom === index}
                                        onDragOver={event => handleRowDragOver(event, index)}
                                        onDrop={handleRowDrop}
                                        sx={dropLineSx(index)}
                                    >
                                        <TableCell padding='checkbox'>
                                            {/* 行全体ではなくつまみだけをドラッグできるようにする (名前の欄の文字を選べるように) */}
                                            <Box
                                                draggable={!busy}
                                                aria-label={t('videoSplitMergePage.dragToReorder')}
                                                onDragStart={event => {
                                                    event.dataTransfer.effectAllowed = 'move';
                                                    event.dataTransfer.setData(ROW_DRAG_TYPE, String(index));
                                                    const row = event.currentTarget.closest('tr');
                                                    if (row) event.dataTransfer.setDragImage(row, 20, 20);
                                                    setDragFrom(index);
                                                }}
                                                onDragEnd={endDrag}
                                                sx={{
                                                    display: 'flex',
                                                    justifyContent: 'center',
                                                    color: 'text.secondary',
                                                    cursor: busy ? 'default' : 'grab',
                                                }}
                                            >
                                                <DragIndicatorIcon fontSize='small' />
                                            </Box>
                                        </TableCell>
                                        <TableCell align='right' sx={NO_WRAP_CELL_SX}>
                                            {index + 1}
                                        </TableCell>
                                        <TableCell title={item.input}>
                                            <Typography variant='body2' sx={ELLIPSIS_SX}>
                                                {name}
                                            </Typography>
                                            <Typography
                                                variant='caption'
                                                color='text.secondary'
                                                sx={ELLIPSIS_SX}
                                                component='div'
                                            >
                                                {summarizeMedia(item.probe)}
                                            </Typography>
                                        </TableCell>
                                        {store.mergeChapters && (
                                            <TableCell>
                                                <TextField
                                                    size='small'
                                                    fullWidth
                                                    value={item.chapterTitle}
                                                    placeholder={base}
                                                    onChange={event =>
                                                        store.setMergeChapterTitle(item.key, event.target.value)
                                                    }
                                                    slotProps={{
                                                        htmlInput: {
                                                            'aria-label': t('videoSplitMergePage.chapterNameOf', {
                                                                name,
                                                            }),
                                                        },
                                                    }}
                                                />
                                            </TableCell>
                                        )}
                                        <TableCell align='right' sx={NO_WRAP_CELL_SX}>
                                            <Tooltip title={t('videoSplitMergePage.moveUp')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('videoSplitMergePage.moveUp')}
                                                        disabled={busy || index === 0}
                                                        onClick={() => store.moveMergeItem(index, index - 1)}
                                                    >
                                                        <ArrowUpwardIcon fontSize='small' />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title={t('videoSplitMergePage.moveDown')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('videoSplitMergePage.moveDown')}
                                                        disabled={busy || index === items.length - 1}
                                                        onClick={() => store.moveMergeItem(index, index + 1)}
                                                    >
                                                        <ArrowDownwardIcon fontSize='small' />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title={t('videoSplitMergePage.remove')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('videoSplitMergePage.remove')}
                                                        disabled={busy}
                                                        onClick={() => store.removeMergeItem(item.key)}
                                                    >
                                                        <CloseIcon fontSize='small' />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </Panel>
            </FileDropTarget>
            <Stack
                direction='row'
                sx={{ flexShrink: 0, alignItems: 'center', justifyContent: 'space-between', mt: -1 }}
            >
                <Typography variant='body2' color='text.secondary'>
                    {t('videoSplitMergePage.mergeSummary', {
                        count: items.length,
                        duration: totalSec !== null ? formatTime(totalSec) : '?',
                    })}
                </Typography>
                <Button size='small' startIcon={<AddIcon />} onClick={addFromDialog} disabled={busy}>
                    {t('videoSplitMergePage.addFiles')}
                </Button>
            </Stack>

            {sourceBlocked && (
                <Alert severity='error' sx={{ flexShrink: 0 }}>
                    {t('videoSplitMergePage.sourceFormatMixed')}
                </Alert>
            )}
            {!sourceBlocked && !compatible && (
                <Alert severity='info' sx={{ flexShrink: 0 }}>
                    {t('videoSplitMergePage.formatsDiffer')}
                </Alert>
            )}

            <Box sx={{ flexShrink: 0 }}>
                <Panel>
                    <Stack direction='row' spacing={2} sx={{ alignItems: 'flex-start', mb: 1.5 }}>
                        <FormControl size='small' sx={{ width: 200, flexShrink: 0 }}>
                            <InputLabel id='merge-format-label'>{t('videoSplitMergePage.outputFormat')}</InputLabel>
                            <Select
                                labelId='merge-format-label'
                                label={t('videoSplitMergePage.outputFormat')}
                                value={store.mergeFormat}
                                onChange={event => store.setMergeFormat(event.target.value as MergeOutputFormat)}
                            >
                                <MenuItem value='source'>
                                    {sameExtension
                                        ? t('videoSplitMergePage.formatSourceOf', {
                                              format: formatLabel(sameExtension),
                                          })
                                        : t('videoSplitMergePage.formatSource')}
                                </MenuItem>
                                {MERGE_OUTPUT_FORMATS.map(format => (
                                    <MenuItem key={format.id} value={format.id}>
                                        {format.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <PathField
                            label={t('videoSplitMergePage.mergeOutputFile')}
                            browse='file'
                            value={output}
                            onChange={value => store.setMergeOutput(value)}
                            onBrowse={browseOutput}
                            helperText={outputError ?? undefined}
                            error={outputError !== null}
                        />
                    </Stack>
                    <FormControlLabel
                        control={
                            <Switch
                                // 形式がそろっていない場合は必ず再エンコードするため、オンのまま変えられないようにする
                                checked={store.mergeReencode || !compatible}
                                disabled={!compatible}
                                onChange={event => store.setMergeReencode(event.target.checked)}
                            />
                        }
                        label={t('videoSplitMergePage.reencode')}
                    />
                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                        {t('videoSplitMergePage.reencodeHint')}
                    </Typography>
                </Panel>
            </Box>

            <Stack direction='row' sx={{ flexShrink: 0 }}>
                <Button
                    variant='contained'
                    fullWidth
                    onClick={merge}
                    disabled={busy || sourceBlocked || !outputValid || available === undefined}
                >
                    {t('videoSplitMergePage.merge')}
                </Button>
            </Stack>

            {/* 再エンコードするコーデックの選択 (元のコーデックがそろっていない場合)。
                元の最大のチャンネル数・サンプリング周波数・ビット深度を書けないもの、出力形式に入らないもの、
                ffmpeg に無いものは選択肢に出さない */}
            <AppDialog open={pending?.stage === 'codec'} onClose={() => setPending(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('videoSplitMergePage.codecTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 2, lineHeight: 1.6 }}>{t('videoSplitMergePage.codecMessage')}</Typography>
                    <Stack spacing={2}>
                        {chooseVideo && codecPlans?.video && (
                            <FormControl size='small' fullWidth>
                                <InputLabel id='merge-video-codec-label'>
                                    {t('videoSplitMergePage.videoCodec')}
                                </InputLabel>
                                <Select
                                    labelId='merge-video-codec-label'
                                    label={t('videoSplitMergePage.videoCodec')}
                                    value={codecChoice.video ?? ''}
                                    onChange={event => setCodecChoice({ ...codecChoice, video: event.target.value })}
                                >
                                    {codecPlans.video.options.map(encoder => (
                                        <MenuItem key={encoder} value={encoder}>
                                            {codecLabel(encoder)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        {chooseAudio && codecPlans?.audio && (
                            <FormControl size='small' fullWidth>
                                <InputLabel id='merge-audio-codec-label'>
                                    {t('videoSplitMergePage.audioCodec')}
                                </InputLabel>
                                <Select
                                    labelId='merge-audio-codec-label'
                                    label={t('videoSplitMergePage.audioCodec')}
                                    value={codecChoice.audio ?? ''}
                                    onChange={event => setCodecChoice({ ...codecChoice, audio: event.target.value })}
                                >
                                    {codecPlans.audio.options.map(encoder => (
                                        <MenuItem key={encoder} value={encoder}>
                                            {codecLabel(encoder)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            if (!pending) return;
                            const request = {
                                ...pending.request,
                                videoEncoder: chooseVideo ? codecChoice.video : null,
                                audioEncoder: chooseAudio ? codecChoice.audio : null,
                            };
                            void advance(request, pending.exists, 'loss');
                        }}
                    >
                        {t('videoSplitMergePage.merge')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 選んだ出力形式に入れられないものがある場合の確認 */}
            <AppDialog open={pending?.stage === 'loss'} onClose={() => setPending(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoSplitMergePage.lossTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>{t('videoSplitMergePage.lossMessage')}</Typography>
                    {(pending ? lossesFor(pending.request) : []).map(loss => {
                        const text = lossText(loss);
                        return (
                            <Typography key={text} variant='body2' color='text.secondary'>
                                {text}
                            </Typography>
                        );
                    })}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => pending && void advance(pending.request, pending.exists, 'overwrite')}
                    >
                        {t('videoSplitMergePage.lossRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 既存のファイルを上書きする場合の確認 (取り消せない操作のため実行前に必ず挟む) */}
            <AppDialog open={pending?.stage === 'overwrite'} onClose={() => setPending(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoSplitMergePage.overwriteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('videoSplitMergePage.overwriteMessage', { count: 1 })}
                    </Typography>
                    <Typography variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                        {pending?.request.output}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            if (!pending) return;
                            setPending(null);
                            void runJob(jobId => window.kuraToolkit.videoSplitMerge.merge(jobId, pending.request));
                        }}
                    >
                        {t('videoSplitMergePage.overwriteRun')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </>
    );
}
