import React from 'react';
import {
    Box,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import ChapterTimesDialog from './ChapterTimesDialog';
import PreviewPlayer from './PreviewPlayer';
import { formatTime } from '../video/videoFormat';
import { trackTagErrorMessage } from './trackTagFormat';
import { showNotice } from '../../stores/noticeStore';
import { useVideoTrackTagStore, waveformTargetOf, type EditChapter } from '../../stores/videoTrackTagStore';
import type { TrackTagWaveform } from '@shared/types';

// 一覧の文字の大きさ (名前の欄を広く取るため小さめにする)
const LIST_FONT_SIZE = 12;

type Props = {
    durationSec: number;
    // 映像がある (無ければプレビュー用の動画を作れない)
    hasVideo: boolean;
    onMakeProxy(): void;
};

// チャプター: 左にチャプターの一覧 (名前の変更・削除、開始・終了の列のダブルクリックで時刻を入力)、右にプレビュー
// (開始・終了の調整と追加)
export default function ChaptersTab({ durationSec, hasVideo, onMakeProxy }: Props) {
    const { t } = useTranslation();
    const chapters = useVideoTrackTagStore(state => state.chapters);
    const frames = useVideoTrackTagStore(state => state.frames);
    const preview = useVideoTrackTagStore(state => state.preview);
    const waveform = useVideoTrackTagStore(state => state.waveform);
    const tracks = useVideoTrackTagStore(state => state.tracks);
    const target = React.useMemo(() => waveformTargetOf(tracks), [tracks]);
    const { setChapterTitle, setChapterTimes, removeChapter } = useVideoTrackTagStore.getState();
    const [seekRequest, setSeekRequest] = React.useState<{ time: number; nonce: number } | null>(null);
    const [currentId, setCurrentId] = React.useState<string | null>(null);
    // 開始・終了を変えるダイアログの対象 (開始・終了の列をダブルクリックしたチャプターと、その列)
    const [editingTimes, setEditingTimes] = React.useState<{ chapter: EditChapter; focus: 'start' | 'end' } | null>(
        null
    );

    const seek = (time: number) => setSeekRequest({ time, nonce: Date.now() });

    // 波形を出す音声のトラックが変わったら読み直す (読み終えたときに対象が変わっていれば使わない)
    const requestedRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!target || waveform?.key === target.key || requestedRef.current === target.key) return;
        requestedRef.current = target.key;
        const { key, source, streamIndex } = target;
        const done = (data: TrackTagWaveform) => {
            if (requestedRef.current === key) requestedRef.current = null;
            const store = useVideoTrackTagStore.getState();
            if (waveformTargetOf(store.tracks)?.key === key) store.setWaveform({ key, data });
        };
        window.kuraToolkit.videoTrackTag.waveform(source, streamIndex, durationSec).then(done, error => {
            showNotice('warning', trackTagErrorMessage(t, error));
            // 失敗した波形は空として持ち、読み直さない
            done({ step: 0, channels: [] });
        });
    }, [target, waveform?.key, durationSec, t]);

    return (
        // タブの残りの高さに収める (一覧は枠の中でスクロールし、プレビューは残りの大きさに合わせる)
        <Stack direction='row' spacing={2} sx={{ height: '100%', minHeight: 0 }}>
            <Box sx={{ flex: '1 1 0', minWidth: 340, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Panel disablePadding sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
                    <Table
                        size='small'
                        stickyHeader
                        sx={{
                            '& th, & td': { px: 0.75, fontSize: LIST_FONT_SIZE },
                            '& th': { whiteSpace: 'nowrap' },
                        }}
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell sx={{ width: '100%' }}>{t('videoTrackTagPage.colChapterTitle')}</TableCell>
                                <TableCell>{t('videoTrackTagPage.colStart')}</TableCell>
                                <TableCell>{t('videoTrackTagPage.colEnd')}</TableCell>
                                <TableCell />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {chapters.map((chapter, i) => (
                                <TableRow key={chapter.id} hover selected={chapter.id === currentId}>
                                    <TableCell
                                        onDoubleClick={() => seek(chapter.start)}
                                        sx={{ cursor: 'pointer', userSelect: 'none' }}
                                    >
                                        {i + 1}
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            variant='standard'
                                            size='small'
                                            fullWidth
                                            value={chapter.title}
                                            onChange={event => setChapterTitle(chapter.id, event.target.value)}
                                            slotProps={{
                                                input: { sx: { fontSize: LIST_FONT_SIZE } },
                                                htmlInput: {
                                                    'aria-label': t('videoTrackTagPage.colChapterTitle'),
                                                },
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell
                                        sx={{ whiteSpace: 'nowrap' }}
                                        onDoubleClick={() => setEditingTimes({ chapter, focus: 'start' })}
                                    >
                                        {formatTime(chapter.start)}
                                    </TableCell>
                                    <TableCell
                                        sx={{ whiteSpace: 'nowrap' }}
                                        onDoubleClick={() => setEditingTimes({ chapter, focus: 'end' })}
                                    >
                                        {formatTime(chapter.end)}
                                    </TableCell>
                                    <TableCell padding='none'>
                                        <Tooltip title={t('videoTrackTagPage.removeChapter')}>
                                            <IconButton
                                                aria-label={t('videoTrackTagPage.removeChapter')}
                                                size='small'
                                                onClick={() => removeChapter(chapter.id)}
                                            >
                                                <DeleteIcon fontSize='small' />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {chapters.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                                        {t('videoTrackTagPage.noChapters')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </Panel>
            </Box>
            <Box sx={{ flex: '1.5 1 0', minWidth: 0, height: '100%' }}>
                <PreviewPlayer
                    preview={preview}
                    frames={frames}
                    chapters={chapters}
                    durationSec={durationSec}
                    seekRequest={seekRequest}
                    onCurrentChapterChange={setCurrentId}
                    onMakeProxy={onMakeProxy}
                    hasVideo={hasVideo}
                    hasAudio={target !== null}
                    waveform={target && waveform?.key === target.key ? waveform.data : null}
                />
            </Box>
            <ChapterTimesDialog
                target={editingTimes}
                chapters={chapters}
                durationSec={durationSec}
                onClose={() => setEditingTimes(null)}
                onSubmit={(start, end) => {
                    if (editingTimes && setChapterTimes(editingTimes.chapter.id, start, end)) setEditingTimes(null);
                }}
            />
        </Stack>
    );
}
