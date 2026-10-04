import React from 'react';
import { Box, Button, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import ProgressDialog from '../common/ProgressDialog';
import { itemLabel } from './libraryItems';
import { formatBytes } from './voiceFormat';
import { isCancelledError, voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { notifyVoiceLibraryChanged } from '../../stores/voiceLibraryStore';
import type { LibraryItem } from '@shared/voice/types';

// アプリの更新で音声機能のダウンロード物の更新が必要になった場合、更新後の初回起動時に確認する。
// 許可を得てからダウンロードして展開する (同じバージョンでは起動のたびに確認しない)
export default function VoiceUpdatePrompt() {
    const { t } = useTranslation();
    const [items, setItems] = React.useState<LibraryItem[] | null>(null);
    const { job, run, cancel } = useJobRunner();

    React.useEffect(() => {
        let cancelled = false;
        void window.kuraToolkit.voice.library
            .getPendingUpdates()
            .then(result => {
                if (!cancelled && result.promptNeeded) setItems(result.items);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const close = () => {
        setItems(null);
        void window.kuraToolkit.voice.library.markUpdatePrompted();
    };

    const update = async () => {
        const ids = (items ?? []).map(item => item.id);
        close();
        try {
            const result = await run(t('voice.library.downloading'), jobId =>
                window.kuraToolkit.voice.library.download(jobId, ids)
            );
            const failed = result.results.filter(item => !item.ok && !item.cancelled);
            if (failed.length > 0) showNotice('error', t('voice.update.failed'), 10000);
            else if (!result.cancelled) showNotice('success', t('voice.update.done'));
        } catch (error) {
            if (!isCancelledError(error)) showNotice('error', voiceErrorMessage(t, error), 10000);
        } finally {
            notifyVoiceLibraryChanged();
        }
    };

    const total = (items ?? []).reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);

    return (
        <>
            <AppDialog open={items !== null} onClose={close} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.update.title')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.update.message', { size: formatBytes(total) })}
                    </Typography>
                    <Box component='ul' sx={{ m: 0, pl: 2.5 }}>
                        {(items ?? []).map(item => (
                            <Typography component='li' variant='body2' key={item.id}>
                                {itemLabel(t, item)} ({formatBytes(item.sizeBytes)})
                            </Typography>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={close}>{t('voice.update.later')}</Button>
                    <Button variant='contained' onClick={() => void update()}>
                        {t('voice.update.run')}
                    </Button>
                </DialogActions>
            </AppDialog>
            <ProgressDialog open={job !== null} title={job?.title ?? ''} percent={job?.percent} onCancel={cancel} />
        </>
    );
}
