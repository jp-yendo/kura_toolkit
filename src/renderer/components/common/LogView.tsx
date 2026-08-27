import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

// 1 行の高さ (px)。呼び出し側が行数から枠の高さを決められるよう公開する
export const LOG_LINE_HEIGHT_PX = 18;
// 上下パディングの合計 (px)。p: 1 = 8px なので 16px
export const LOG_PADDING_PX = 16;

type Props = {
    lines: string[];
    // 追記されていくログでは末尾へ自動スクロールしたいが、
    // 全行が定期的に書き換わる用途ではユーザーのスクロール操作と競合するため切れるようにする
    autoScroll?: boolean;
    // 既定は折り返し。false にすると折り返さず横スクロールになる
    // (パスのように 1 行で通して読みたいもの向け)
    wrap?: boolean;
    sx?: SxProps<Theme>;
};

// 等幅フォントのログ表示 (既定では追加時に自動で末尾へスクロール)
export default function LogView({ lines, autoScroll = true, wrap = true, sx }: Props) {
    const boxRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!autoScroll) return;
        const element = boxRef.current;
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    }, [lines, autoScroll]);

    return (
        <Box
            ref={boxRef}
            sx={{
                fontFamily: 'Consolas, Menlo, monospace',
                fontSize: '0.75rem',
                // 行数から高さを計算できるよう px で固定する
                lineHeight: `${LOG_LINE_HEIGHT_PX}px`,
                whiteSpace: wrap ? 'pre-wrap' : 'pre',
                wordBreak: wrap ? 'break-all' : 'normal',
                overflow: 'auto',
                bgcolor: 'action.hover',
                borderRadius: 1,
                p: 1,
                minHeight: 80,
                maxHeight: 200,
                ...sx,
            }}
        >
            {lines.join('\n')}
        </Box>
    );
}
