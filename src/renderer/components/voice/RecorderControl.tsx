import React from 'react';
import { Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import LevelMeter from './LevelMeter';
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

// 録音・停止のボタンの高さ (px)。録音のボタン (MUI の通常の大きさの枠線付きのボタン) に合わせ、録音中も行の高さを変えない
const CONTROL_HEIGHT = 36.5;

// マイク録音のボタンと入力レベル。録音を止めると、main が書き終えた録音 (16bit の WAV) を渡す
export default function RecorderControl({ onRecorded, onActiveChange, disabled, label }: Props) {
    const { t } = useTranslation();
    // 書き込みに失敗して録音が途中で終わった場合も、録音中の扱いを解く
    const recorder = useRecorder({ onAbort: () => onActiveChange?.(false) });
    const recording = recorder.state === 'recording';
    // 録音の開始・停止の途中 (ボタンの表示が変わる前に、もう一度押されても受け付けないため)
    const busy = React.useRef(false);

    const start = async () => {
        if (busy.current) return;
        busy.current = true;
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
            busy.current = false;
            if (!started) onActiveChange?.(false);
        }
    };

    const stop = async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            const audio = await recorder.stop();
            if (audio) onRecorded(audio);
        } finally {
            busy.current = false;
            onActiveChange?.(false);
        }
    };

    // 録音をやめて捨てる (保存しない。録り直しの場合は前の音声が残る)
    const cancel = () => {
        recorder.cancel();
        onActiveChange?.(false);
    };

    return (
        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', minHeight: CONTROL_HEIGHT }}>
            {/* 録音中は、停止・メーター・ピークの値・経過時間・キャンセルを同じ間隔で並べる */}
            {recording ? (
                <>
                    {/* 幅を取らないよう、録音中の停止はアイコンだけにする (何をするかはツールチップと読み上げの名前で示す) */}
                    <Tooltip title={t('voice.recorder.stop')}>
                        <IconButton
                            aria-label={t('voice.recorder.stop')}
                            onClick={() => void stop()}
                            sx={{
                                width: CONTROL_HEIGHT,
                                height: CONTROL_HEIGHT,
                                p: 0,
                                bgcolor: 'error.main',
                                color: 'error.contrastText',
                                '&:hover': { bgcolor: 'error.dark' },
                            }}
                        >
                            <StopIcon />
                        </IconButton>
                    </Tooltip>
                    <LevelMeter
                        level={recorder.level}
                        trailing={
                            <>
                                <Typography
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                                >
                                    {formatDuration(recorder.elapsed)}
                                </Typography>
                                {/* キャンセルは経過時間の右。ボタンの内側の余白を詰め、見た目の間隔をほかとそろえる */}
                                <Tooltip title={t('voice.recorder.cancel')}>
                                    <IconButton
                                        size='small'
                                        aria-label={t('voice.recorder.cancel')}
                                        onClick={cancel}
                                        sx={{ p: 0.25 }}
                                    >
                                        <CloseIcon fontSize='small' />
                                    </IconButton>
                                </Tooltip>
                            </>
                        }
                    />
                </>
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
            {recorder.error && (
                <Typography variant='caption' color='error'>
                    {t('voice.recorder.error', { detail: recorder.error })}
                </Typography>
            )}
        </Stack>
    );
}
