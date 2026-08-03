import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

// 倍率の下限・上限とホイール 1 段あたりの倍率
const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const WHEEL_STEP = 1.2;

// 倍率を扱える範囲に収める (呼び出し側のズームボタンでも使う)
export function clampScale(scale: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

type Props = {
    src: string | null;
    alt: string;
    // null = 全体表示 (枠に収める)。数値 = 実寸に対する倍率
    scale: number | null;
    onScaleChange(scale: number | null): void;
    // 実際に表示している倍率を親へ返す (全体表示のときは枠に収まる倍率)
    onEffectiveScaleChange?(scale: number): void;
    // src が無いときに表示する内容
    placeholder?: React.ReactNode;
    sx?: SxProps<Theme>;
};

// 画像の拡大縮小表示。Ctrl + ホイールで拡大縮小、はみ出しているときはドラッグで移動できる。
export default function ZoomableImage({ src, alt, scale, onScaleChange, onEffectiveScaleChange, placeholder, sx }: Props) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
    const [viewport, setViewport] = React.useState<{ width: number; height: number } | null>(null);
    const [panning, setPanning] = React.useState(false);
    // ドラッグ開始時のポインタ位置とスクロール位置
    const panOrigin = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);

    // 枠の大きさを監視する (全体表示の倍率計算に使う)
    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const observer = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            setViewport({ width: rect.width, height: rect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // 画像が変わったら実寸を測り直す
    React.useEffect(() => {
        setNatural(null);
    }, [src]);

    // 全体表示の倍率。実寸より大きくは拡大しない (元実装の objectFit: contain + maxWidth と同じ見え方)
    const fitScale =
        natural && viewport && natural.width > 0 && natural.height > 0
            ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height)
            : 1;
    const effectiveScale = scale ?? fitScale;

    // 親へ返すコールバックは毎回作られる可能性があるため、ref 経由にして値が変わったときだけ通知する
    const notifyRef = React.useRef(onEffectiveScaleChange);
    notifyRef.current = onEffectiveScaleChange;
    React.useEffect(() => {
        notifyRef.current?.(effectiveScale);
    }, [effectiveScale]);

    // React の onWheel は passive で登録され preventDefault が効かないため、直接登録する
    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const handleWheel = (event: WheelEvent) => {
            // 通常のホイールはスクロールに使い、Ctrl + ホイールだけ拡大縮小に割り当てる
            if (!event.ctrlKey) return;
            event.preventDefault();
            onScaleChange(clampScale(effectiveScale * (event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP)));
        };
        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleWheel);
    }, [effectiveScale, onScaleChange]);

    const displayWidth = natural ? natural.width * effectiveScale : undefined;
    const displayHeight = natural ? natural.height * effectiveScale : undefined;
    // 枠からはみ出しているときだけドラッグで移動できる
    const pannable =
        !!displayWidth &&
        !!displayHeight &&
        !!viewport &&
        (displayWidth > viewport.width + 1 || displayHeight > viewport.height + 1);

    const endPan = (event: React.PointerEvent) => {
        if (!panOrigin.current) return;
        panOrigin.current = null;
        setPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    return (
        <Box
            ref={containerRef}
            onPointerDown={event => {
                const element = containerRef.current;
                if (!element || !pannable) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                panOrigin.current = {
                    x: event.clientX,
                    y: event.clientY,
                    left: element.scrollLeft,
                    top: element.scrollTop,
                };
                setPanning(true);
            }}
            onPointerMove={event => {
                const element = containerRef.current;
                const origin = panOrigin.current;
                if (!element || !origin) return;
                element.scrollLeft = origin.left - (event.clientX - origin.x);
                element.scrollTop = origin.top - (event.clientY - origin.y);
            }}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            sx={{
                display: 'flex',
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
                overflow: 'auto',
                cursor: pannable ? (panning ? 'grabbing' : 'grab') : 'default',
                ...sx,
            }}
        >
            {src ? (
                <Box
                    component='img'
                    src={src}
                    alt={alt}
                    draggable={false}
                    onLoad={event =>
                        setNatural({
                            // SVG に width/height が無い場合はブラウザの既定値 (300x150) になる
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                        })
                    }
                    sx={{
                        // はみ出したときに左上が切れないよう、中央寄せは margin で行う
                        m: 'auto',
                        flexShrink: 0,
                        maxWidth: 'none',
                        width: displayWidth,
                        height: displayHeight,
                    }}
                />
            ) : (
                <Box sx={{ m: 'auto', p: 2, textAlign: 'center' }}>{placeholder}</Box>
            )}
        </Box>
    );
}
