import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    children: React.ReactNode;
    // 内側の余白をなくす (表や一覧をそのまま入れる場合)
    disablePadding?: boolean;
    sx?: SxProps<Theme>;
};

// 枠線付きの領域。ダッシュボードのカードと同じ角丸・枠線・余白に揃える。
export default function Panel({ children, disablePadding, sx }: Props) {
    return (
        <Box
            sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: 'background.paper',
                p: disablePadding ? 0 : 1.5,
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}
