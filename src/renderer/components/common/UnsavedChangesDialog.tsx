import { Button, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from './AppDialog';
import { useConfirmPendingAction, useNavigationGuardStore } from '../../stores/navigationGuard';

// 保存していない入力がある状態で、別の機能へ移る前・アプリを閉じる前の確認
export default function UnsavedChangesDialog() {
    const { t } = useTranslation();
    const pending = useNavigationGuardStore(state => state.pending);
    const setPending = useNavigationGuardStore(state => state.setPending);
    const confirm = useConfirmPendingAction();
    const closing = pending?.kind === 'close';
    return (
        <AppDialog open={pending !== null} onClose={() => setPending(null)} maxWidth='xs' fullWidth>
            <DialogTitle>{t('common.unsavedTitle')}</DialogTitle>
            <DialogContent>
                <Typography variant='body2'>
                    {t(closing ? 'common.unsavedCloseMessage' : 'common.unsavedMessage')}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setPending(null)}>{t('common.cancel')}</Button>
                <Button variant='contained' color='warning' onClick={confirm}>
                    {t(closing ? 'common.discardAndClose' : 'common.discardAndLeave')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
