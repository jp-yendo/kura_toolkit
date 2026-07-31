import { Alert, Snackbar } from '@mui/material';

type Props = {
    // 表示する文言。null なら非表示
    message: string | null;
    severity: 'success' | 'info' | 'warning' | 'error';
    onClose(): void;
    // 自動で閉じるまでの時間 (ミリ秒)
    autoHideDuration?: number;
};

// アプリ全体で共通の通知。表示位置を 1 か所に固定して、
// どの画面でも同じ場所 (右下) に出るようにする。
export default function NoticeSnackbar({ message, severity, onClose, autoHideDuration = 6000 }: Props) {
    return (
        <Snackbar
            open={message !== null}
            autoHideDuration={autoHideDuration}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
            <Alert severity={severity} onClose={onClose} variant='filled' sx={{ maxWidth: 520 }}>
                {message}
            </Alert>
        </Snackbar>
    );
}
