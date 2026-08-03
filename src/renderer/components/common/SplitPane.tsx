import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    top: React.ReactNode;
    bottom: React.ReactNode;
    // 上側が占める初期比率 (0-1)
    initialRatio?: number;
    // 上下それぞれに残す最小の比率
    minRatio?: number;
    sx?: SxProps<Theme>;
};

// 上下 2 分割の領域。間の仕切りをドラッグして高さの配分を変えられる。
// 各領域は縦並びのフレックスコンテナとして子を受け取る。
export default function SplitPane({ top, bottom, initialRatio = 0.5, minRatio = 0.15, sx }: Props) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [ratio, setRatio] = React.useState(initialRatio);
    const [dragging, setDragging] = React.useState(false);

    const updateRatio = (clientY: number) => {
        const element = containerRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0) return;
        const next = (clientY - rect.top) / rect.height;
        setRatio(Math.min(1 - minRatio, Math.max(minRatio, next)));
    };

    const paneSx = { display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 } as const;

    return (
        <Box
            ref={containerRef}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                // ドラッグ中に文字が選択されるのを防ぐ
                userSelect: dragging ? 'none' : undefined,
                ...sx,
            }}
        >
            <Box sx={{ ...paneSx, flex: `${ratio} 1 0` }}>{top}</Box>

            <Box
                onPointerDown={event => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                }}
                onPointerMove={event => {
                    if (dragging) updateRatio(event.clientY);
                }}
                onPointerUp={event => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    setDragging(false);
                }}
                sx={{
                    flex: '0 0 auto',
                    height: 16,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'row-resize',
                    touchAction: 'none',
                    '&:hover .split-pane-bar': { bgcolor: 'primary.main' },
                }}
            >
                <Box
                    className='split-pane-bar'
                    sx={{
                        width: '100%',
                        height: 4,
                        borderRadius: 2,
                        bgcolor: dragging ? 'primary.main' : 'divider',
                        transition: 'background-color 0.15s',
                    }}
                />
            </Box>

            <Box sx={{ ...paneSx, flex: `${1 - ratio} 1 0` }}>{bottom}</Box>
        </Box>
    );
}
