import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    children: React.ReactNode;
    // 内側の余白をなくす (表や一覧をそのまま入れる場合)
    disablePadding?: boolean;
    sx?: SxProps<Theme>;
    // 選んでいる状態 (枠を強調色にする。枠の太さは変えず、内側の影で太く見せるため、配置はずれない)
    selected?: boolean;
    // 枠全体をクリックで選べる場合
    onClick?: React.MouseEventHandler<HTMLDivElement>;
};

// 枠線付きの領域。ダッシュボードのカードと同じ角丸・枠線・余白に揃える。
export default function Panel({ children, disablePadding, sx, selected, onClick }: Props) {
    return (
        <Box
            onClick={onClick}
            // クリックで選べる場合は、キーボード (Enter / Space) と読み上げソフトでも選べるようにする
            {...(onClick
                ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-pressed': !!selected,
                      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onClick(event as unknown as React.MouseEvent<HTMLDivElement>);
                          }
                      },
                  }
                : {})}
            sx={{
                border: 1,
                borderColor: selected ? 'primary.main' : 'divider',
                boxShadow: selected ? theme => `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
                borderRadius: 2,
                bgcolor: 'background.paper',
                p: disablePadding ? 0 : 1.5,
                cursor: onClick ? 'pointer' : undefined,
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}
