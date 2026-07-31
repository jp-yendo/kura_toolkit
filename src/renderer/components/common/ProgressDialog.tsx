import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

type Props = {
    open: boolean;
    title: string;
    // 0-100。未指定なら不確定表示
    percent?: number;
    // n/m 件表示
    current?: number;
    total?: number;
    // 処理状況を表す短い一行 (件数など)
    status?: string;
    // 現在の処理対象。長さが変わってもダイアログの高さは変えない
    message?: string;
    // 省略時はキャンセルボタンを表示しない (キャンセル不可の処理)
    onCancel?(): void;
};

// メッセージ欄に確保する行数 (パスの長さでダイアログの高さが変わらないようにする)
const MESSAGE_LINES = 2;
const MESSAGE_LINE_HEIGHT = 1.5;

// キャンセル可能な進捗ダイアログ
export default function ProgressDialog({
    open,
    title,
    percent,
    current,
    total,
    status,
    message,
    onCancel,
}: Props) {
    const { t } = useTranslation();
    const showMessageArea = message !== undefined || status !== undefined;

    return (
        <Dialog open={open} maxWidth='sm' fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Box sx={{ mb: 1 }}>
                    {percent !== undefined ? (
                        <LinearProgress variant='determinate' value={Math.max(0, Math.min(100, percent))} />
                    ) : (
                        <LinearProgress />
                    )}
                </Box>
                {current !== undefined && total !== undefined && (
                    <Typography variant='body2' color='text.secondary'>
                        {current} / {total}
                    </Typography>
                )}
                {status !== undefined && (
                    <Typography variant='body2' color='text.secondary'>
                        {status}
                    </Typography>
                )}
                {showMessageArea && (
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{
                            // 常に同じ高さを確保し、収まらない分は末尾を省略する
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: MESSAGE_LINES,
                            overflow: 'hidden',
                            wordBreak: 'break-all',
                            lineHeight: MESSAGE_LINE_HEIGHT,
                            height: `${MESSAGE_LINES * MESSAGE_LINE_HEIGHT}em`,
                        }}
                    >
                        {message ?? ''}
                    </Typography>
                )}
            </DialogContent>
            {onCancel && (
                <DialogActions>
                    <Button onClick={onCancel}>{t('common.cancel')}</Button>
                </DialogActions>
            )}
        </Dialog>
    );
}
