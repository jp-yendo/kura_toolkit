import React from 'react';
import { Alert, Box, Slide } from '@mui/material';
import UpdateNotifier from '../UpdateNotifier';
import { useNoticeStore } from '../../stores/noticeStore';

// 通知の表示領域。アプリ全体で右下の 1 か所に集約し、
// アップデート通知と画面内の一時通知が重ならないよう縦に積み重ねる。
export default function NotificationArea() {
    const { notice, clear } = useNoticeStore();

    // 一定時間で自動的に閉じる
    React.useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(clear, notice.autoHideDuration);
        return () => window.clearTimeout(timer);
    }, [notice, clear]);

    return (
        <Box
            sx={{
                position: 'fixed',
                right: 24,
                bottom: 24,
                zIndex: theme => theme.zIndex.snackbar,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 1,
                // 通知が無い領域はクリックを通す
                pointerEvents: 'none',
                '& > *': { pointerEvents: 'auto' },
            }}
        >
            <Slide direction='left' in={notice !== null} mountOnEnter unmountOnExit>
                <Alert severity={notice?.severity ?? 'info'} onClose={clear} sx={{ maxWidth: 520, boxShadow: 6 }}>
                    {notice?.message}
                </Alert>
            </Slide>
            <UpdateNotifier />
        </Box>
    );
}
