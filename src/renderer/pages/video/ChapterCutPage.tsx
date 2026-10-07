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
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
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
import { errorMessage } from '../../components/common/errorMessage';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import PathField from '../../components/common/PathField';
import ProgressDialog from '../../components/common/ProgressDialog';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import LogView from '../../components/common/LogView';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import Panel from '../../components/common/Panel';
import { showNotice } from '../../stores/noticeStore';
import { useChapterStore, type ChapterMode } from '../../stores/chapterStore';
import type {
    ChapterCutRequest,
    ChapterOutputCheck,
    ChapterSplitRequest,
    JobEvent,
    MediaStreamInfo,
} from '@shared/types';

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts', 'avi', 'mp3', 'm4a', 'flac', 'ogg'];

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
    hdmv_text_subtitle: 'chapterPage.subtitleFormats.hdmvText',
    arib_caption: 'chapterPage.subtitleFormats.arib',
};

function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${s.toFixed(3).padStart(6, '0')}`;
}

type RunningJob = {
    jobId: string;
    percent?: number;
    current?: number;
    total?: number;
};

export default function ChapterCutPage() {
    const { t } = useTranslation();
    const videoFilters = [
        { name: t('common.fileTypes.media'), extensions: VIDEO_EXTENSIONS },
        { name: t('common.fileTypes.all'), extensions: ['*'] },
    ];
    const store = useChapterStore();
    const [job, setJob] = React.useState<RunningJob | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [resultOutputs, setResultOutputs] = React.useState<string[] | null>(null);
    // 上書きになる出力パスの一覧 (null = 確認ダイアログを出さない)
    const [overwriteTargets, setOverwriteTargets] = React.useState<string[] | null>(null);
    // 出力コンテナが変わる場合の確認 (null = 確認ダイアログを出さない)
    const [containerCheck, setContainerCheck] = React.useState<ChapterOutputCheck | null>(null);
    // 解析結果 (ファイル情報) ダイアログ
    const [infoOpen, setInfoOpen] = React.useState(false);
    // 完了ダイアログ内でログを開いているか (実行のたびに閉じた状態から始める)
    const [logOpen, setLogOpen] = React.useState(false);

    const activeJobId = job?.jobId;
    React.useEffect(() => {
        if (!activeJobId) return;
        const unsubscribe = window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== activeJobId) return;
            if (event.kind === 'log' && event.message) {
                useChapterStore.getState().appendLog(event.message);
            } else if (event.kind === 'progress') {
                setJob(previous =>
                    previous && previous.jobId === event.jobId
                        ? {
                              ...previous,
                              percent: event.percent ?? previous.percent,
                              current: event.current ?? previous.current,
                              total: event.total ?? previous.total,
                          }
                        : previous
                );
            }
        });
        return unsubscribe;
    }, [activeJobId]);
    // 全体の進み具合は切り出す範囲の長さに比例するため、そこから残り時間を見積もる (再エンコードは時間がかかる)
    const remaining = useRemainingTime(activeJobId ?? null, job?.percent);

    const formatError = (error: unknown): string => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('NO_CHAPTERS')) return t('chapterPage.noChapters');
        if (message.includes('INVALID_RANGE')) return t('chapterPage.invalidRange');
        if (message.includes('NO_SPLIT_POINT')) return t('chapterPage.noSplitPoint');
        if (message.includes('DUPLICATE_OUTPUTS')) return t('chapterPage.duplicateOutputs');
        if (message.includes('OUTPUT_EQUALS_INPUT')) return t('chapterPage.outputEqualsInput');
        return errorMessage(t, error);
    };

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

    const loadFile = async (paths: string[]) => {
        const input = paths[0];
        if (!input) return;
        setLoading(true);
        try {
            const probe = await window.kuraToolkit.chapter.probe(input);
            store.setInput(input, probe);
        } catch (error) {
            store.setInput(null, null);
            showNotice('warning', formatError(error));
        } finally {
            setLoading(false);
        }
    };

    // 実行に使うリクエスト。出力先チェックと本処理で同じ内容を渡す
    const buildCutRequest = (input: string): ChapterCutRequest => ({
        input,
        fromIndex: store.fromIndex,
        toIndex: store.toIndex >= 0 ? store.toIndex : null,
        accurate: store.accurate,
        outputDir: store.outputDir || null,
        outputName: store.outputName || null,
    });
    const buildSplitRequest = (input: string): ChapterSplitRequest => ({
        input,
        boundaryIndexes: store.boundaries,
        accurate: store.accurate,
        outputDir: store.outputDir || null,
    });

    const run = async () => {
        if (!store.input || !store.probe) return;
        if (store.mode === 'split' && store.boundaries.filter(index => index > 0).length === 0) {
            showNotice('warning', t('chapterPage.noSplitPoint'));
            return;
        }
        if (store.mode === 'cut' && store.toIndex >= 0 && store.fromIndex > store.toIndex) {
            showNotice('warning', t('chapterPage.invalidRange'));
            return;
        }
        // 既に同名のファイルがある場合は、取り消せないため実行前に確認する
        const input = store.input;
        setLoading(true);
        let check;
        try {
            check =
                store.mode === 'cut'
                    ? await window.kuraToolkit.chapter.checkCut(buildCutRequest(input))
                    : await window.kuraToolkit.chapter.checkSplit(buildSplitRequest(input));
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

    // 出力先の確認 (既存ファイルがあれば上書き確認、無ければそのまま実行)
    const proceed = async (check: ChapterOutputCheck) => {
        if (check.existing.length > 0) {
            setOverwriteTargets(check.existing);
            return;
        }
        await start();
    };

    const start = async () => {
        if (!store.input || !store.probe) return;
        const input = store.input;
        const jobId = crypto.randomUUID();
        store.clearLogs();
        setLogOpen(false);
        setJob({ jobId });
        try {
            const result =
                store.mode === 'cut'
                    ? await window.kuraToolkit.chapter.cut(jobId, buildCutRequest(input))
                    : await window.kuraToolkit.chapter.split(jobId, buildSplitRequest(input));
            if (!result.cancelled) {
                setResultOutputs(result.outputs);
            }
        } catch (error) {
            showNotice('warning', formatError(error));
        } finally {
            setJob(null);
        }
    };

    const chapters = store.probe?.chapters ?? [];

    // mp4 はチャプターを 'text' トラックとして格納する。ffmpeg はこれをチャプターへ変換して
    // パケットを出さないため data 扱いで現れる。収録数がチャプター数と一致することで見分ける
    const isChapterTrack = (stream: MediaStreamInfo): boolean =>
        stream.codecType === 'data' &&
        (stream.codecTag ?? '').toLowerCase() === 'text' &&
        chapters.length > 0 &&
        stream.frameCount === chapters.length;

    // 1 ストリーム分の説明行 (例: #1 音声: aac 2ch 48000 Hz 192 kbps [jpn])
    const formatStream = (stream: MediaStreamInfo): string => {
        if (isChapterTrack(stream)) {
            return `#${stream.index} ${t('chapterPage.streamChapterTrack')}: ${stream.codec || '?'}`;
        }
        const kindLabel = {
            video: t('chapterPage.streamVideo'),
            audio: t('chapterPage.streamAudio'),
            subtitle: t('chapterPage.streamSubtitle'),
            // 映像・音声・字幕以外は種別が分からないと判断できないため codec_type を添える
            other: stream.codecType
                ? `${t('chapterPage.streamOther')} (${stream.codecType})`
                : t('chapterPage.streamOther'),
        }[stream.kind];
        const parts: string[] = [stream.codec || '?'];
        // 字幕は形式が分かりにくいため、通称を併記する (subrip → SRT など)
        const subtitleKey = SUBTITLE_FORMAT_KEYS[stream.codec];
        const subtitleName = SUBTITLE_FORMAT_NAMES[stream.codec] ?? (subtitleKey ? t(subtitleKey) : undefined);
        if (stream.kind === 'subtitle' && subtitleName) parts.push(`(${subtitleName})`);
        if (stream.kind === 'video') {
            if (stream.width && stream.height) parts.push(`${stream.width}x${stream.height}`);
            if (stream.pixelFormat) parts.push(stream.pixelFormat);
            if (stream.attachedPic) parts.push(t('chapterPage.coverArt'));
        }
        if (stream.kind === 'audio') {
            if (stream.channels) parts.push(`${stream.channels}ch`);
            if (stream.sampleRate) parts.push(`${stream.sampleRate} Hz`);
        }
        if (stream.bitrateKbps) parts.push(`${stream.bitrateKbps} kbps`);
        if (stream.language) parts.push(`[${stream.language}]`);
        // 再生時にどれが選ばれるかの判断材料になるため、既定/強制の指定も出す
        if (stream.isDefault) parts.push(`[${t('chapterPage.streamDefault')}]`);
        if (stream.isForced) parts.push(`[${t('chapterPage.streamForced')}]`);
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
                  `${t('chapterPage.infoFormat')}: ${formatLabel(store.probe.formatName, store.input)}`,
                  `${t('chapterPage.infoDuration')}: ${
                      store.probe.durationSec !== null ? formatTime(store.probe.durationSec) : '?'
                  }`,
                  `${t('chapterPage.infoChapters')}: ${chapters.length}`,
              ].join('   '),
              ...store.probe.streams.map(formatStream),
          ]
        : [];

    return (
        <PageContainer>
            <FileDropZone
                onFiles={loadFile}
                filters={videoFilters}
                hint={store.input ?? t('chapterPage.dropHint')}
                // 読み込むまでは画面全体を受け皿にし、読み込み後は上部の細いバーにする
                sx={
                    chapters.length > 0
                        ? { minHeight: 72, flexShrink: 0 }
                        : { flexGrow: 1, flexBasis: 0, minHeight: 180 }
                }
            />

            {chapters.length > 0 && (
                <>
                    <Tabs
                        value={store.mode}
                        onChange={(_event, value) => store.setMode(value as ChapterMode)}
                        sx={{ borderBottom: 1, borderColor: 'divider' }}
                    >
                        <Tab value='cut' label={t('chapterPage.modeCut')} />
                        <Tab value='split' label={t('chapterPage.modeSplit')} />
                    </Tabs>

                    {store.mode === 'cut' ? (
                        <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                            <FormControl size='small' sx={{ minWidth: 260 }}>
                                <InputLabel id='from-chapter-label'>{t('chapterPage.fromChapter')}</InputLabel>
                                <Select
                                    labelId='from-chapter-label'
                                    label={t('chapterPage.fromChapter')}
                                    value={store.fromIndex}
                                    onChange={event => store.setFromIndex(Number(event.target.value))}
                                >
                                    {chapters.map(chapter => (
                                        <MenuItem key={chapter.index} value={chapter.index}>
                                            {chapter.id}: {chapter.title || formatTime(chapter.start)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size='small' sx={{ minWidth: 260 }}>
                                <InputLabel id='to-chapter-label'>{t('chapterPage.toChapter')}</InputLabel>
                                <Select
                                    labelId='to-chapter-label'
                                    label={t('chapterPage.toChapter')}
                                    value={store.toIndex}
                                    onChange={event => store.setToIndex(Number(event.target.value))}
                                >
                                    <MenuItem value={-1}>{t('chapterPage.toLast')}</MenuItem>
                                    {chapters.map(chapter => (
                                        <MenuItem key={chapter.index} value={chapter.index}>
                                            {chapter.id}: {chapter.title || formatTime(chapter.start)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Stack>
                    ) : (
                        <Typography variant='body2' color='text.secondary'>
                            {t('chapterPage.splitHint')}
                        </Typography>
                    )}

                    {/* 解析結果は常時表示せず、必要なときだけダイアログで開く */}
                    <SectionLabel
                        action={
                            <Button size='small' startIcon={<InfoOutlinedIcon />} onClick={() => setInfoOpen(true)}>
                                {t('chapterPage.fileInfo')}
                            </Button>
                        }
                    >
                        {t('chapterPage.chapters')}
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
                                        <TableCell padding='checkbox' aria-label={t('chapterPage.colSplitPoint')} />
                                    )}
                                    <TableCell>{t('chapterPage.colId')}</TableCell>
                                    <TableCell>{t('chapterPage.colStart')}</TableCell>
                                    <TableCell>{t('chapterPage.colEnd')}</TableCell>
                                    <TableCell>{t('chapterPage.colTitle')}</TableCell>
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
                                            <TableCell>{chapter.id}</TableCell>
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
                        <SectionLabel>{t('chapterPage.outputSection')}</SectionLabel>
                        <Panel>
                            <Stack spacing={2}>
                                <PathField
                                    label={t('chapterPage.outputDir')}
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
                                        label={t('chapterPage.outputFile')}
                                        value={store.outputName}
                                        helperText={t('chapterPage.outputFileHint')}
                                        onChange={event => setOutputName(event.target.value)}
                                    />
                                )}

                                <Box>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={store.accurate}
                                                onChange={event => store.setAccurate(event.target.checked)}
                                            />
                                        }
                                        label={t('chapterPage.accurate')}
                                    />
                                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                        {t('chapterPage.accurateHint')}
                                    </Typography>
                                </Box>
                            </Stack>
                        </Panel>
                    </Box>

                    <Button variant='contained' onClick={run} disabled={job !== null || loading} sx={{ flexShrink: 0 }}>
                        {t('chapterPage.run')}
                    </Button>
                </>
            )}

            <ProgressDialog
                open={job !== null || loading}
                title={t('chapterPage.running')}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                remaining={remaining}
                // チャプター解析中 (ジョブ未開始) はキャンセルできないためボタンを出さない
                onCancel={
                    job
                        ? () => {
                              void window.kuraToolkit.jobs.cancel(job.jobId);
                          }
                        : undefined
                }
            />

            <AppDialog open={resultOutputs !== null} onClose={() => setResultOutputs(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('common.done')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ mb: 0.5 }}>
                        {t('chapterPage.resultOutputs')}
                    </Typography>
                    {resultOutputs?.map(output => (
                        <Typography key={output} variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                            {output}
                        </Typography>
                    ))}
                    {/* 処理の詳細は普段は隠しておき、必要なときだけ開く */}
                    {logOpen && store.logs.length > 0 && (
                        <LogView lines={store.logs} sx={{ mt: 1.5, maxHeight: 240 }} />
                    )}
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between' }}>
                    <Button
                        size='small'
                        color='inherit'
                        disabled={store.logs.length === 0}
                        onClick={() => setLogOpen(open => !open)}
                    >
                        {logOpen ? t('chapterPage.hideLog') : t('chapterPage.showLog')}
                    </Button>
                    <Button onClick={() => setResultOutputs(null)}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>

            {/* ファイルを読み込んだ時点の解析結果 */}
            <AppDialog open={infoOpen} onClose={() => setInfoOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('chapterPage.fileInfo')}</DialogTitle>
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

            {/* 字幕の形式の都合で出力の拡張子が変わる場合の確認 */}
            <AppDialog open={containerCheck !== null} onClose={() => setContainerCheck(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('chapterPage.containerTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('chapterPage.containerMessage', {
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
                        {t('chapterPage.containerRun')}
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
                <DialogTitle>{t('chapterPage.overwriteTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('chapterPage.overwriteMessage', { count: overwriteTargets?.length ?? 0 })}
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
                        {t('chapterPage.overwriteRun')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </PageContainer>
    );
}
