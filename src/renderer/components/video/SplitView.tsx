import React from 'react';
import {
    Box,
    Button,
    Checkbox,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    Radio,
    RadioGroup,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import FileDropZone from '../common/FileDropZone';
import PathField from '../common/PathField';
import LogView from '../common/LogView';
import SectionLabel from '../common/SectionLabel';
import Panel from '../common/Panel';
import { showNotice } from '../../stores/noticeStore';
import { useVideoSplitMergeStore, type SplitMode } from '../../stores/videoSplitMergeStore';
import { formatTime, VIDEO_EXTENSIONS, videoErrorMessage, videoFilters } from './videoFormat';
import type { VideoJobControls } from './useVideoJob';
import { isChapterTrack } from '@shared/video-merge';
import { codecLabel } from '@shared/video-codecs';
import type {
    MediaStreamInfo,
    VideoCutMethod,
    VideoCutRequest,
    VideoOutputCheck,
    VideoSplitRequest,
} from '@shared/types';

const CUT_METHODS: VideoCutMethod[] = ['lossless', 'smart', 'reencode'];

// 字幕コーデックの通称 (ffprobe の codec_name -> 一般的な呼び方)
const SUBTITLE_FORMAT_NAMES: Record<string, string> = {
    subrip: 'SRT',
    srt: 'SRT',
    ass: 'ASS',
    ssa: 'SSA',
    webvtt: 'WebVTT',
    mov_text: 'MP4 tx3g',
    dvd_subtitle: 'DVD VOBSUB',
    hdmv_pgs_subtitle: 'Blu-ray PGS',
    dvb_subtitle: 'DVB',
    dvb_teletext: 'Teletext',
    eia_608: 'CC (EIA-608)',
    // ffmpeg 側の表記ゆれ
    cea_608: 'CC (EIA-608)',
};

// 字幕コーデックの呼び方のうち、翻訳が必要なもの (ffprobe の codec_name -> 翻訳のキー)
const SUBTITLE_FORMAT_KEYS: Record<string, string> = {
    hdmv_text_subtitle: 'videoSplitMergePage.subtitleFormats.hdmvText',
    arib_caption: 'videoSplitMergePage.subtitleFormats.arib',
};

type Props = {
    jobs: VideoJobControls;
    // 分割するファイルを選び直す
    onFile(paths: string[]): void;
};

// チャプターで分割する画面 (チャプターの範囲の切り出しと、チャプターの位置での分割)
export default function SplitView({ jobs, onFile }: Props) {
    const { t } = useTranslation();
    const store = useVideoSplitMergeStore();
    const { busy, setLoading, runJob } = jobs;
    // 上書きになる出力パスの一覧 (null = 確認ダイアログを出さない)
    const [overwriteTargets, setOverwriteTargets] = React.useState<string[] | null>(null);
    // 出力コンテナが変わる場合の確認 (null = 確認ダイアログを出さない)
    const [containerCheck, setContainerCheck] = React.useState<VideoOutputCheck | null>(null);
    // 出力に含められないものがある場合の確認 (null = 確認ダイアログを出さない)
    const [lossCheck, setLossCheck] = React.useState<VideoOutputCheck | null>(null);
    // 解析結果 (ファイル情報) ダイアログ
    const [infoOpen, setInfoOpen] = React.useState(false);
    const formatError = (error: unknown): string => videoErrorMessage(t, error);

    // 出力ファイル名の入力。パスが貼り付けられた場合はディレクトリ部を出力先へ移し、
    // 欄にはファイル名だけを残す (出力先が 2 か所に分かれないようにするため)
    const setOutputName = (text: string) => {
        const separator = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
        if (separator < 0) {
            store.setOutputName(text);
            return;
        }
        const directory = text.slice(0, separator);
        if (directory) store.setOutputDir(directory);
        store.setOutputName(text.slice(separator + 1));
    };

    // 実行に使うリクエスト。出力先チェックと本処理で同じ内容を渡す
    const buildCutRequest = (input: string): VideoCutRequest => ({
        input,
        fromIndex: store.fromIndex,
        toIndex: store.toIndex >= 0 ? store.toIndex : null,
        method: store.cutMethod,
        outputDir: store.outputDir || null,
        outputName: store.outputName || null,
    });
    const buildSplitRequest = (input: string): VideoSplitRequest => ({
        input,
        boundaryIndexes: store.boundaries,
        method: store.cutMethod,
        outputDir: store.outputDir || null,
    });

    const run = async () => {
        if (!store.input || !store.probe) return;
        if (store.mode === 'split' && store.boundaries.filter(index => index > 0).length === 0) {
            showNotice('warning', t('videoSplitMergePage.noSplitPoint'));
            return;
        }
        if (store.mode === 'cut' && store.toIndex >= 0 && store.fromIndex > store.toIndex) {
            showNotice('warning', t('videoSplitMergePage.invalidRange'));
            return;
        }
        // 既に同名のファイルがある場合は、取り消せないため実行前に確認する
        const input = store.input;
        setLoading(true);
        let check;
        try {
            check =
                store.mode === 'cut'
                    ? await window.kuraToolkit.videoSplitMerge.checkCut(buildCutRequest(input))
                    : await window.kuraToolkit.videoSplitMerge.checkSplit(buildSplitRequest(input));
        } catch (error) {
            showNotice('warning', formatError(error));
            return;
        } finally {
            setLoading(false);
        }
        // 字幕の形式の都合で出力コンテナが変わる場合は、拡張子が変わる旨を先に確認する
        if (check.containerChange) {
            setContainerCheck(check);
            return;
        }
        await proceed(check);
    };

    // 含められないものの確認 (あれば知らせて確かめる) と、出力先の確認 (既存ファイルがあれば上書き確認、無ければそのまま実行)
    const proceed = async (check: VideoOutputCheck, lossConfirmed = false) => {
        if (!lossConfirmed && check.notices.length > 0) {
            setLossCheck(check);
            return;
        }
        if (check.existing.length > 0) {
            setOverwriteTargets(check.existing);
            return;
        }
        await start();
    };

    const start = async () => {
        if (!store.input || !store.probe) return;
        const input = store.input;
        const mode = store.mode;
        await runJob(jobId =>
            mode === 'cut'
                ? window.kuraToolkit.videoSplitMerge.cut(jobId, buildCutRequest(input))
                : window.kuraToolkit.videoSplitMerge.split(jobId, buildSplitRequest(input))
        );
    };

    const chapters = store.probe?.chapters ?? [];

    // 1 ストリーム分の説明行 (例: #1 音声: aac 2ch 48000 Hz 192 kbps [jpn])
    const formatStream = (stream: MediaStreamInfo): string => {
        if (isChapterTrack(stream, chapters.length)) {
            return `#${stream.index} ${t('videoSplitMergePage.streamChapterTrack')}: ${stream.codec || '?'}`;
        }
        const kindLabel = {
            video: t('videoSplitMergePage.streamVideo'),
            audio: t('videoSplitMergePage.streamAudio'),
            subtitle: t('videoSplitMergePage.streamSubtitle'),
            // 映像・音声・字幕以外は種別が分からないと判断できないため codec_type を添える
            other: stream.codecType
                ? `${t('videoSplitMergePage.streamOther')} (${stream.codecType})`
                : t('videoSplitMergePage.streamOther'),
        }[stream.kind];
        const parts: string[] = [stream.codec || '?'];
        // 字幕は形式が分かりにくいため、通称を併記する (subrip → SRT など)
        const subtitleKey = SUBTITLE_FORMAT_KEYS[stream.codec];
        const subtitleName = SUBTITLE_FORMAT_NAMES[stream.codec] ?? (subtitleKey ? t(subtitleKey) : undefined);
        if (stream.kind === 'subtitle' && subtitleName) parts.push(`(${subtitleName})`);
        if (stream.kind === 'video') {
            if (stream.width && stream.height) parts.push(`${stream.width}x${stream.height}`);
            if (stream.pixelFormat) parts.push(stream.pixelFormat);
            if (stream.attachedPic) parts.push(t('videoSplitMergePage.coverArt'));
        }
        if (stream.kind === 'audio') {
            if (stream.channels) parts.push(`${stream.channels}ch`);
            if (stream.sampleRate) parts.push(`${stream.sampleRate} Hz`);
        }
        if (stream.bitrateKbps) parts.push(`${stream.bitrateKbps} kbps`);
        if (stream.language) parts.push(`[${stream.language}]`);
        // 再生時にどれが選ばれるかの判断材料になるため、既定/強制の指定も出す
        if (stream.isDefault) parts.push(`[${t('videoSplitMergePage.streamDefault')}]`);
        if (stream.isForced) parts.push(`[${t('videoSplitMergePage.streamForced')}]`);
        if (stream.title) parts.push(stream.title);
        // コーデックを判別できない場合は、コンテナ上のタグと用途名が中身の手掛かりになる
        if (stream.kind === 'other') {
            if (stream.codecTag) parts.push(`tag=${stream.codecTag}`);
            if (stream.handlerName) parts.push(stream.handlerName);
        }
        return `#${stream.index} ${kindLabel}: ${parts.join(' ')}`;
    };

    // ffprobe は mp4 のように複数の候補を並べた形式名 ("mov,mp4,m4a,3gp,3g2,mj2") を返すことがある。
    // 入力の拡張子と一致する候補があればそれを採用し、無ければ先頭を使う
    const formatLabel = (formatName: string, input: string | null): string => {
        const candidates = formatName
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
        if (candidates.length <= 1) return candidates[0] ?? '?';
        const dot = input ? input.lastIndexOf('.') : -1;
        const extension = dot >= 0 ? (input as string).slice(dot + 1).toLowerCase() : '';
        return candidates.includes(extension) ? extension : candidates[0];
    };

    // ファイルを読み込んだ時点で分かる内容をそのまま見せる (実行しないと分からない状態にしない)
    const infoLines = store.probe
        ? [
              [
                  `${t('videoSplitMergePage.infoFormat')}: ${formatLabel(store.probe.formatName, store.input)}`,
                  `${t('videoSplitMergePage.infoDuration')}: ${
                      store.probe.durationSec !== null ? formatTime(store.probe.durationSec) : '?'
                  }`,
                  `${t('videoSplitMergePage.infoChapters')}: ${chapters.length}`,
              ].join('   '),
              ...store.probe.streams.map(formatStream),
          ]
        : [];

    return (
        <>
            {/* 読み込んだファイルを示す細いバー。別のファイルをドロップ・選択すると読み込み直す */}
            <FileDropZone
                onFiles={onFile}
                filters={videoFilters(t)}
                accept={VIDEO_EXTENSIONS}
                onRejected={() => showNotice('warning', t('videoSplitMergePage.unsupportedFile'))}
                hint={store.input ?? ''}
                sx={{ minHeight: 72, flexShrink: 0 }}
            />

            <Tabs
                value={store.mode}
                onChange={(_event, value) => store.setMode(value as SplitMode)}
                sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab value='cut' label={t('videoSplitMergePage.modeCut')} />
                <Tab value='split' label={t('videoSplitMergePage.modeSplit')} />
            </Tabs>

            {store.mode === 'cut' ? (
                <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                    <FormControl size='small' sx={{ minWidth: 260 }}>
                        <InputLabel id='from-chapter-label'>{t('videoSplitMergePage.fromChapter')}</InputLabel>
                        <Select
                            labelId='from-chapter-label'
                            label={t('videoSplitMergePage.fromChapter')}
                            value={store.fromIndex}
                            onChange={event => store.setFromIndex(Number(event.target.value))}
                        >
                            {chapters.map(chapter => (
                                <MenuItem key={chapter.index} value={chapter.index}>
                                    {chapter.index + 1}: {chapter.title || formatTime(chapter.start)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size='small' sx={{ minWidth: 260 }}>
                        <InputLabel id='to-chapter-label'>{t('videoSplitMergePage.toChapter')}</InputLabel>
                        <Select
                            labelId='to-chapter-label'
                            label={t('videoSplitMergePage.toChapter')}
                            value={store.toIndex}
                            onChange={event => store.setToIndex(Number(event.target.value))}
                        >
                            <MenuItem value={-1}>{t('videoSplitMergePage.toLast')}</MenuItem>
                            {chapters.map(chapter => (
                                <MenuItem key={chapter.index} value={chapter.index}>
                                    {chapter.index + 1}: {chapter.title || formatTime(chapter.start)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>
            ) : (
                <Typography variant='body2' color='text.secondary'>
                    {t('videoSplitMergePage.splitHint')}
                </Typography>
            )}

            {/* 解析結果は常時表示せず、必要なときだけダイアログで開く */}
            <SectionLabel
                action={
                    <Button size='small' startIcon={<InfoOutlinedIcon />} onClick={() => setInfoOpen(true)}>
                        {t('videoSplitMergePage.fileInfo')}
                    </Button>
                }
            >
                {t('videoSplitMergePage.chapters')}
            </SectionLabel>
            {/* 残りの高さを埋め、あふれた行はこの枠内でスクロールさせる。
                        TableContainer の component= には Panel を渡さない (className を受け取れず
                        レイアウト指定が全て捨てられるため)。Panel 自身をスクロール枠にする */}
            <Panel disablePadding sx={{ flexGrow: 1, flexBasis: 0, minHeight: 180, overflow: 'auto' }}>
                <Table size='small' stickyHeader>
                    <TableHead>
                        <TableRow>
                            {/* チェック列は幅が狭く見出しが折り返すため、表示はせず読み上げ用の名前だけ持たせる */}
                            {store.mode === 'split' && (
                                <TableCell padding='checkbox' aria-label={t('videoSplitMergePage.colSplitPoint')} />
                            )}
                            <TableCell>{t('videoSplitMergePage.colNumber')}</TableCell>
                            <TableCell>{t('videoSplitMergePage.colStart')}</TableCell>
                            <TableCell>{t('videoSplitMergePage.colEnd')}</TableCell>
                            <TableCell>{t('videoSplitMergePage.colTitle')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {chapters.map(chapter => {
                            const inRange =
                                store.mode === 'cut' &&
                                chapter.index >= store.fromIndex &&
                                (store.toIndex < 0 || chapter.index <= store.toIndex);
                            return (
                                <TableRow
                                    key={chapter.index}
                                    hover
                                    selected={inRange}
                                    onClick={() => {
                                        if (store.mode === 'split' && chapter.index > 0) {
                                            store.toggleBoundary(chapter.index);
                                        }
                                    }}
                                >
                                    {store.mode === 'split' && (
                                        <TableCell padding='checkbox'>
                                            <Checkbox
                                                size='small'
                                                disabled={chapter.index === 0}
                                                checked={store.boundaries.includes(chapter.index)}
                                            />
                                        </TableCell>
                                    )}
                                    <TableCell>{chapter.index + 1}</TableCell>
                                    <TableCell>{formatTime(chapter.start)}</TableCell>
                                    <TableCell>{formatTime(chapter.end)}</TableCell>
                                    <TableCell sx={{ wordBreak: 'break-all' }}>{chapter.title}</TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Panel>

            <Box sx={{ flexShrink: 0 }}>
                <Panel>
                    <Stack spacing={2}>
                        <PathField
                            label={t('videoSplitMergePage.outputDir')}
                            browse='folder'
                            value={store.outputDir}
                            onChange={value => store.setOutputDir(value)}
                            onBrowse={() =>
                                window.kuraToolkit.dialog.openDirectory({
                                    defaultPath: store.outputDir || undefined,
                                })
                            }
                        />

                        {/* 切り出しモードのみ、出力ファイル名を明示指定できる (CLI の --output 相当)。
                                    出力先は上のディレクトリが決めるため、ここはファイル名だけを扱う */}
                        {store.mode === 'cut' && (
                            <TextField
                                size='small'
                                fullWidth
                                label={t('videoSplitMergePage.outputFile')}
                                value={store.outputName}
                                helperText={t('videoSplitMergePage.outputFileHint')}
                                onChange={event => setOutputName(event.target.value)}
                            />
                        )}

                        <Box>
                            <RadioGroup
                                row
                                value={store.cutMethod}
                                onChange={event => store.setCutMethod(event.target.value as VideoCutMethod)}
                            >
                                {CUT_METHODS.map(method => (
                                    <FormControlLabel
                                        key={method}
                                        value={method}
                                        control={<Radio />}
                                        label={t(`videoSplitMergePage.cutMethods.${method}`)}
                                    />
                                ))}
                            </RadioGroup>
                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t(`videoSplitMergePage.cutMethodHints.${store.cutMethod}`)}
                            </Typography>
                        </Box>
                    </Stack>
                </Panel>
            </Box>

            <Button variant='contained' onClick={run} disabled={busy} sx={{ flexShrink: 0 }}>
                {t('videoSplitMergePage.run')}
            </Button>

            {/* ファイルを読み込んだ時点の解析結果 */}
            <AppDialog open={infoOpen} onClose={() => setInfoOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoSplitMergePage.fileInfo')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' color='text.secondary' sx={{ mb: 1, wordBreak: 'break-all' }}>
                        {store.input}
                    </Typography>
                    <LogView lines={infoLines} sx={{ maxHeight: 320 }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setInfoOpen(false)}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>

            {/* 実行前に知らせること (出力に含められないもの・形式を変えて書く音声) がある場合の確認 */}
            <AppDialog open={lossCheck !== null} onClose={() => setLossCheck(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoSplitMergePage.splitNoticeTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('videoSplitMergePage.splitNoticeMessage')}
                    </Typography>
                    {lossCheck?.notices.map(notice => {
                        const text =
                            notice.kind === 'data'
                                ? t('videoSplitMergePage.splitLossData', { codec: notice.codec })
                                : notice.kind === 'coverArt'
                                  ? t('videoSplitMergePage.splitLossCoverArt')
                                  : notice.kind === 'uncleanStart'
                                    ? t('videoSplitMergePage.splitUncleanStart', {
                                          chapters: notice.chapters.map(chapter => `#${chapter}`).join(', '),
                                      })
                                    : t('videoSplitMergePage.splitAudioConverted', {
                                          codec: notice.codec,
                                          to: codecLabel(notice.to),
                                      });
                        return (
                            <Typography key={text} variant='body2' color='text.secondary'>
                                {text}
                            </Typography>
                        );
                    })}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLossCheck(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            const check = lossCheck;
                            setLossCheck(null);
                            if (check) void proceed(check, true);
                        }}
                    >
                        {t('videoSplitMergePage.splitNoticeRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 字幕の形式の都合で出力の拡張子が変わる場合の確認 */}
            <AppDialog open={containerCheck !== null} onClose={() => setContainerCheck(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoSplitMergePage.containerTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('videoSplitMergePage.containerMessage', {
                            from: containerCheck?.containerChange?.from ?? '',
                            to: containerCheck?.containerChange?.to ?? '',
                        })}
                    </Typography>
                    <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                        {containerCheck?.outputs.map(output => (
                            <Typography
                                key={output}
                                variant='body2'
                                color='text.secondary'
                                sx={{ wordBreak: 'break-all' }}
                            >
                                {output}
                            </Typography>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setContainerCheck(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            const check = containerCheck;
                            setContainerCheck(null);
                            if (check) void proceed(check);
                        }}
                    >
                        {t('videoSplitMergePage.containerRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 既存のファイルを上書きする場合の確認 (取り消せない操作のため実行前に必ず挟む) */}
            <AppDialog
                open={overwriteTargets !== null}
                onClose={() => setOverwriteTargets(null)}
                maxWidth='sm'
                fullWidth
            >
                <DialogTitle>{t('videoSplitMergePage.overwriteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('videoSplitMergePage.overwriteMessage', { count: overwriteTargets?.length ?? 0 })}
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
                            void start();
                        }}
                    >
                        {t('videoSplitMergePage.overwriteRun')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </>
    );
}
