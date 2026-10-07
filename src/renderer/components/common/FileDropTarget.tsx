import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useFileDrop } from '../../hooks/useFileDrop';

type Props = {
    onFiles(paths: string[]): void;
    // 受け付ける拡張子 (小文字、ドットなし)
    accept: string[];
    multiple?: boolean;
    // 対象外の形式だけがドロップされたときの通知
    onRejected(): void;
    disabled?: boolean;
    sx?: SxProps<Theme>;
    children: React.ReactNode;
};

// 中身 (一覧など) にファイルをドロップして渡す枠。FileDropZone と違ってクリックでは何もせず、見た目も変えない。
// ドラッグしている間だけ、枠の外周を強調する
export default function FileDropTarget({ onFiles, accept, multiple, onRejected, disabled, sx, children }: Props) {
    const { dragOver, handlers } = useFileDrop({ onFiles, accept, multiple, onRejected, disabled });
    return (
        <Box
            {...handlers}
            sx={{
                borderRadius: 2,
                outline: 2,
                outlineStyle: 'dashed',
                outlineOffset: 2,
                outlineColor: dragOver ? 'primary.main' : 'transparent',
                transition: 'outline-color 0.15s',
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}
