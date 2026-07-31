import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    lines: string[];
    sx?: SxProps<Theme>;
};

// 等幅フォントのログ表示 (追加時に自動で末尾へスクロール)
export default function LogView({ lines, sx }: Props) {
    const boxRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const element = boxRef.current;
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    }, [lines]);

    return (
        <Box
            ref={boxRef}
            sx={{
                fontFamily: 'Consolas, Menlo, monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
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
