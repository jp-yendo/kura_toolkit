import React from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import type { TrackTagWaveform } from '@shared/types';

type Props = {
    // 波形 (解析している間は null)
    waveform: TrackTagWaveform | null;
    durationSec: number;
    // 再生位置 (秒)
    position: number;
    // 押した位置の時刻へ移る
    onSeek(time: number): void;
    // 波形の名前 (読み上げ用)
    label: string;
};

// 波形の高さ (px)。ステレオは上下に半分ずつ使う
const WAVEFORM_HEIGHT = 44;

// プレビューの幅いっぱいに音声の波形をチャンネルごとに描き (ステレオは上が左、下が右)、再生位置に線を引く
// (押した位置の時刻へ移る)。大きさはすべてのチャンネルの最大を段の高さいっぱいにして示す。解析している間はその旨を示す
export default function WaveformBar({ waveform, durationSec, position, onSeek, label }: Props) {
    const theme = useTheme();
    const { t } = useTranslation();
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = React.useState(0);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const observer = new ResizeObserver(() => setWidth(canvas.clientWidth));
        observer.observe(canvas);
        setWidth(canvas.clientWidth);
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || width === 0) return;
        const ratio = window.devicePixelRatio || 1;
        const columns = Math.round(width * ratio);
        const height = Math.round(WAVEFORM_HEIGHT * ratio);
        canvas.width = columns;
        canvas.height = height;
        context.clearRect(0, 0, columns, height);
        if (!waveform || waveform.step <= 0 || durationSec <= 0 || waveform.channels.length === 0) return;
        const { channels, step } = waveform;
        const top = channels.reduce((max, peaks) => peaks.reduce((m, peak) => Math.max(m, peak), max), 0);
        if (top <= 0) return;
        const laneHeight = height / channels.length;
        context.fillStyle = theme.palette.text.secondary;
        channels.forEach((peaks, lane) => {
            const middle = laneHeight * (lane + 0.5);
            for (let x = 0; x < columns; x += 1) {
                // この列が表す時刻の範囲に入る区間の最大
                const from = Math.floor(((x / columns) * durationSec) / step);
                const to = Math.max(from + 1, Math.ceil((((x + 1) / columns) * durationSec) / step));
                let peak = 0;
                for (let i = from; i < to && i < peaks.length; i += 1) peak = Math.max(peak, peaks[i]);
                const half = Math.max(0.5, (peak / top) * (laneHeight / 2 - ratio));
                context.fillRect(x, middle - half, 1, half * 2);
            }
        });
        // 段の境目
        context.fillStyle = theme.palette.divider;
        for (let lane = 1; lane < channels.length; lane += 1) {
            context.fillRect(0, Math.round(laneHeight * lane), columns, Math.max(1, Math.round(ratio)));
        }
    }, [waveform, durationSec, width, theme.palette.text.secondary, theme.palette.divider]);

    const percent = `${Math.min(100, Math.max(0, (position / Math.max(durationSec, 0.001)) * 100))}%`;
    return (
        <Box
            role='img'
            aria-label={label}
            aria-busy={waveform === null}
            onClick={event => {
                if (durationSec <= 0) return;
                const rect = event.currentTarget.getBoundingClientRect();
                onSeek(((event.clientX - rect.left) / rect.width) * durationSec);
            }}
            sx={{
                position: 'relative',
                height: WAVEFORM_HEIGHT,
                borderRadius: 1,
                bgcolor: 'action.hover',
                cursor: 'pointer',
                overflow: 'hidden',
            }}
        >
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: WAVEFORM_HEIGHT }} />
            {waveform === null && (
                <Stack
                    direction='row'
                    spacing={1}
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'text.secondary',
                        pointerEvents: 'none',
                    }}
                >
                    <CircularProgress size={14} color='inherit' />
                    <Typography variant='body2'>{t('videoTrackTagPage.analyzingWaveform')}</Typography>
                </Stack>
            )}
            {durationSec > 0 && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: percent,
                        width: 2,
                        ml: '-1px',
                        bgcolor: 'text.primary',
                        pointerEvents: 'none',
                    }}
                />
            )}
        </Box>
    );
}
