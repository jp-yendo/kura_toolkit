import React from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { TTS_TRAINING_STEPS, ttsEpochsForSteps } from '@shared/voice/types';

type Props = {
    open: boolean;
    // 学習に使う音声の数と、学習のバッチサイズ (学習と同じ値)
    clips: number;
    batchSize: number;
    onClose(): void;
    // 確定: 計算した学習回数を渡す
    onConfirm(epochs: number): void;
};

// 学習回数をステップ数から計算する (読み上げの学習)。ステップ数を入れると学習回数を示し、確定で元の画面の学習回数に
// 入れる。キャンセルでは何もしない。ステップ数は開くたびに初期値から始める
export default function EpochsFromStepsDialog({ open, clips, batchSize, onClose, onConfirm }: Props) {
    const { t } = useTranslation();
    const [stepsText, setStepsText] = React.useState(String(TTS_TRAINING_STEPS.default));
    React.useEffect(() => {
        if (open) setStepsText(String(TTS_TRAINING_STEPS.default));
    }, [open]);
    const steps = /^\d+$/.test(stepsText) ? Number(stepsText) : NaN;
    const stepsValid = Number.isInteger(steps) && steps >= TTS_TRAINING_STEPS.min && steps <= TTS_TRAINING_STEPS.max;
    const epochs = stepsValid ? ttsEpochsForSteps(steps, clips, batchSize) : null;
    return (
        <AppDialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
            <DialogTitle>{t('voice.training.epochsFromStepsTitle')}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <TextField
                        autoFocus
                        size='small'
                        label={t('voice.training.steps')}
                        value={stepsText}
                        error={!stepsValid}
                        onChange={event => setStepsText(event.target.value.trim())}
                        slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                    />
                    <Typography variant='body1'>
                        {t('voice.training.epochsResult', { epochs: epochs ?? '-' })}
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button
                    variant='contained'
                    disabled={epochs === null}
                    onClick={() => {
                        if (epochs !== null) onConfirm(epochs);
                    }}
                >
                    {t('voice.training.epochsConfirm')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
