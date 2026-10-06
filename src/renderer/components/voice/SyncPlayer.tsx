import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import WaveformView from './WaveformView';
import type { WaveformData } from '@shared/voice/types';

export type PlayerSource = {
    // 再生対象を識別するキー (候補 ID と対象の組み合わせなど)
    key: string;
    url: string;
};

type Props = {
    source: PlayerSource | null;
    // 行の右端に置く操作 (再生している対象の保存など)
    actions?: React.ReactNode;
    // 再生対象を切り替えたときに、再生位置と再生中かどうかを引き継ぐか (候補を聞き比べる場合)。
    // false の場合は、新しい再生対象を先頭から、止めた状態で示す (作り直した音声を差し替える場合)
    keepPosition?: boolean;
};

// 再生位置と長さの表示。音声編集ソフトの一般的な表記に合わせ、ミリ秒まで示す (分:秒.ミリ秒。1 時間以上は時:分:秒.ミリ秒)
function formatTime(seconds: number): string {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : 0;
    const ms = String(total % 1000).padStart(3, '0');
    const s = String(Math.floor(total / 1000) % 60).padStart(2, '0');
    const minutes = Math.floor(total / 60000);
    if (minutes < 60) return `${minutes}:${s}.${ms}`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}.${ms}`;
}

// 同期再生のプレーヤー。再生対象 (候補や出力) を切り替えても再生位置と再生中かどうかを引き継ぐ。
// 2 つの audio 要素を交互に使い、切り替え先を読み込んで同じ位置へ合わせてから入れ替えるため、
// 切り替えの瞬間に音が途切れる時間を短くできる。
// 再生・停止ボタンの内側の余白 (テーマの間隔の単位)
const PLAYER_BUTTON_PADDING = 0.5;

// 画面の中で同時に鳴らすのは 1 つだけにする (プレーヤーを並べたときに、ほかを止めずに再生すると音が重なるため)。
// 再生を始めたプレーヤーが自分の ID を知らせ、ほかのプレーヤーは止まる
const playbackBus = new EventTarget();
const PLAYBACK_STARTED = 'kura-playback-started';

export default function SyncPlayer({ source, actions, keepPosition = true }: Props) {
    const { t } = useTranslation();
    const playerId = React.useId();
    const audioRefs = [React.useRef<HTMLAudioElement>(null), React.useRef<HTMLAudioElement>(null)];
    const [active, setActive] = React.useState(0);
    const activeRef = React.useRef(0);
    // 実際に鳴っているか (audio 要素の playing / pause の通知で切り替える。押した時点では切り替えない)
    const [playing, setPlaying] = React.useState(false);
    const playingRef = React.useRef(false);
    // 再生対象を読み込み終えたか (読み込み終えるまで再生させない。再生を始めてから読み込みを待って止まるのを避けるため)
    const [ready, setReady] = React.useState(false);
    const [position, setPosition] = React.useState(0);
    const positionRef = React.useRef(0);
    const [duration, setDuration] = React.useState(0);
    // 波形の上をドラッグしている間は、ドラッグしている位置を示す (再生位置の更新では動かさない)
    const [dragValue, setDragValue] = React.useState<number | null>(null);
    // 再生対象の波形。切り替え先の波形ができるまでは前の波形を示す (切り替えのたびに消えてちらつかないように)
    const [waveform, setWaveform] = React.useState<WaveformData | null>(null);
    const loadedUrl = React.useRef<string | null>(null);
    // 作り直した音声へ差し替えるときに止めた前の audio 要素。その停止の通知 (非同期に届く) で、
    // 先頭へ戻した再生位置を前の音声の位置で上書きしないようにする
    const replacedRef = React.useRef<HTMLAudioElement | null>(null);

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

    React.useEffect(() => {
        const url = source?.url ?? null;
        if (!url) {
            setWaveform(null);
            return;
        }
        let cancelled = false;
        window.kuraToolkit.voice.media
            .waveform(url)
            .then(data => {
                if (!cancelled) setWaveform(data);
            })
            .catch(() => {
                // 波形は表示の補助のため、作れない場合は波形なしで再生だけを続ける
                if (!cancelled) setWaveform(null);
            });
        return () => {
            cancelled = true;
        };
    }, [source?.url]);

    // 再生対象の切り替え。位置と再生状態を引き継ぐ
    React.useEffect(() => {
        const url = source?.url ?? null;
        if (url === loadedUrl.current) return;
        loadedUrl.current = url;
        const previous = current();
        setReady(false);
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
        if (!keepPosition) {
            if (previous && !previous.paused) replacedRef.current = previous;
            previous?.pause();
            playingRef.current = false;
            setPlaying(false);
            positionRef.current = 0;
            setPosition(0);
        }
        const resumeAt = positionRef.current;
        const resume = playingRef.current;
        let cancelled = false;
        let loaded = false;
        const onLoaded = () => {
            if (cancelled) return;
            loaded = true;
            const target = Number.isFinite(next.duration) ? Math.min(resumeAt, next.duration) : resumeAt;
            setDuration(Number.isFinite(next.duration) ? next.duration : 0);
            const swap = () => {
                if (cancelled) return;
                if (previous && previous !== next) previous.pause();
                activeRef.current = nextIndex;
                setActive(nextIndex);
                // 全体を読み込み終えてから再生できるようにする
                if (next.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
                    setReady(true);
                } else {
                    next.addEventListener(
                        'canplaythrough',
                        () => {
                            if (!cancelled) setReady(true);
                        },
                        { once: true }
                    );
                }
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
            // 読み込みを待つ途中で止めた場合は、同じ対象でも次に読み込み直す (読み込み済みとして扱うと、
            // 読み込み終わりの通知を受けられず再生できないままになる。開発時の StrictMode は効果を 2 回実行する)
            if (!loaded) loadedUrl.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- audio 要素の ref は変わらない
    }, [source?.url]);

    // 再生中かどうかの表示は、実際に鳴り始めた・止まった通知 (handlePlaying / handlePause) で切り替える
    const togglePlay = () => {
        const audio = current();
        if (!audio || !audio.getAttribute('src')) return;
        if (!audio.paused) {
            audio.pause();
        } else {
            if (audio.ended) audio.currentTime = 0;
            void audio.play().catch(() => undefined);
        }
    };

    const stop = () => {
        const audio = current();
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        positionRef.current = 0;
        setPosition(0);
    };

    const handlePlaying = (index: number) => {
        if (index !== activeRef.current) return;
        playingRef.current = true;
        setPlaying(true);
        playbackBus.dispatchEvent(new CustomEvent(PLAYBACK_STARTED, { detail: playerId }));
    };

    // ほかのプレーヤーが再生を始めたら止まる
    React.useEffect(() => {
        const onStarted = (event: Event) => {
            if ((event as CustomEvent<string>).detail === playerId) return;
            const audio = audioRefs[activeRef.current].current;
            if (audio && !audio.paused) audio.pause();
        };
        playbackBus.addEventListener(PLAYBACK_STARTED, onStarted);
        return () => playbackBus.removeEventListener(PLAYBACK_STARTED, onStarted);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- audio 要素の ref は変わらない
    }, [playerId]);

    // 止まった位置をそのまま示す (描画のたびの更新は止まるため)
    const handlePause = (index: number) => {
        const audio = audioRefs[index].current;
        if (audio && audio === replacedRef.current) {
            replacedRef.current = null;
            return;
        }
        if (index !== activeRef.current) return;
        playingRef.current = false;
        setPlaying(false);
        if (audio) {
            positionRef.current = audio.currentTime;
            setPosition(audio.currentTime);
        }
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
                // 左右の端と各要素の間の見た目の間隔は、すべてこの 1 種類にそろえる
                gap: 2,
                px: 2,
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
                    onPlaying={() => handlePlaying(index)}
                    onPause={() => handlePause(index)}
                    onEnded={() => handleEnded(index)}
                    onDurationChange={event => {
                        if (index === active) setDuration(event.currentTarget.duration || 0);
                    }}
                />
            ))}
            {/* 再生と停止は同じ大きさにそろえる。ボタンの内側の余白は負のマージンで打ち消し、
                外側の間隔が見た目どおりになるようにする */}
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, mx: -PLAYER_BUTTON_PADDING }}>
                <Tooltip title={playing ? t('voice.player.pause') : t('voice.player.play')}>
                    <span>
                        <IconButton
                            color='primary'
                            sx={{ p: PLAYER_BUTTON_PADDING }}
                            aria-label={playing ? t('voice.player.pause') : t('voice.player.play')}
                            onClick={togglePlay}
                            disabled={disabled || !ready}
                        >
                            {playing ? <PauseIcon /> : <PlayArrowIcon />}
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={t('voice.player.stop')}>
                    <span>
                        <IconButton
                            sx={{ p: PLAYER_BUTTON_PADDING }}
                            aria-label={t('voice.player.stop')}
                            onClick={stop}
                            disabled={disabled}
                        >
                            <StopIcon />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <WaveformView
                    data={source ? waveform : null}
                    duration={duration}
                    position={shownPosition}
                    disabled={disabled}
                    label={t('voice.player.position')}
                    valueText={formatTime(shownPosition)}
                    onSeek={(value, commit) => {
                        if (!commit) {
                            setDragValue(value);
                            return;
                        }
                        setDragValue(null);
                        seek(value);
                    }}
                />
            </Box>
            <Typography
                variant='body2'
                color='text.secondary'
                sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
            >
                {formatTime(shownPosition)} / {formatTime(duration)}
            </Typography>
            {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
        </Box>
    );
}
