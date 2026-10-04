import React from 'react';
import {
    Alert,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SchoolIcon from '@mui/icons-material/School';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import SectionLabel from '../../components/common/SectionLabel';
import AppDialog from '../../components/common/AppDialog';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import RecorderControl from '../../components/voice/RecorderControl';
import SyncPlayer from '../../components/voice/SyncPlayer';
import { trainingAudioFilters } from '../../components/voice/audioInput';
import { formatDuration } from '../../components/voice/voiceFormat';
import { isCancelledError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { trainingStatus } from '../../components/voice/trainingProgress';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import type { DatasetItem, VoiceModelInfo } from '@shared/voice/types';

// 外す項目の確認。閉じる間も表示が変わらないよう、開閉とは別に持つ
type RemoveConfirm = { open: boolean; item: DatasetItem | null };

// 音声変換 (RVC) のモデルの学習。学習用の音声はマイク録音か音声ファイルの指定で用意する
// (指定したファイルは元の場所から読む。録音と一覧は学習が終わると main 側で破棄される)
export default function RvcTrainingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const readiness = useFeatureReadiness('conversionTraining');
    const [items, setItems] = React.useState<DatasetItem[]>([]);
    const [playing, setPlaying] = React.useState<DatasetItem | null>(null);
    const [name, setName] = React.useState('');
    const [confirmClear, setConfirmClear] = React.useState(false);
    const [removeConfirm, setRemoveConfirm] = React.useState<RemoveConfirm>({ open: false, item: null });
    const [created, setCreated] = React.useState<VoiceModelInfo | null>(null);
    const { job, run, cancel } = useJobRunner();
    const ready = readiness.readiness?.ready ?? false;

    const load = React.useCallback(async () => {
        setItems(await window.kuraToolkit.voice.training.rvcDataset());
    }, []);
    React.useEffect(() => {
        void load();
    }, [load]);

    const total = items.reduce((sum, item) => sum + item.durationSec, 0);

    const addFiles = async () => {
        const paths = await window.kuraToolkit.dialog.openFiles({ filters: trainingAudioFilters(t), multi: true });
        if (paths.length === 0) return;
        try {
            await run(t('voice.training.adding'), jobId => window.kuraToolkit.voice.training.rvcAddFiles(jobId, paths));
            await load();
        } catch (error) {
            if (!isCancelledError(error)) showNotice('error', voiceErrorMessage(t, error));
            await load();
        }
    };

    const removeItem = async (item: DatasetItem) => {
        await window.kuraToolkit.voice.training.rvcRemove(item.id);
        if (playing?.id === item.id) setPlaying(null);
        await load();
    };

    // 録音は外すと消えるため確認する。指定したファイルは一覧から外すだけなので、そのまま外す
    const askRemove = (item: DatasetItem) => {
        if (item.recorded) setRemoveConfirm({ open: true, item });
        else void removeItem(item);
    };

    const startTraining = async () => {
        try {
            const info = await run(t('voice.training.running'), jobId =>
                window.kuraToolkit.voice.training.rvcStart(jobId, name)
            );
            setCreated(info);
            setName('');
        } catch (error) {
            if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
            else showNotice('error', voiceErrorMessage(t, error), 15000);
        } finally {
            // 学習が終わると (成否・キャンセルを問わず) 一覧は空になるため読み直す
            setPlaying(null);
            await load();
        }
    };

    return (
        <PageContainer>
            <VoiceFeatureHeader feature='conversion' />
            <Stack spacing={2} sx={{ maxWidth: 1000, mx: 'auto', width: '100%' }}>
                <ReadinessAlert state={readiness} />
                <Alert severity='info'>{t('voice.training.rvcGuide')}</Alert>

                <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                    <RecorderControl
                        disabled={job !== null}
                        onRecorded={async audio => {
                            try {
                                await window.kuraToolkit.voice.training.rvcAddRecording(
                                    audio.wav,
                                    t('voice.training.recordingName', { date: new Date().toLocaleString() })
                                );
                                await load();
                            } catch (error) {
                                showNotice('error', voiceErrorMessage(t, error));
                            }
                        }}
                    />
                    <Button
                        variant='outlined'
                        startIcon={<AddIcon />}
                        disabled={job !== null}
                        onClick={() => void addFiles()}
                    >
                        {t('voice.training.addFiles')}
                    </Button>
                </Stack>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.5 }}>
                    {t('voice.training.rvcDatasetNote')}
                </Typography>

                {/* すべて外す操作は、追加や学習の操作から離して一覧の見出しに置く */}
                <SectionLabel
                    action={
                        <Button
                            size='small'
                            color='inherit'
                            startIcon={<DeleteSweepIcon />}
                            disabled={items.length === 0 || job !== null}
                            onClick={() => setConfirmClear(true)}
                        >
                            {t('voice.training.clear')}
                        </Button>
                    }
                >
                    {t('voice.training.dataset', { count: items.length, duration: formatDuration(total) })}
                </SectionLabel>
                <Panel disablePadding sx={{ maxHeight: 360, overflow: 'auto' }}>
                    {items.length === 0 ? (
                        <Typography variant='body2' color='text.secondary' sx={{ p: 2 }}>
                            {t('voice.training.datasetEmpty')}
                        </Typography>
                    ) : (
                        <Table size='small' stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t('voice.training.itemName')}</TableCell>
                                    <TableCell align='right'>{t('voice.training.duration')}</TableCell>
                                    <TableCell padding='checkbox' />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {items.map(item => (
                                    <TableRow
                                        key={item.id}
                                        hover
                                        selected={playing?.id === item.id}
                                        onClick={() => setPlaying(item)}
                                        sx={{ cursor: 'pointer' }}
                                    >
                                        <TableCell>{item.name}</TableCell>
                                        <TableCell align='right'>{formatDuration(item.durationSec)}</TableCell>
                                        <TableCell padding='checkbox'>
                                            <Tooltip title={t('voice.training.removeItem')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('voice.training.removeItem')}
                                                        disabled={job !== null}
                                                        onClick={event => {
                                                            event.stopPropagation();
                                                            askRemove(item);
                                                        }}
                                                    >
                                                        <DeleteOutlineIcon fontSize='small' />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </Panel>
                <SyncPlayer
                    source={playing ? { key: playing.id, url: playing.media.url, label: playing.name } : null}
                    emptyHint={t('voice.training.playHint')}
                />
                {total > 0 && total < 600 && <Alert severity='warning'>{t('voice.training.rvcShort')}</Alert>}

                <Panel>
                    <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
                        <TextField
                            size='small'
                            label={t('voice.training.modelName')}
                            value={name}
                            onChange={event => setName(event.target.value)}
                            sx={{ flexGrow: 1 }}
                        />
                        <Button
                            variant='contained'
                            startIcon={<SchoolIcon />}
                            disabled={!ready || job !== null || !name.trim() || items.length === 0}
                            onClick={() => void startTraining()}
                        >
                            {t('voice.training.start')}
                        </Button>
                    </Stack>
                    <Typography
                        variant='caption'
                        color='text.secondary'
                        sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}
                    >
                        {t('voice.training.rvcNote')}
                    </Typography>
                </Panel>
            </Stack>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                status={trainingStatus(t, job?.payload)}
                message={job?.message ?? ''}
                onCancel={cancel}
            />

            <AppDialog open={confirmClear} onClose={() => setConfirmClear(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.training.clear')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.training.clearConfirm')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmClear(false)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='error'
                        onClick={async () => {
                            setConfirmClear(false);
                            await window.kuraToolkit.voice.training.rvcClear();
                            setPlaying(null);
                            await load();
                        }}
                    >
                        {t('voice.training.clear')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog
                open={removeConfirm.open}
                onClose={() => setRemoveConfirm(previous => ({ ...previous, open: false }))}
                maxWidth='xs'
                fullWidth
            >
                <DialogTitle>{t('voice.training.deleteRecordingTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.training.deleteRecordingConfirm', { name: removeConfirm.item?.name ?? '' })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoveConfirm(previous => ({ ...previous, open: false }))}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant='contained'
                        color='error'
                        onClick={() => {
                            const item = removeConfirm.item;
                            setRemoveConfirm(previous => ({ ...previous, open: false }));
                            if (item) void removeItem(item);
                        }}
                    >
                        {t('voice.training.deleteRecording')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={created !== null} onClose={() => setCreated(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.training.doneTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2'>
                        {t('voice.training.doneMessage', { name: created?.name ?? '' })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreated(null)}>{t('common.close')}</Button>
                    <Button variant='contained' onClick={() => navigate('/audio/conversion/models')}>
                        {t('voice.training.openModels')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </PageContainer>
    );
}
