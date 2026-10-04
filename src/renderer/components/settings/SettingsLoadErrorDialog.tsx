import React from 'react';
import { Alert, Button, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { showNotice } from '../../stores/noticeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { SettingsLoadError } from '@shared/types';

type Props = {
    error: SettingsLoadError;
};

// 設定ファイルを読み込めなかった場合に、起動時に出す確認。読み込めなかったファイルは上書きせず、
// 既定の設定で続ける (ファイルは別の名前で残す) か、アプリを終了するかを選んでもらう
export default function SettingsLoadErrorDialog({ error }: Props) {
    const { t } = useTranslation();
    const resetBroken = useSettingsStore(state => state.resetBroken);
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState<string | null>(null);

    const continueWithDefaults = async () => {
        setBusy(true);
        setFailure(null);
        try {
            const kept = await resetBroken();
            showNotice('info', t('settingsLoadError.kept', { path: kept }), 12000);
        } catch (caught) {
            setFailure(caught instanceof Error ? caught.message : String(caught));
            setBusy(false);
        }
    };

    return (
        <AppDialog open maxWidth='sm' fullWidth>
            <DialogTitle>{t('settingsLoadError.title')}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('settingsLoadError.message')}
                    </Typography>
                    <Typography
                        variant='caption'
                        color='text.secondary'
                        sx={{ display: 'block', wordBreak: 'break-all', fontFamily: 'Consolas, Menlo, monospace' }}
                    >
                        {error.path}
                        <br />
                        {error.message}
                    </Typography>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('settingsLoadError.keepNote')}
                    </Typography>
                    {failure && <Alert severity='error'>{failure}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button disabled={busy} onClick={() => void window.kuraToolkit.quitApp()}>
                    {t('settingsLoadError.quit')}
                </Button>
                <Button variant='contained' disabled={busy} onClick={() => void continueWithDefaults()}>
                    {t('settingsLoadError.continue')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
