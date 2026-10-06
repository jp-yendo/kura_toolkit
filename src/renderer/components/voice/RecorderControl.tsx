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

// マイク録音のボタンと入力レベル。録音を止めると、main が書き終えた録音 (16bit の WAV) を渡す
export default function RecorderControl({ onRecorded, onActiveChange, disabled, label }: Props) {
    const { t } = useTranslation();
    // 書き込みに失敗して録音が途中で終わった場合も、録音中の扱いを解く
    const recorder = useRecorder({ onAbort: () => onActiveChange?.(false) });
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

    const stop = async () => {
        try {
            const audio = await recorder.stop();
            if (audio) onRecorded(audio);
        } finally {
            onActiveChange?.(false);
        }
    };

    return (
        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
            {recording ? (
                <Button variant='contained' color='error' startIcon={<StopIcon />} onClick={() => void stop()}>
                    {t('voice.recorder.stop')}
                </Button>
            ) : (
                <Button
                    variant='outlined'
                    color='error'
                    startIcon={<FiberManualRecordIcon />}
                    disabled={disabled || recorder.state === 'starting' || recorder.state === 'stopping'}
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
