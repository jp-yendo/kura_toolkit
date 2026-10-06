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
import TrainingSetBar from '../../components/voice/TrainingSetBar';
import { useTrainingSets } from '../../components/voice/useTrainingSets';
import { audioInputFilters } from '../../components/voice/audioInput';
import { formatDuration } from '../../components/voice/voiceFormat';
import { isCancelledError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { showNotice } from '../../stores/noticeStore';
import type { TrainingAudio, TrainingSetDetail, VoiceModelInfo } from '@shared/voice/types';

// 削除する音声の確認。閉じる間も表示が変わらないよう、開閉とは別に持つ
type RemoveConfirm = { open: boolean; item: TrainingAudio | null };

// 音声変換 (RVC) のモデルの学習。学習セットを選び、マイク録音か音声ファイルの追加で学習用の音声を用意する
export default function RvcTrainingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const readiness = useFeatureReadiness('conversionTraining');
    const sets = useTrainingSets('converter');
    const setId = sets.selected?.id ?? null;
    const [detail, setDetail] = React.useState<TrainingSetDetail | null>(null);
    const [playing, setPlaying] = React.useState<TrainingAudio | null>(null);
    const [name, setName] = React.useState('');
    const [removeConfirm, setRemoveConfirm] = React.useState<RemoveConfirm>({ open: false, item: null });
    const [created, setCreated] = React.useState<VoiceModelInfo | null>(null);
    const [recording, setRecording] = React.useState(false);
    const { job, run, cancel } = useJobRunner();
    // 学習用の音声の追加は件数で進むため、そこから残り時間を見積もる
    const remaining = useRemainingTime(job?.jobId ?? null, job?.percent);
    const ready = readiness.readiness?.ready ?? false;

    // 選んでいる学習セット (読み直しの途中で学習セットを切り替えた場合に、前の学習セットの内容で上書きしないため)
    const setIdRef = React.useRef(setId);
    setIdRef.current = setId;
    const loadDetail = React.useCallback(async () => {
        if (!setId) {
            setDetail(null);
            return;
        }
        try {
            const next = await window.kuraToolkit.voice.trainingSets.get('converter', setId);
            if (setIdRef.current === setId) setDetail(next);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 12000);
        }
    }, [setId, t]);
    React.useEffect(() => {
        void loadDetail();
        setPlaying(null);
    }, [loadDetail]);

    // 音声を変えたら、学習セットの内容と一覧の要約 (音声の数・長さ) を読み直す
    const refresh = async () => {
        await Promise.all([loadDetail(), sets.reload()]);
    };

    const shown = detail && detail.summary.id === setId ? detail : null;
    const items = shown?.audios ?? [];
    const total = items.reduce((sum, item) => sum + item.durationSec, 0);

    const addFiles = async () => {
        if (!setId) return;
        const paths = await window.kuraToolkit.dialog.openFiles({ filters: audioInputFilters(t), multi: true });
        if (paths.length === 0) return;
        try {
            await run(t('voice.training.adding'), jobId =>
                window.kuraToolkit.voice.trainingSets.addFiles(jobId, 'converter', setId, paths)
            );
        } catch (error) {
            if (!isCancelledError(error)) showNotice('error', voiceErrorMessage(t, error));
        }
        await refresh();
    };

    const removeItem = async (item: TrainingAudio) => {
        if (!setId) return;
        try {
            await window.kuraToolkit.voice.trainingSets.removeAudio('converter', setId, item.id);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
        if (playing?.id === item.id) setPlaying(null);
        await refresh();
    };

    const startTraining = async () => {
        if (!setId) return;
        try {
            const info = await run(t('voice.training.running'), jobId =>
                window.kuraToolkit.voice.training.rvcStart(jobId, setId, name)
            );
            setCreated(info);
            setName('');
        } catch (error) {
            if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
            else showNotice('error', voiceErrorMessage(t, error), 15000);
        }
    };

    return (
        <PageContainer>
            <VoiceFeatureHeader feature='conversion' />
            <Stack spacing={2} sx={{ maxWidth: 1000, mx: 'auto', width: '100%' }}>
                <ReadinessAlert state={readiness} />
                <Alert severity='info'>{t('voice.training.rvcGuide')}</Alert>

                <Panel>
                    <TrainingSetBar feature='converter' state={sets} disabled={job !== null || recording} />
                    <Typography
                        variant='caption'
                        color='text.secondary'
                        sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}
                    >
                        {t('voice.training.datasetNote')}
                    </Typography>
                </Panel>

                {shown && (
                    <>
                        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                            <RecorderControl
                                disabled={job !== null}
                                onActiveChange={setRecording}
                                onRecorded={async audio => {
                                    try {
                                        await window.kuraToolkit.voice.trainingSets.addRecording(
                                            'converter',
                                            shown.summary.id,
                                            audio.recordingId,
                                            {
                                                name: t('voice.training.recordingName', {
                                                    date: new Date().toLocaleString(),
                                                }),
                                            }
                                        );
                                    } catch (error) {
                                        showNotice('error', voiceErrorMessage(t, error));
                                    }
                                    await refresh();
                                }}
                            />
                            <Button
                                variant='outlined'
                                startIcon={<AddIcon />}
                                disabled={job !== null || recording}
                                onClick={() => void addFiles()}
                            >
                                {t('voice.training.addFiles')}
                            </Button>
                        </Stack>

                        <SectionLabel>
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
                                                    <Tooltip title={t('voice.training.deleteAudio')}>
                                                        <span>
                                                            <IconButton
                                                                size='small'
                                                                aria-label={t('voice.training.deleteAudio')}
                                                                disabled={job !== null || recording}
                                                                onClick={event => {
                                                                    event.stopPropagation();
                                                                    setRemoveConfirm({ open: true, item });
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
                        <SyncPlayer source={playing ? { key: playing.id, url: playing.media.url } : null} />
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
                                    disabled={!ready || job !== null || recording || !name.trim() || items.length === 0}
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
                    </>
                )}
            </Stack>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                remaining={job?.phase ? undefined : remaining}
                status={job?.status}
                message={job?.message ?? ''}
                onCancel={cancel}
            />

            <AppDialog
                open={removeConfirm.open}
                onClose={() => setRemoveConfirm(previous => ({ ...previous, open: false }))}
                maxWidth='xs'
                fullWidth
            >
                <DialogTitle>{t('voice.training.deleteAudioTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.training.deleteAudioConfirm', { name: removeConfirm.item?.name ?? '' })}
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
                        {t('voice.training.deleteAudio')}
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
