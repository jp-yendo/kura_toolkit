import { Dialog } from '@mui/material';
import type { DialogProps } from '@mui/material';

type Props = Omit<DialogProps, 'onClose'> & {
    // 閉じる操作 (Esc キー、または呼び出し側のボタン) で呼ばれる
    onClose?(): void;
};

// アプリ共通のダイアログ。**ダイアログ外のクリックでは閉じない**。
// 結果や確認の内容を読まないまま閉じてしまうのを防ぐため、閉じる操作は明示的なボタンに限る。
export default function AppDialog({ onClose, children, ...rest }: Props) {
    return (
        <Dialog
            {...rest}
            onClose={(_event, reason) => {
                if (reason === 'backdropClick') return;
                onClose?.();
            }}
        >
            {children}
        </Dialog>
    );
}
