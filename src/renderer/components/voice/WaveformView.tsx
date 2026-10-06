import React from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { WaveformData } from '@shared/voice/types';

// プレビューの波形と再生位置。波形の上に時間の区切り (小さい区切りと、時間を添えた大きい区切り) と現在位置の線を描く。
// クリック・ドラッグでその位置へ移動する (キーボードでは左右の矢印で前後、Home / End で先頭・末尾)。
// 表示領域の高さは固定で、ステレオは上下に 2 本、モノラルは 1 本で使う

const HEIGHT_PX = 72;
// 大きい区切りの間隔 (秒) と、その間の小さい区切りの間隔の候補。区切りが多すぎず、間隔が狭すぎないものを選ぶ
// (例: 5 分の音声は 1 分ごとの大きい区切りと 30 秒ごとの小さい区切り)
const TICK_STEPS: [number, number][] = [
    [1, 0.5],
    [2, 1],
    [5, 1],
    [10, 5],
    [15, 5],
    [30, 10],
    [60, 30],
    [120, 60],
    [300, 60],
    [600, 300],
    [900, 300],
    [1800, 600],
    [3600, 1800],
];
const MAX_MAJOR_TICKS = 8;
const MIN_MAJOR_SPACING_PX = 64;
const KEY_STEP_SEC = 5;
const LABEL_FONT_PX = 10;

type Props = {
    data: WaveformData | null;
    duration: number;
    position: number;
    disabled: boolean;
    label: string;
    valueText: string;
    // commit = false はドラッグ中 (表示だけを動かす)、true は確定
    onSeek(value: number, commit: boolean): void;
};

function chooseTicks(duration: number, width: number): [number, number] {
    for (const [major, minor] of TICK_STEPS) {
        if (duration / major <= MAX_MAJOR_TICKS && (width * major) / duration >= MIN_MAJOR_SPACING_PX) {
            return [major, minor];
        }
    }
    const hours = Math.max(1, Math.ceil(duration / 3600 / MAX_MAJOR_TICKS));
    return [hours * 3600, hours * 1800];
}

// 区切りの時間 (分:秒。1 時間以上は時:分:秒)
function formatTick(seconds: number): string {
    const total = Math.round(seconds);
    const s = String(total % 60).padStart(2, '0');
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}:${s}`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}

// 波形を描いた画像
function drawWave(data: WaveformData, width: number, height: number, color: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.fillStyle = color;
    const lanes = data.channels;
    const laneHeight = height / lanes;
    const buckets = data.peaks[0].length / 2;
    for (let lane = 0; lane < lanes; lane++) {
        const peaks = data.peaks[lane];
        const center = laneHeight * lane + laneHeight / 2;
        const half = laneHeight / 2;
        for (let x = 0; x < width; x++) {
            const from = Math.floor((x * buckets) / width);
            const to = Math.max(from + 1, Math.floor(((x + 1) * buckets) / width));
            let min = 0;
            let max = 0;
            for (let bucket = from; bucket < to && bucket < buckets; bucket++) {
                min = Math.min(min, peaks[bucket * 2]);
                max = Math.max(max, peaks[bucket * 2 + 1]);
            }
            const top = center - Math.min(1, max) * half;
            const bottom = center - Math.max(-1, min) * half;
            ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
    }
    return canvas;
}

export default function WaveformView({ data, duration, position, disabled, label, valueText, onSeek }: Props) {
    const theme = useTheme();
    const boxRef = React.useRef<HTMLDivElement>(null);
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = React.useState(0);
    const dragging = React.useRef(false);
    const lastValue = React.useRef(0);
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(HEIGHT_PX * dpr);

    React.useEffect(() => {
        const box = boxRef.current;
        if (!box) return;
        const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    const waveColor = theme.palette.primary.main;
    // 波形と区切りは、データ・大きさ・色が変わったときだけ描き直す (再生位置の更新では重ねるだけ)
    const layers = React.useMemo(() => {
        if (pixelWidth <= 0) return null;
        const grid = document.createElement('canvas');
        grid.width = pixelWidth;
        grid.height = pixelHeight;
        // 区切りの時間は波形に隠れないよう、波形の上に重ねる別の画像に描く
        const labels = document.createElement('canvas');
        labels.width = pixelWidth;
        labels.height = pixelHeight;
        const ctx = grid.getContext('2d');
        const labelCtx = labels.getContext('2d');
        if (ctx && labelCtx) {
            const lanes = data?.channels ?? 1;
            // チャンネルごとの中心線と、ステレオの上下の境目
            ctx.fillStyle = theme.palette.divider;
            for (let lane = 0; lane < lanes; lane++) {
                ctx.fillRect(
                    0,
                    Math.floor((pixelHeight / lanes) * (lane + 0.5)),
                    pixelWidth,
                    Math.max(1, Math.round(dpr))
                );
                if (lane > 0)
                    ctx.fillRect(0, Math.floor((pixelHeight / lanes) * lane), pixelWidth, Math.max(1, Math.round(dpr)));
            }
            if (duration > 0) {
                const [major, minor] = chooseTicks(duration, width);
                const line = Math.max(1, Math.round(dpr));
                labelCtx.font = `${LABEL_FONT_PX * dpr}px ${theme.typography.fontFamily}`;
                labelCtx.textBaseline = 'bottom';
                labelCtx.lineJoin = 'round';
                labelCtx.lineWidth = 3 * dpr;
                labelCtx.strokeStyle = theme.palette.background.paper;
                labelCtx.fillStyle = theme.palette.text.primary;
                const count = Math.floor(duration / minor + 1e-9);
                for (let index = 0; index <= count; index++) {
                    const time = index * minor;
                    const x = Math.round((time / duration) * pixelWidth);
                    const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-9;
                    ctx.fillStyle = alpha(theme.palette.text.primary, isMajor ? 0.28 : 0.1);
                    ctx.fillRect(x, 0, line, pixelHeight);
                    if (isMajor) {
                        // 波形の上でも読めるよう、背景色で縁取る
                        const text = formatTick(time);
                        labelCtx.strokeText(text, x + 3 * dpr, pixelHeight - 2 * dpr);
                        labelCtx.fillText(text, x + 3 * dpr, pixelHeight - 2 * dpr);
                    }
                }
            }
        }
        return { grid, labels, wave: data ? drawWave(data, pixelWidth, pixelHeight, waveColor) : null };
    }, [data, duration, width, pixelWidth, pixelHeight, dpr, waveColor, theme]);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !layers) return;
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, pixelWidth, pixelHeight);
        ctx.drawImage(layers.grid, 0, 0);
        const x = duration > 0 ? Math.round((Math.min(position, duration) / duration) * pixelWidth) : 0;
        if (layers.wave) ctx.drawImage(layers.wave, 0, 0);
        ctx.drawImage(layers.labels, 0, 0);
        if (!disabled) {
            const lineWidth = Math.max(1, Math.round(2 * dpr));
            ctx.fillStyle = theme.palette.text.primary;
            ctx.fillRect(Math.min(pixelWidth - lineWidth, Math.max(0, x - lineWidth / 2)), 0, lineWidth, pixelHeight);
        }
    }, [layers, position, duration, disabled, pixelWidth, pixelHeight, dpr, theme]);

    const valueAt = (clientX: number): number => {
        const rect = boxRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || duration <= 0) return 0;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return ratio * duration;
    };

    const inactive = disabled || duration <= 0;

    return (
        <Box
            ref={boxRef}
            role='slider'
            tabIndex={inactive ? -1 : 0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.min(position, duration)}
            aria-valuetext={valueText}
            aria-disabled={inactive}
            onPointerDown={event => {
                if (inactive || event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragging.current = true;
                lastValue.current = valueAt(event.clientX);
                onSeek(lastValue.current, false);
            }}
            onPointerMove={event => {
                if (!dragging.current) return;
                lastValue.current = valueAt(event.clientX);
                onSeek(lastValue.current, false);
            }}
            onPointerUp={event => {
                if (!dragging.current) return;
                dragging.current = false;
                event.currentTarget.releasePointerCapture(event.pointerId);
                onSeek(valueAt(event.clientX), true);
            }}
            onPointerCancel={() => {
                if (!dragging.current) return;
                dragging.current = false;
                onSeek(lastValue.current, true);
            }}
            onKeyDown={event => {
                if (inactive) return;
                const step =
                    event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                        ? -KEY_STEP_SEC
                        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
                          ? KEY_STEP_SEC
                          : null;
                let value: number | null = null;
                if (step !== null) value = Math.min(duration, Math.max(0, position + step));
                else if (event.key === 'Home') value = 0;
                else if (event.key === 'End') value = duration;
                if (value === null) return;
                event.preventDefault();
                onSeek(value, true);
            }}
            sx={{
                position: 'relative',
                height: HEIGHT_PX,
                borderRadius: 1,
                overflow: 'hidden',
                bgcolor: 'action.hover',
                cursor: inactive ? 'default' : 'pointer',
                touchAction: 'none',
                '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
            }}
        >
            <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
            />
        </Box>
    );
}
