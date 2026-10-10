import React from 'react';
import { Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    children: React.ReactNode;
    // 見出しの右端に置くボタンなど
    action?: React.ReactNode;
    sx?: SxProps<Theme>;
};

// 画面内のセクション見出し。ダッシュボードのカテゴリ見出しと同じ体裁に揃える。
// 見出しは 1 行で、入りきらない分は末尾を省略する
export default function SectionLabel({ children, action, sx }: Props) {
    return (
        <Stack direction='row' sx={{ justifyContent: 'space-between', alignItems: 'center', minHeight: 28, ...sx }}>
            <Typography
                variant='overline'
                noWrap
                sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.6, minWidth: 0 }}
            >
                {children}
            </Typography>
            {action}
        </Stack>
    );
}
