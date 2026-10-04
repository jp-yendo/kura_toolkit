import React from 'react';
import { Box, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';

export type PlayerSource = {
    // 再生対象を識別するキー (候補 ID と対象の組み合わせなど)
    key: string;
    url: string;
    // 再生中の対象として表示する名前
    label: string;
};

type Props = {
    source: PlayerSource | null;
    // 再生対象が無いときの案内
    emptyHint?: string;
};

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// 同期再生のプレーヤー。再生対象 (候補や出力) を切り替えても再生位置と再生中かどうかを引き継ぐ。
// 2 つの audio 要素を交互に使い、切り替え先を読み込んで同じ位置へ合わせてから入れ替えるため、
// 切り替えの瞬間に音が途切れる時間を短くできる。
export default function SyncPlayer({ source, emptyHint }: Props) {
    const { t } = useTranslation();
    const audioRefs = [React.useRef<HTMLAudioElement>(null), React.useRef<HTMLAudioElement>(null)];
    const [active, setActive] = React.useState(0);
    const activeRef = React.useRef(0);
    const [playing, setPlaying] = React.useState(false);
    const playingRef = React.useRef(false);
    const [position, setPosition] = React.useState(0);
    const positionRef = React.useRef(0);
    const [duration, setDuration] = React.useState(0);
    // 再生位置のつまみをドラッグしている間は、再生位置の更新でつまみを動かさない
    const [dragValue, setDragValue] = React.useState<number | null>(null);
    const loadedUrl = React.useRef<string | null>(null);

    const current = () => audioRefs[activeRef.current].current;

    // 再生中は描画のたびに位置を更新する (timeupdate は間隔が粗いため)
    React.useEffect(() => {
        if (!playing) return;
        let frame = 0;
        const tick = () => {
            const audio = current();
            if (audio) {
                positionRef.current = audio.currentTime;
                setPosition(audio.currentTime);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- audio 要素の ref は再生中に変わらない
    }, [playing]);

    // 再生対象の切り替え。位置と再生状態を引き継ぐ
    React.useEffect(() => {
        const url = source?.url ?? null;
        if (url === loadedUrl.current) return;
        loadedUrl.current = url;
        const previous = current();
        if (!url) {
            previous?.pause();
            if (previous) previous.removeAttribute('src');
            setPlaying(false);
            playingRef.current = false;
            setDuration(0);
            return;
        }
        const nextIndex = previous && previous.getAttribute('src') ? 1 - activeRef.current : activeRef.current;
        const next = audioRefs[nextIndex].current;
        if (!next) return;
        const resumeAt = positionRef.current;
        const resume = playingRef.current;
        let cancelled = false;
        const onLoaded = () => {
            if (cancelled) return;
            const target = Number.isFinite(next.duration) ? Math.min(resumeAt, next.duration) : resumeAt;
            setDuration(Number.isFinite(next.duration) ? next.duration : 0);
            const swap = () => {
                if (cancelled) return;
                if (previous && previous !== next) previous.pause();
                activeRef.current = nextIndex;
                setActive(nextIndex);
                if (resume) {
                    void next.play().catch(() => undefined);
                }
            };
            if (Math.abs(next.currentTime - target) < 0.01) {
                swap();
            } else {
                next.addEventListener('seeked', swap, { once: true });
                next.currentTime = target;
            }
        };
        next.addEventListener('loadedmetadata', onLoaded, { once: true });
        next.src = url;
        next.load();
        return () => {
            cancelled = true;
            next.removeEventListener('loadedmetadata', onLoaded);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- audio 要素の ref は変わらない
    }, [source?.url]);

    const togglePlay = () => {
        const audio = current();
        if (!audio || !audio.getAttribute('src')) return;
        if (playingRef.current) {
            audio.pause();
            playingRef.current = false;
            setPlaying(false);
        } else {
            if (audio.ended) audio.currentTime = 0;
            void audio.play().catch(() => undefined);
            playingRef.current = true;
            setPlaying(true);
        }
    };

    const stop = () => {
        const audio = current();
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        positionRef.current = 0;
        setPosition(0);
        playingRef.current = false;
        setPlaying(false);
    };

    const seek = (value: number) => {
        const audio = current();
        positionRef.current = value;
        setPosition(value);
        if (audio) audio.currentTime = value;
    };

    const handleEnded = (index: number) => {
        if (index !== activeRef.current) return;
        playingRef.current = false;
        setPlaying(false);
    };

    const disabled = !source;
    const shownPosition = dragValue ?? position;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
            }}
        >
            {[0, 1].map(index => (
                <audio
                    key={index}
                    ref={audioRefs[index]}
                    preload='auto'
                    onEnded={() => handleEnded(index)}
                    onDurationChange={event => {
                        if (index === active) setDuration(event.currentTarget.duration || 0);
                    }}
                />
            ))}
            <Tooltip title={playing ? t('voice.player.pause') : t('voice.player.play')}>
                <span>
                    <IconButton
                        color='primary'
                        aria-label={playing ? t('voice.player.pause') : t('voice.player.play')}
                        onClick={togglePlay}
                        disabled={disabled}
                    >
                        {playing ? <PauseIcon /> : <PlayArrowIcon />}
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('voice.player.stop')}>
                <span>
                    <IconButton size='small' aria-label={t('voice.player.stop')} onClick={stop} disabled={disabled}>
                        <StopIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography
                    variant='body2'
                    color={source ? 'text.primary' : 'text.secondary'}
                    sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.6 }}
                >
                    {source ? source.label : (emptyHint ?? t('voice.player.empty'))}
                </Typography>
                <Slider
                    size='small'
                    min={0}
                    max={Math.max(duration, 0.001)}
                    step={0.01}
                    value={Math.min(shownPosition, Math.max(duration, 0.001))}
                    disabled={disabled}
                    onChange={(_event, value) => setDragValue(value as number)}
                    onChangeCommitted={(_event, value) => {
                        setDragValue(null);
                        seek(value as number);
                    }}
                    aria-label={t('voice.player.position')}
                />
            </Stack>
            <Typography
                variant='body2'
                color='text.secondary'
                sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
            >
                {formatTime(shownPosition)} / {formatTime(duration)}
            </Typography>
        </Box>
    );
}
