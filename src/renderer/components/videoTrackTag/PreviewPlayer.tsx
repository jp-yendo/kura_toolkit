import React from 'react';
import { Box, Button, ButtonBase, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import KeyIcon from '@mui/icons-material/Key';
import LastPageIcon from '@mui/icons-material/LastPage';
import PanToolAltIcon from '@mui/icons-material/PanToolAlt';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { useTranslation } from 'react-i18next';
import ChapterBar from './ChapterBar';
import WaveformBar from './WaveformBar';
import { formatTime } from '../video/videoFormat';
import { showNotice } from '../../stores/noticeStore';
import { useVideoTrackTagStore, type EditChapter } from '../../stores/videoTrackTagStore';
import type { TrackTagFrames, TrackTagPreview, TrackTagWaveform } from '@shared/types';

// 時刻を同じとみなす差 (秒)
const SAME_TIME = 0.0005;

type Props = {
    preview: TrackTagPreview | null;
    frames: TrackTagFrames | null;
    chapters: EditChapter[];
    durationSec: number;
    // 移る先の時刻 (nonce が変わるたびに、その時刻以降の最初のフレームへ移る)
    seekRequest: { time: number; nonce: number } | null;
    // 映像がある (無ければプレビュー用の動画を作れない)
    hasVideo: boolean;
    // 音声のトラックがある (波形を出す)
    hasAudio: boolean;
    // 音声の波形 (読み込んでいる間は null)
    waveform: TrackTagWaveform | null;
    onCurrentChapterChange(id: string | null): void;
    // 元の動画を再生できないときに、プレビュー用の動画を作る
    onMakeProxy(): void;
};

// 昇順の times のうち time 以下で最も後ろの位置 (無ければ -1)
function floorIndex(times: number[], time: number): number {
    let low = 0;
    let high = times.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (times[mid] <= time + SAME_TIME) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found;
}

// 昇順の times のうち time 以上で最も前の位置 (無ければ -1)
function ceilIndex(times: number[], time: number): number {
    const index = floorIndex(times, time - 2 * SAME_TIME) + 1;
    return index < times.length ? index : -1;
}

// アイコンだけのボタン (名前は読み上げとツールチップに出す)。chapter はチャプターの操作 (背景を付けて区別する)
function ControlButton(props: {
    title: string;
    icon: React.ReactNode;
    onClick(): void;
    disabled?: boolean;
    chapter?: boolean;
}) {
    const button = (
        <IconButton
            size='small'
            aria-label={props.title}
            disabled={props.disabled}
            onClick={props.onClick}
            sx={{ p: 0.5, ...(props.chapter ? { bgcolor: 'action.selected', borderRadius: 1 } : {}) }}
        >
            {props.icon}
        </IconButton>
    );
    return props.disabled ? (
        button
    ) : (
        <Tooltip title={props.title}>
            <span>{button}</span>
        </Tooltip>
    );
}

// 前・次のチャプターの番号のボタン (押すとそのチャプターの開始へ移る。無ければ「-」で押せない)
function ChapterNumberButton({ number, title, onClick }: { number: number | null; title: string; onClick(): void }) {
    const button = (
        <ButtonBase
            aria-label={title}
            disabled={number === null}
            onClick={onClick}
            sx={{
                width: 26,
                height: 26,
                mx: 0.25,
                borderRadius: '50%',
                bgcolor: 'action.selected',
                typography: 'body2',
                fontWeight: 700,
                color: number === null ? 'text.disabled' : 'text.primary',
            }}
        >
            {number ?? '-'}
        </ButtonBase>
    );
    return number === null ? (
        button
    ) : (
        <Tooltip title={title}>
            <span>{button}</span>
        </Tooltip>
    );
}

// チャプターのプレビュー: 動画・チャプターの位置の帯・再生とチャプターの操作 (再生のボタンを中央に、左右にチャプター・
// キーフレーム・フレームの操作を置く)
export default function PreviewPlayer(props: Props) {
    const { preview, frames, chapters, durationSec, seekRequest, onCurrentChapterChange } = props;
    const { t } = useTranslation();
    const videoRef = React.useRef<HTMLVideoElement>(null);
    // 動画の時刻 (mediaTime) と元の動画のフレームの時刻の差。最初に表示したフレームで測る
    const offsetRef = React.useRef<number | null>(null);
    const [position, setPosition] = React.useState(0);
    const [playing, setPlaying] = React.useState(false);
    // プレーヤーの音量 (PC の音量は変えない)
    const volume = useVideoTrackTagStore(state => state.volume);
    const muted = useVideoTrackTagStore(state => state.muted);
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = volume;
        video.muted = muted;
    }, [volume, muted, preview]);
    const [failed, setFailed] = React.useState(false);
    // 動画の大きさは、プレビューの枠の幅と高さから、操作と帯の高さを除いた分に収める (縦横比を保つ)
    const rootRef = React.useRef<HTMLDivElement>(null);
    const controlsRef = React.useRef<HTMLDivElement>(null);
    const barsRef = React.useRef<HTMLDivElement>(null);
    const [space, setSpace] = React.useState({ width: 0, height: 0 });
    React.useEffect(() => {
        const rootElement = rootRef.current;
        const controlsElement = controlsRef.current;
        const barsElement = barsRef.current;
        if (!rootElement || !controlsElement || !barsElement) return;
        const measure = () =>
            setSpace({
                width: rootElement.clientWidth,
                // 波形と帯、間隔 (動画と波形・帯の間と、操作との間) の分も除く
                height: rootElement.clientHeight - controlsElement.offsetHeight - barsElement.offsetHeight - 20,
            });
        const observer = new ResizeObserver(measure);
        observer.observe(rootElement);
        observer.observe(controlsElement);
        observer.observe(barsElement);
        measure();
        return () => observer.disconnect();
    }, []);
    const [aspect, setAspect] = React.useState(16 / 9);
    const times = React.useMemo(() => frames?.times ?? [], [frames]);
    const keyframes = frames?.keyframes ?? [];

    // 表示しているフレームの時刻を受け取る (再生中はフレームごと、止めているときは移動のたび)
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video || !preview) return;
        offsetRef.current = null;
        setFailed(false);
        let handle = 0;
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (offsetRef.current === null) offsetRef.current = (times[0] ?? 0) - metadata.mediaTime;
            setPosition(metadata.mediaTime + offsetRef.current);
            handle = video.requestVideoFrameCallback(onFrame);
        };
        handle = video.requestVideoFrameCallback(onFrame);
        return () => video.cancelVideoFrameCallback(handle);
    }, [preview, times]);

    const frameIndex = floorIndex(times, position);
    const frameTime = frameIndex >= 0 ? times[frameIndex] : position;

    const currentIndex = chapters.findIndex(
        chapter => frameTime >= chapter.start - SAME_TIME && frameTime < chapter.end - SAME_TIME
    );
    const current = currentIndex >= 0 ? chapters[currentIndex] : null;
    const currentId = current?.id ?? null;
    React.useEffect(() => onCurrentChapterChange(currentId), [currentId, onCurrentChapterChange]);
    // 前・次のチャプター (再生位置がチャプターの外なら、再生位置より前で始まる最後のもの・後で始まる最初のもの)
    const previousIndex =
        currentIndex >= 0
            ? currentIndex - 1
            : chapters.reduce((found, chapter, i) => (chapter.start < frameTime - SAME_TIME ? i : found), -1);
    const nextIndex =
        currentIndex >= 0
            ? currentIndex + 1 < chapters.length
                ? currentIndex + 1
                : -1
            : chapters.findIndex(chapter => chapter.start > frameTime + SAME_TIME);

    // 元の動画の時刻 time のフレームを表示する
    const seek = React.useCallback((time: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.max(0, time - (offsetRef.current ?? 0) + 0.001);
    }, []);

    // 時刻 time 以降の最初のフレームへ移る (チャプターの開始がフレームの途中にあっても、そのチャプターのフレームへ移る)
    const seekFrom = React.useCallback(
        (time: number) => {
            const index = ceilIndex(times, time);
            seek(index >= 0 ? times[index] : time);
        },
        [times, seek]
    );

    React.useEffect(() => {
        if (seekRequest) seekFrom(seekRequest.time);
    }, [seekRequest, seekFrom]);

    // 時刻 time 以前の最後のフレームへ移る (帯を押した位置)
    const seekNear = (time: number) => {
        const index = floorIndex(times, time);
        seek(index >= 0 ? times[index] : time);
    };

    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
    };

    const stepFrame = (delta: number) => {
        const target = times[frameIndex + delta];
        if (target !== undefined) seek(target);
    };

    const previousKeyframe = [...keyframes].reverse().find(time => time < frameTime - SAME_TIME);
    const nextKeyframe = keyframes.find(time => time > frameTime + SAME_TIME);

    // 今のチャプターの終了の位置 (終了以降の最初のフレーム。隙間なく続くなら次のチャプターの最初のフレーム) へ移る。
    // 終了が最後のフレームより後ろなら最後のフレームへ移る
    const seekChapterEnd = (chapter: EditChapter) => {
        const index = ceilIndex(times, chapter.end);
        if (times.length > 0) seek(times[index >= 0 ? index : times.length - 1]);
    };

    // チャプターの外では、再生位置から次のチャプターの開始 (無ければ動画の終わり) までのチャプターを作る
    const gapEnd = current ? null : nextIndex >= 0 ? chapters[nextIndex].start : durationSec;
    const setStart = () => {
        if (current) {
            if (!useVideoTrackTagStore.getState().setChapterStart(current.id, frameTime)) {
                showNotice('warning', t('videoTrackTagPage.cannotSetStart'));
            }
            return;
        }
        if (gapEnd === null || gapEnd <= frameTime + SAME_TIME) return;
        useVideoTrackTagStore.getState().addChapter({
            title: t('videoTrackTagPage.defaultChapterTitle', {
                number: (nextIndex >= 0 ? nextIndex : chapters.length) + 1,
            }),
            start: frameTime,
            end: gapEnd,
            tags: {},
        });
    };
    const setEnd = () => {
        if (!current) return;
        if (!useVideoTrackTagStore.getState().setChapterEnd(current.id, frameTime)) {
            showNotice('warning', t('videoTrackTagPage.cannotSetEnd'));
        }
    };

    const noFrames = times.length === 0 || failed;
    const videoWidth = Math.max(160, Math.min(space.width, space.height * aspect));
    const silent = muted || volume === 0;
    return (
        <Stack ref={rootRef} spacing={1} sx={{ alignItems: 'center', minWidth: 0, height: '100%' }}>
            {/* 動画と帯は同じ幅 */}
            <Box sx={{ width: videoWidth, flexShrink: 0 }}>
                <Box sx={{ position: 'relative', bgcolor: 'common.black', borderRadius: 1, overflow: 'hidden' }}>
                    {preview && (
                        <video
                            ref={videoRef}
                            src={preview.url}
                            preload='auto'
                            style={{ display: 'block', width: '100%', aspectRatio: String(aspect) }}
                            onLoadedMetadata={event => {
                                const video = event.currentTarget;
                                // 映像を読めない (コーデックに対応していない) 場合は大きさが 0 になる
                                if (video.videoWidth === 0 || video.videoHeight === 0) {
                                    setFailed(true);
                                    return;
                                }
                                setAspect(video.videoWidth / video.videoHeight);
                            }}
                            onError={() => setFailed(true)}
                            onPlay={() => setPlaying(true)}
                            onPause={() => setPlaying(false)}
                        />
                    )}
                    {failed && (
                        <Stack
                            spacing={1}
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                alignItems: 'center',
                                justifyContent: 'center',
                                p: 2,
                                color: 'common.white',
                                bgcolor: 'rgba(0, 0, 0, 0.75)',
                            }}
                        >
                            <Typography align='center'>{t('videoTrackTagPage.cannotPlay')}</Typography>
                            {!preview?.proxy && props.hasVideo && (
                                <Button variant='contained' onClick={props.onMakeProxy}>
                                    {t('videoTrackTagPage.makeProxy')}
                                </Button>
                            )}
                        </Stack>
                    )}
                </Box>
                <Stack ref={barsRef} spacing={0.5} sx={{ mt: 1 }}>
                    {props.hasAudio && (
                        <WaveformBar
                            waveform={props.waveform}
                            durationSec={durationSec}
                            position={frameTime}
                            onSeek={seekNear}
                            label={t('videoTrackTagPage.waveform')}
                        />
                    )}
                    <ChapterBar
                        chapters={chapters}
                        durationSec={durationSec}
                        position={frameTime}
                        currentId={currentId}
                        onSeek={seekNear}
                        label={t('videoTrackTagPage.chapterBar')}
                    />
                </Stack>
            </Box>

            <Stack ref={controlsRef} spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                <Stack
                    direction='row'
                    spacing={0.25}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}
                >
                    {/* 左から: 映像の先頭へ・前のチャプター・今のチャプターの開始へ・開始を再生位置に・前のキーフレームへ・
                        1 フレーム戻る、中央に再生、右はその逆の順 */}
                    <ControlButton
                        title={t('videoTrackTagPage.goStart')}
                        icon={<FirstPageIcon />}
                        disabled={noFrames}
                        onClick={() => seek(times[0])}
                    />
                    <ChapterNumberButton
                        number={previousIndex >= 0 && !failed ? previousIndex + 1 : null}
                        title={t('videoTrackTagPage.previousChapter')}
                        onClick={() => seekFrom(chapters[previousIndex].start)}
                    />
                    <ControlButton
                        chapter
                        title={t('videoTrackTagPage.goChapterStart')}
                        icon={<SkipPreviousIcon />}
                        disabled={!current || noFrames}
                        onClick={() => current && seekFrom(current.start)}
                    />
                    <ControlButton
                        chapter
                        title={t(current ? 'videoTrackTagPage.setStartHere' : 'videoTrackTagPage.startChapterHere')}
                        icon={<PanToolAltIcon />}
                        disabled={noFrames || (!current && (gapEnd === null || gapEnd <= frameTime + SAME_TIME))}
                        onClick={setStart}
                    />
                    <ControlButton
                        title={t('videoTrackTagPage.previousKeyframe')}
                        icon={<KeyIcon sx={{ transform: 'scaleX(-1)' }} />}
                        disabled={previousKeyframe === undefined || noFrames}
                        onClick={() => previousKeyframe !== undefined && seek(previousKeyframe)}
                    />
                    <ControlButton
                        title={t('videoTrackTagPage.previousFrame')}
                        icon={<ArrowLeftIcon />}
                        disabled={frameIndex <= 0 || noFrames}
                        onClick={() => stepFrame(-1)}
                    />
                    <Tooltip title={t(playing ? 'videoTrackTagPage.pause' : 'videoTrackTagPage.play')}>
                        <span>
                            <IconButton
                                aria-label={t(playing ? 'videoTrackTagPage.pause' : 'videoTrackTagPage.play')}
                                disabled={failed || !preview}
                                onClick={togglePlay}
                                sx={{
                                    mx: 1,
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                    '&:hover': { bgcolor: 'primary.dark' },
                                }}
                            >
                                {playing ? <PauseIcon fontSize='large' /> : <PlayArrowIcon fontSize='large' />}
                            </IconButton>
                        </span>
                    </Tooltip>
                    <ControlButton
                        title={t('videoTrackTagPage.nextFrame')}
                        icon={<ArrowRightIcon />}
                        disabled={frameIndex >= times.length - 1 || noFrames}
                        onClick={() => stepFrame(1)}
                    />
                    <ControlButton
                        title={t('videoTrackTagPage.nextKeyframe')}
                        icon={<KeyIcon />}
                        disabled={nextKeyframe === undefined || noFrames}
                        onClick={() => nextKeyframe !== undefined && seek(nextKeyframe)}
                    />
                    <ControlButton
                        chapter
                        title={t('videoTrackTagPage.setEndHere')}
                        icon={<PanToolAltIcon />}
                        disabled={!current || noFrames}
                        onClick={setEnd}
                    />
                    <ControlButton
                        chapter
                        title={t('videoTrackTagPage.goChapterEnd')}
                        icon={<SkipNextIcon />}
                        disabled={!current || noFrames}
                        onClick={() => current && seekChapterEnd(current)}
                    />
                    <ChapterNumberButton
                        number={nextIndex >= 0 && !failed ? nextIndex + 1 : null}
                        title={t('videoTrackTagPage.nextChapter')}
                        onClick={() => seekFrom(chapters[nextIndex].start)}
                    />
                    <ControlButton
                        title={t('videoTrackTagPage.goEnd')}
                        icon={<LastPageIcon />}
                        disabled={noFrames}
                        onClick={() => seek(times[times.length - 1])}
                    />
                </Stack>

                {/* 中央に再生位置の時刻とフレームの番号、右端にプレーヤーの音量 (動画と同じ幅) */}
                <Box
                    sx={{
                        width: videoWidth,
                        display: 'grid',
                        gridTemplateColumns: '1fr auto 1fr',
                        alignItems: 'center',
                    }}
                >
                    <Stack direction='row' spacing={1} sx={{ gridColumn: 2, alignItems: 'center' }}>
                        <Typography variant='body2' sx={{ fontFamily: 'monospace' }}>
                            {formatTime(frameTime)}
                        </Typography>
                        <Typography variant='body2' color='text.secondary' sx={{ fontFamily: 'monospace' }}>
                            {frameIndex >= 0 ? `${frameIndex}f` : ''}
                        </Typography>
                    </Stack>
                    <Stack direction='row' spacing={1} sx={{ justifySelf: 'end', alignItems: 'center', pr: 1 }}>
                        <ControlButton
                            title={t(silent ? 'videoTrackTagPage.unmute' : 'videoTrackTagPage.mute')}
                            icon={
                                silent ? (
                                    <VolumeOffIcon fontSize='small' />
                                ) : volume < 0.5 ? (
                                    <VolumeDownIcon fontSize='small' />
                                ) : (
                                    <VolumeUpIcon fontSize='small' />
                                )
                            }
                            onClick={() => {
                                const store = useVideoTrackTagStore.getState();
                                if (silent && volume === 0) store.setVolume(1);
                                else store.setMuted(!muted);
                            }}
                        />
                        <Slider
                            size='small'
                            min={0}
                            max={100}
                            value={silent ? 0 : Math.round(volume * 100)}
                            onChange={(_event, value) =>
                                useVideoTrackTagStore.getState().setVolume((value as number) / 100)
                            }
                            valueLabelDisplay='auto'
                            aria-label={t('videoTrackTagPage.volume')}
                            // つまみの見えない操作の範囲 (既定は 42px) が枠の下へはみ出してスクロールが出ないように小さくする
                            sx={{ width: 90, '& .MuiSlider-thumb::after': { width: 20, height: 20 } }}
                        />
                    </Stack>
                </Box>
            </Stack>
        </Stack>
    );
}
