import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    children: React.ReactNode;
    sx?: SxProps<Theme>;
};

// 全画面共通のページ枠。余白と要素間の間隔をここで一元化する。
// 画面タイトルはタイトルバーに表示するため、ページ側には見出しを置かない。
export default function PageContainer({ children, sx }: Props) {
    return (
        <Box
            sx={{
                p: 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                // 内容が収まるときは画面いっぱいに広げ、収まらないときはページ側でスクロールする
                minHeight: '100%',
                boxSizing: 'border-box',
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}
