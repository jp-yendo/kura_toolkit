import React from 'react';
import {
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Stack,
    Tab,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import VideoSettingsIcon from '@mui/icons-material/VideoSettings';
import { useTranslation } from 'react-i18next';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import PageContainer from '../../components/common/PageContainer';
import ProgressDialog from '../../components/common/ProgressDialog';
import ChaptersTab from '../../components/videoTrackTag/ChaptersTab';
import FileInfoTab from '../../components/videoTrackTag/FileInfoTab';
import TagsTab from '../../components/videoTrackTag/TagsTab';
import TracksTab from '../../components/videoTrackTag/TracksTab';
import {
    TRACK_TAG_VIDEO_EXTENSIONS,
    autoOutputFormat,
    copyableOutputFormats,
    trackTagErrorMessage,
    trackTagVideoFilters,
} from '../../components/videoTrackTag/trackTagFormat';
import { useTrackTagJob } from '../../components/videoTrackTag/useTrackTagJob';
import { showNotice } from '../../stores/noticeStore';
import {
    hasTrackTagChanges,
    outputTracks,
    tagKeyError,
    saveRequestOf,
    useVideoTrackTagStore,
    type TrackTagTab,
} from '../../stores/videoTrackTagStore';
import { isSameContainer } from '@shared/video-track-tag';
import type { TrackTagSaveCheck, TrackTagSaveRequest } from '@shared/types';

const TABS: TrackTagTab[] = ['tracks', 'chapters', 'tags', 'info'];

const withoutExtension = (filePath: string) => filePath.replace(/\.[^.\\/]*$/, '');

// 動画トラック・タグ管理: 動画を 1 つ選び、ファイル情報を見て、タグ・トラック・チャプターを編集し、新しいファイルへ書き出す
export default function VideoTrackTagPage() {
    const { t } = useTranslation();
    const job = useTrackTagJob();
    const input = useVideoTrackTagStore(state => state.input);
    const file = useVideoTrackTagStore(state => state.file);
    const tab = useVideoTrackTagStore(state => state.tab);
    const changed = useVideoTrackTagStore(hasTrackTagChanges);
    // 編集した内容があるときに開こうとした別の動画 (破棄してよいかを確かめている間)
    const [pendingInput, setPendingInput] = React.useState<string | null>(null);
    // リセット (編集した内容を破棄して読み込み直す) の確認中
    const [resetting, setResetting] = React.useState(false);
    // 出力できない理由 (再エンコードしなければ入れられないトラック) と、続ける前に知らせること
    const [blocked, setBlocked] = React.useState<TrackTagSaveCheck | null>(null);
    const [confirm, setConfirm] = React.useState<{ check: TrackTagSaveCheck; request: TrackTagSaveRequest } | null>(
        null
    );

    // 動画を読み込み、解析結果・フレームの時刻・プレビューの URL を用意する
    const load = async (path: string) => {
        job.setActivity(t('videoTrackTagPage.loading'));
        try {
            const probed = await window.kuraToolkit.videoTrackTag.probe(path);
            if (!probed.streams.some(stream => stream.kind !== null)) {
                showNotice('warning', t('videoTrackTagPage.noTracksInFile'));
                return;
            }
            void window.kuraToolkit.videoTrackTag.discard();
            const store = useVideoTrackTagStore.getState();
            store.load(path, probed);
            const [frames, preview] = await Promise.all([
                window.kuraToolkit.videoTrackTag.frames(path),
                window.kuraToolkit.videoTrackTag.preview(path),
            ]);
            // 読み込んでいる間に別の動画へ移った場合は使わない
            if (useVideoTrackTagStore.getState().input !== path) return;
            store.setFrames(frames);
            store.setPreview(preview);
        } catch (error) {
            showNotice('warning', trackTagErrorMessage(t, error));
        } finally {
            job.setActivity(null);
        }
    };

    // 編集した内容を破棄して、今の動画を読み込み直す (開いているタブはそのまま)
    const reload = async () => {
        if (!input) return;
        const currentTab = tab;
        await load(input);
        if (useVideoTrackTagStore.getState().input === input) useVideoTrackTagStore.getState().setTab(currentTab);
    };

    const open = (paths: string[]) => {
        const path = paths[0];
        if (!path) return;
        if (changed) {
            setPendingInput(path);
            return;
        }
        void load(path);
    };

    // 元の動画を再生できない場合に、プレビュー用の動画を作る
    const makeProxy = async () => {
        if (!input || !file) return;
        try {
            const preview = await job.run(t('videoTrackTagPage.makingProxy'), jobId =>
                window.kuraToolkit.videoTrackTag.makePreview(jobId, input, file.durationSec)
            );
            if (preview && useVideoTrackTagStore.getState().input === input) {
                useVideoTrackTagStore.getState().setPreview(preview);
            }
        } catch (error) {
            showNotice('warning', trackTagErrorMessage(t, error));
        }
    };

    const runSave = async (request: TrackTagSaveRequest) => {
        try {
            const result = await job.run(t('videoTrackTagPage.saving'), jobId =>
                window.kuraToolkit.videoTrackTag.save(jobId, request)
            );
            if (result.cancelled) return;
            useVideoTrackTagStore.getState().markSaved();
            showNotice('success', t('videoTrackTagPage.saved', { path: request.output }));
        } catch (error) {
            showNotice('warning', trackTagErrorMessage(t, error));
        }
    };

    // 書き出す: 保存先を選び、出力形式へ入れられるかを確かめてから書き出す
    const save = async () => {
        if (!input || !file) return;
        // 選べる形式が無い (どの形式にも再エンコードせずには入れられない) 場合は元の形式で確かめ、入れられないトラックを示す
        const format = chosenFormat ?? { extension: file.extension, label: file.extension.slice(1).toUpperCase() };
        const output = await window.kuraToolkit.dialog.saveFile({
            defaultPath: `${withoutExtension(input)}-edited${format.extension}`,
            filters: [{ name: format.label, extensions: [format.extension.slice(1)] }],
        });
        if (!output) return;
        const request = saveRequestOf(useVideoTrackTagStore.getState(), output);
        job.setActivity(t('videoTrackTagPage.checking'));
        let check: TrackTagSaveCheck;
        try {
            check = await window.kuraToolkit.videoTrackTag.checkSave(request);
        } catch (error) {
            showNotice('warning', trackTagErrorMessage(t, error));
            return;
        } finally {
            job.setActivity(null);
        }
        if (check.unsupported.length > 0) {
            setBlocked(check);
            return;
        }
        if (
            check.converted.length > 0 ||
            check.lostTags.length > 0 ||
            check.lostTrackTags.length > 0 ||
            check.chaptersLost ||
            check.lostChapterTags.length > 0 ||
            check.lostFlags.length > 0 ||
            check.defaultForced ||
            check.probeFailed ||
            check.droppedExtras.length > 0
        ) {
            setConfirm({ check, request });
            return;
        }
        await runSave(request);
    };

    // 出力形式: 今のトラックをすべて再エンコードせずに入れられる形式だけを選べる。選んでいた形式に入れられなくなったら自動に戻す
    const tracks = useVideoTrackTagStore(state => state.tracks);
    const outputFormat = useVideoTrackTagStore(state => state.outputFormat);
    const outputFormats = React.useMemo(
        () => (file ? copyableOutputFormats(outputTracks(tracks), file.extension) : []),
        [tracks, file]
    );
    const autoFormat = file ? autoOutputFormat(outputFormats, file.extension) : null;
    const chosenFormat =
        outputFormat === 'auto'
            ? autoFormat
            : (outputFormats.find(format => format.extension === outputFormat) ?? null);
    React.useEffect(() => {
        if (outputFormat !== 'auto' && !outputFormats.some(format => format.extension === outputFormat)) {
            useVideoTrackTagStore.getState().setOutputFormat('auto');
        }
    }, [outputFormat, outputFormats]);
    // 形式を変えるだけ (ほかに編集が無い) でも出力できる
    const formatChanged =
        file !== null && chosenFormat !== null && !isSameContainer(chosenFormat.extension, file.extension);
    const tagsInvalid = useVideoTrackTagStore(state => state.tags.some(tag => tagKeyError(state.tags, tag) !== null));
    const languagesInvalid = useVideoTrackTagStore(state =>
        outputTracks(state.tracks).some(track => track.language !== '' && !/^[a-z]{3}$/.test(track.language))
    );

    return (
        <PageContainer sx={{ height: '100%' }}>
            {!file ? (
                <FileDropZone
                    onFiles={open}
                    filters={trackTagVideoFilters(t)}
                    accept={TRACK_TAG_VIDEO_EXTENSIONS}
                    onRejected={() => showNotice('warning', t('videoTrackTagPage.unsupportedFile'))}
                    sx={{ flexGrow: 1 }}
                >
                    <Stack spacing={1} sx={{ alignItems: 'center' }}>
                        <VideoSettingsIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                        <Typography color='text.secondary' align='center' sx={{ whiteSpace: 'pre-line' }}>
                            {t('videoTrackTagPage.dropHint')}
                        </Typography>
                    </Stack>
                </FileDropZone>
            ) : (
                <>
                    {/* 読み込んだ動画を示す細いバー。別の動画をドロップ・選択すると読み込み直す */}
                    <FileDropZone
                        onFiles={open}
                        filters={trackTagVideoFilters(t)}
                        accept={TRACK_TAG_VIDEO_EXTENSIONS}
                        onRejected={() => showNotice('warning', t('videoTrackTagPage.unsupportedFile'))}
                        hint={input ?? ''}
                        sx={{ minHeight: 72, flexShrink: 0 }}
                    />
                    {/* タブの行の右端に、編集した内容を破棄して動画を読み込み直すボタンを置く */}
                    <Stack
                        direction='row'
                        sx={{
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderBottom: 1,
                            borderColor: 'divider',
                            flexShrink: 0,
                        }}
                    >
                        <Tabs
                            value={tab}
                            onChange={(_event, value) => useVideoTrackTagStore.getState().setTab(value as TrackTagTab)}
                        >
                            {TABS.map(item => (
                                <Tab key={item} value={item} label={t(`videoTrackTagPage.tabs.${item}`)} />
                            ))}
                        </Tabs>
                        <Button
                            size='small'
                            startIcon={<RestartAltIcon />}
                            disabled={job.busy}
                            onClick={() => setResetting(true)}
                        >
                            {t('videoTrackTagPage.reset')}
                        </Button>
                    </Stack>
                    {/* スクロールバーは右の余白に出し、中身との間を空ける (スクロールしないときの中身の幅はほかの行と同じ) */}
                    <Box sx={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: 'auto', mr: -1.5, pr: 1.5 }}>
                        {tab === 'info' && <FileInfoTab file={file} />}
                        {tab === 'tags' && <TagsTab />}
                        {tab === 'tracks' && <TracksTab job={job} />}
                        {tab === 'chapters' && (
                            <ChaptersTab
                                durationSec={file.durationSec ?? 0}
                                hasVideo={file.streams.some(stream => stream.kind === 'video')}
                                onMakeProxy={() => void makeProxy()}
                            />
                        )}
                    </Box>
                    <Stack direction='row' spacing={2} sx={{ flexShrink: 0, alignItems: 'center' }}>
                        <TextField
                            select
                            size='small'
                            label={t('videoTrackTagPage.outputFormat')}
                            value={
                                outputFormats.some(format => format.extension === outputFormat) ? outputFormat : 'auto'
                            }
                            onChange={event => useVideoTrackTagStore.getState().setOutputFormat(event.target.value)}
                            disabled={job.busy}
                            sx={{ width: 180 }}
                        >
                            <MenuItem value='auto'>
                                {autoFormat
                                    ? t('videoTrackTagPage.outputFormatAuto', { format: autoFormat.label })
                                    : t('videoTrackTagPage.outputFormatAutoNone')}
                            </MenuItem>
                            {outputFormats.map(format => (
                                <MenuItem key={format.extension} value={format.extension}>
                                    {format.label}
                                </MenuItem>
                            ))}
                        </TextField>
                        <Button
                            variant='contained'
                            disabled={(!changed && !formatChanged) || tagsInvalid || languagesInvalid || job.busy}
                            onClick={() => void save()}
                            sx={{ flexGrow: 1 }}
                        >
                            {t('videoTrackTagPage.output')}
                        </Button>
                    </Stack>
                </>
            )}

            <ProgressDialog
                open={job.busy}
                title={job.title}
                percent={job.percent}
                remaining={undefined}
                onCancel={job.cancel}
            />

            {/* リセットの確認 */}
            <AppDialog open={resetting} onClose={() => setResetting(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('videoTrackTagPage.resetTitle')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('videoTrackTagPage.resetMessage')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetting(false)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            setResetting(false);
                            void reload();
                        }}
                    >
                        {t('videoTrackTagPage.reset')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 編集した内容があるときに別の動画を開く確認 */}
            <AppDialog open={pendingInput !== null} onClose={() => setPendingInput(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('videoTrackTagPage.discardTitle')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('videoTrackTagPage.discardMessage')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingInput(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            const path = pendingInput;
                            setPendingInput(null);
                            if (path) void load(path);
                        }}
                    >
                        {t('videoTrackTagPage.discardRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 再エンコードしなければ出力形式へ入れられないトラックがある (出力できない) */}
            <AppDialog open={blocked !== null} onClose={() => setBlocked(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoTrackTagPage.blockedTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>{t('videoTrackTagPage.blockedMessage')}</Typography>
                    {blocked?.unsupported.map(item => (
                        <Typography key={item.trackNumber} variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.blockedTrack', {
                                number: item.trackNumber,
                                kind: t(`videoTrackTagPage.kinds.${item.kind}`),
                                codec: item.codec,
                            })}
                        </Typography>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button variant='contained' onClick={() => setBlocked(null)}>
                        {t('common.close')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 続ける前に知らせること (形式を変える字幕・書けないタグ・入れられないもの) */}
            <AppDialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('videoTrackTagPage.noticeTitle')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>{t('videoTrackTagPage.noticeMessage')}</Typography>
                    {confirm?.check.converted.map(item => (
                        <Typography key={`c${item.trackNumber}`} variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeConverted', {
                                number: item.trackNumber,
                                codec: item.codec,
                                to: item.to,
                            })}
                        </Typography>
                    ))}
                    {confirm && confirm.check.lostTags.length > 0 && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeLostTags', { keys: confirm.check.lostTags.join(', ') })}
                        </Typography>
                    )}
                    {confirm && confirm.check.lostTrackTags.length > 0 && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeLostTrackTags', {
                                keys: confirm.check.lostTrackTags.join(', '),
                            })}
                        </Typography>
                    )}
                    {confirm?.check.chaptersLost && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeChaptersLost')}
                        </Typography>
                    )}
                    {confirm && confirm.check.lostChapterTags.length > 0 && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeLostChapterTags', {
                                keys: confirm.check.lostChapterTags.join(', '),
                            })}
                        </Typography>
                    )}
                    {confirm && confirm.check.lostFlags.length > 0 && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeLostFlags', {
                                flags: confirm.check.lostFlags
                                    .map(flag => t(`videoTrackTagPage.flags.${flag}`, { defaultValue: flag }))
                                    .join('・'),
                            })}
                        </Typography>
                    )}
                    {confirm?.check.defaultForced && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeDefaultForced')}
                        </Typography>
                    )}
                    {confirm?.check.probeFailed && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.noticeProbeFailed')}
                        </Typography>
                    )}
                    {confirm?.check.droppedExtras.map(item => (
                        <Typography key={item} variant='body2' color='text.secondary'>
                            {t(`videoTrackTagPage.noticeDropped.${item}`)}
                        </Typography>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            const request = confirm?.request;
                            setConfirm(null);
                            if (request) void runSave(request);
                        }}
                    >
                        {t('videoTrackTagPage.noticeRun')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </PageContainer>
    );
}
