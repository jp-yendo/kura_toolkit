import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import { useRecorder, type RecordedAudio } from './useRecorder';
import { formatDuration } from './voiceFormat';
import { showNotice } from '../../stores/noticeStore';

type Props = {
    onRecorded(audio: RecordedAudio): void;
    // 録音の開始操作から終了までの間 true を知らせる (録音中に変えてはいけない操作を止めるため)
    onActiveChange?(active: boolean): void;
    disabled?: boolean;
    label?: string;
};

// マイク録音のボタンと入力レベル。録音を止めると 16bit の WAV を渡す
export default function RecorderControl({ onRecorded, onActiveChange, disabled, label }: Props) {
    const { t } = useTranslation();
    const recorder = useRecorder();
    const recording = recorder.state === 'recording';

    const start = async () => {
        onActiveChange?.(true);
        let started = false;
        try {
            // macOS ではマイクの利用を OS に許可してもらう必要がある
            const allowed = await window.kuraToolkit.voice.requestMicrophone();
            if (!allowed) {
                showNotice('error', t('voice.recorder.denied'), 10000);
                return;
            }
            started = await recorder.start();
        } finally {
            if (!started) onActiveChange?.(false);
        }
    };

    const stop = () => {
        const audio = recorder.stop();
        if (audio) onRecorded(audio);
        onActiveChange?.(false);
    };

    return (
        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
            {recording ? (
                <Button variant='contained' color='error' startIcon={<StopIcon />} onClick={stop}>
                    {t('voice.recorder.stop')}
                </Button>
            ) : (
                <Button
                    variant='outlined'
                    color='error'
                    startIcon={<FiberManualRecordIcon />}
                    disabled={disabled || recorder.state === 'starting'}
                    onClick={() => void start()}
                >
                    {label ?? t('voice.recorder.start')}
                </Button>
            )}
            {recording && (
                <Box sx={{ width: 160 }}>
                    <LinearProgress
                        variant='determinate'
                        value={Math.min(100, recorder.level * 100)}
                        color={recorder.level > 0.95 ? 'error' : 'primary'}
                    />
                    <Typography variant='caption' color='text.secondary'>
                        {formatDuration(recorder.elapsed)}
                        {recorder.level > 0.95 ? ` ${t('voice.recorder.clipping')}` : ''}
                    </Typography>
                </Box>
            )}
            {recorder.error && (
                <Typography variant='caption' color='error'>
                    {t('voice.recorder.error', { detail: recorder.error })}
                </Typography>
            )}
        </Stack>
    );
}
