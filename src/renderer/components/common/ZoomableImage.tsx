import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

// 倍率の下限・上限とホイール 1 段あたりの倍率
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 16;
const WHEEL_STEP = 1.2;
// 表示の中心がこれ (px) 未満しかずれていないときはスクロールし直さない
const CENTER_EPSILON_PX = 0.5;

// 倍率を扱える範囲 (0.05〜16 倍) に収める
export function clampScale(scale: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// 枠の中心に表示している画像の位置 (画像の幅・高さに対する 0-1 の割合)
export type ViewCenter = { x: number; y: number };

export type ImageSize = { width: number; height: number };

type Props = {
    src: string | null;
    alt: string;
    // null = 全体表示 (枠に収める)。数値 = 実寸に対する倍率
    scale: number | null;
    onScaleChange(scale: number | null): void;
    // 実際に表示している倍率を親へ返す (全体表示のときは枠に収まる倍率)
    onEffectiveScaleChange?(scale: number): void;
    // 画像の実寸を親へ返す (読み込むまでは null)
    onNaturalSizeChange?(size: ImageSize | null): void;
    // 表示の中心。渡すと、その位置が枠の中心に来るようにスクロールする
    center?: ViewCenter;
    // 利用者の操作 (スクロール・ドラッグ・ホイール) で表示が変わったときに、倍率と表示の中心を返す。
    // 渡すと、ホイールはカーソルの下の位置を保って拡大縮小し、onScaleChange の代わりにこれを呼ぶ
    onViewChange?(view: { scale: number | null; center: ViewCenter }): void;
    // src が無いときに表示する内容
    placeholder?: React.ReactNode;
    sx?: SxProps<Theme>;
    // 画像の要素に付ける見た目 (背景・画素の補間など)
    imageSx?: SxProps<Theme>;
};

// 画像の拡大縮小表示。ホイールで拡大縮小、はみ出しているときはドラッグで移動できる。
export default function ZoomableImage({
    src,
    alt,
    scale,
    onScaleChange,
    onEffectiveScaleChange,
    onNaturalSizeChange,
    center,
    onViewChange,
    placeholder,
    sx,
    imageSx,
}: Props) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const imageRef = React.useRef<HTMLImageElement>(null);
    const [natural, setNatural] = React.useState<ImageSize | null>(null);
    const [viewport, setViewport] = React.useState<ImageSize | null>(null);
    const [panning, setPanning] = React.useState(false);
    // ドラッグ開始時のポインタ位置とスクロール位置
    const panOrigin = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    // 表示の中心に合わせてスクロールした位置 (そのスクロールの知らせを、利用者の操作として返さないため)
    const appliedScroll = React.useRef<{ left: number; top: number } | null>(null);

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

    const naturalNotifyRef = React.useRef(onNaturalSizeChange);
    naturalNotifyRef.current = onNaturalSizeChange;
    React.useEffect(() => {
        naturalNotifyRef.current?.(natural);
    }, [natural]);

    // 全体表示の倍率。実寸より大きくは拡大しない (objectFit: contain + maxWidth と同じ見え方)
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

    const displayWidth = natural ? natural.width * effectiveScale : undefined;
    const displayHeight = natural ? natural.height * effectiveScale : undefined;

    // 今の表示の中心 (画像を表示していないときは null)
    const currentCenter = (): ViewCenter | null => {
        const element = containerRef.current;
        const image = imageRef.current;
        if (!element || !image || !displayWidth || !displayHeight) return null;
        return {
            x: (element.scrollLeft + element.clientWidth / 2 - image.offsetLeft) / displayWidth,
            y: (element.scrollTop + element.clientHeight / 2 - image.offsetTop) / displayHeight,
        };
    };

    // 表示の中心を渡されたときは、その位置が枠の中心に来るようにスクロールする (表示の大きさや枠が変わったときも)
    const centerX = center?.x;
    const centerY = center?.y;
    React.useLayoutEffect(() => {
        const element = containerRef.current;
        const image = imageRef.current;
        if (centerX === undefined || centerY === undefined) return;
        if (!element || !image || !displayWidth || !displayHeight) return;
        const left = image.offsetLeft + centerX * displayWidth - element.clientWidth / 2;
        const top = image.offsetTop + centerY * displayHeight - element.clientHeight / 2;
        if (
            Math.abs(element.scrollLeft - left) < CENTER_EPSILON_PX &&
            Math.abs(element.scrollTop - top) < CENTER_EPSILON_PX
        ) {
            return;
        }
        element.scrollLeft = left;
        element.scrollTop = top;
        // 端で止まった位置を覚える (スクロールの知らせはこの位置で届く)
        appliedScroll.current = { left: element.scrollLeft, top: element.scrollTop };
    }, [centerX, centerY, displayWidth, displayHeight, viewport]);

    // ホイールの処理は最新の値で行う (登録し直さずに済むよう ref に持つ)
    const wheelRef = React.useRef<(event: WheelEvent) => void>(() => undefined);
    wheelRef.current = (event: WheelEvent) => {
        // ホイールは拡大縮小に割り当てる (横だけの動き (タッチパッドの横スクロールなど) はスクロールのまま)
        if (!src || event.deltaY === 0) return;
        event.preventDefault();
        const nextScale = clampScale(effectiveScale * (event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
        const element = containerRef.current;
        const image = imageRef.current;
        if (!onViewChange || !element || !image || !natural || !displayWidth || !displayHeight) {
            onScaleChange(nextScale);
            return;
        }
        // カーソルの下の画像の位置が、拡大縮小した後もカーソルの下に来る表示の中心
        const rect = element.getBoundingClientRect();
        const cursorX = event.clientX - rect.left - element.clientLeft;
        const cursorY = event.clientY - rect.top - element.clientTop;
        const pointX = (element.scrollLeft + cursorX - image.offsetLeft) / displayWidth;
        const pointY = (element.scrollTop + cursorY - image.offsetTop) / displayHeight;
        onViewChange({
            scale: nextScale,
            center: {
                x: pointX + (element.clientWidth / 2 - cursorX) / (natural.width * nextScale),
                y: pointY + (element.clientHeight / 2 - cursorY) / (natural.height * nextScale),
            },
        });
    };

    // React の onWheel は passive で登録され preventDefault が効かないため、直接登録する
    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const handleWheel = (event: WheelEvent) => wheelRef.current(event);
        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleWheel);
    }, []);

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
            onScroll={() => {
                if (!onViewChange) return;
                const element = containerRef.current;
                const applied = appliedScroll.current;
                // 表示の中心に合わせたスクロールは、利用者の操作として返さない
                if (
                    element &&
                    applied &&
                    Math.abs(element.scrollLeft - applied.left) < 1 &&
                    Math.abs(element.scrollTop - applied.top) < 1
                ) {
                    return;
                }
                appliedScroll.current = null;
                const view = currentCenter();
                if (view) onViewChange({ scale, center: view });
            }}
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
                // 画像の位置 (offsetLeft / offsetTop) をこの枠からの位置で測る
                position: 'relative',
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
                    ref={imageRef}
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
                        ...imageSx,
                    }}
                />
            ) : (
                <Box sx={{ m: 'auto', p: 2, textAlign: 'center' }}>{placeholder}</Box>
            )}
        </Box>
    );
}
