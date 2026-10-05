import React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import SchoolIcon from '@mui/icons-material/School';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
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
import { useSettingsStore } from '../../stores/settingsStore';
import {
    LANGUAGE_DEFINITIONS,
    VOICE_LANGUAGES,
    ttsTrainingItems,
    type CorpusSetId,
    type TtsEngineId,
    type VoiceLanguage,
} from '@shared/voice/languages';
import type { TtsTrainingDraft, VoiceModelInfo } from '@shared/voice/types';

// 学習に向く 1 文の長さ (秒)。Style-Bert-VITS2 の学習には 2〜14 秒程度の音声が必要
const MIN_CLIP_SEC = 2;
const MAX_CLIP_SEC = 14;
const MIN_CLIPS = 10;

// 読み上げのモデルの学習。言語定義の読み上げ文を 1 文ずつ提示し、録音するか対応する音声ファイルを指定する
// (指定したファイルは元の場所から読む。録音と一覧は学習が終わると main 側で破棄される)
export default function TtsTrainingPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { settings } = useSettingsStore();
    const [language, setLanguage] = React.useState<VoiceLanguage>(settings?.app.language === 'en' ? 'en' : 'ja');
    const [corpusSet, setCorpusSet] = React.useState<CorpusSetId>('quick');
    const [engine, setEngine] = React.useState<TtsEngineId>(LANGUAGE_DEFINITIONS[language].trainingEngines[0]);
    const [draft, setDraft] = React.useState<TtsTrainingDraft | null>(null);
    const [index, setIndex] = React.useState(0);
    const [name, setName] = React.useState('');
    const [confirmClear, setConfirmClear] = React.useState(false);
    // 録音を外す (削除する) 確認の対象の文
    const [removeConfirm, setRemoveConfirm] = React.useState<{ open: boolean; sentenceId: string }>({
        open: false,
        sentenceId: '',
    });
    const [created, setCreated] = React.useState<VoiceModelInfo | null>(null);
    // 録音中の保存先。録音を止めた時点の表示に関わらず、録音を始めた時点の言語・読み上げ文の組・文に保存する。
    // 録音中は文の移動と言語・読み上げ文の組の切り替えを止める
    const [recordingTarget, setRecordingTarget] = React.useState<{
        language: VoiceLanguage;
        corpusSet: CorpusSetId;
        sentenceId: string;
    } | null>(null);
    const recordingActive = recordingTarget !== null;
    const { job, run, cancel } = useJobRunner();

    const extra = ttsTrainingItems(engine, language);
    const readiness = useFeatureReadiness('ttsTraining', extra);
    const platform = readiness.readiness?.platform;
    const available = platform?.ttsTrainingAvailable ?? false;

    const loadDraft = React.useCallback(async () => {
        setDraft(await window.kuraToolkit.voice.training.ttsDraft(language, corpusSet));
    }, [language, corpusSet]);
    React.useEffect(() => {
        void loadDraft();
        setIndex(0);
    }, [loadDraft]);
    React.useEffect(() => {
        const engines = LANGUAGE_DEFINITIONS[language].trainingEngines;
        if (!engines.includes(engine)) setEngine(engines[0]);
    }, [language, engine]);

    const sentences = draft?.sentences ?? [];
    const sentence = sentences[index] ?? null;
    // 音声 (録音または指定したファイル) のある文の数
    const withAudio = sentences.filter(item => item.recording).length;

    const replaceSentence = (id: string, recording: TtsTrainingDraft['sentences'][number]['recording']) =>
        setDraft(previous =>
            previous
                ? {
                      ...previous,
                      sentences: previous.sentences.map(item => (item.id === id ? { ...item, recording } : item)),
                  }
                : previous
        );

    const chooseFile = async () => {
        if (!sentence) return;
        const paths = await window.kuraToolkit.dialog.openFiles({ filters: trainingAudioFilters(t) });
        if (!paths[0]) return;
        try {
            const item = await run(t('voice.training.adding'), jobId =>
                window.kuraToolkit.voice.training.ttsSetFile(jobId, language, corpusSet, sentence.id, paths[0])
            );
            replaceSentence(sentence.id, item);
        } catch (error) {
            if (!isCancelledError(error)) showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const removeAudio = async (sentenceId: string) => {
        await window.kuraToolkit.voice.training.ttsRemove(language, corpusSet, sentenceId);
        replaceSentence(sentenceId, null);
    };

    // 録音は外すと消えるため確認する。指定したファイルは文から外すだけなので、そのまま外す
    const askRemoveAudio = () => {
        if (!sentence?.recording) return;
        if (sentence.recording.recorded) setRemoveConfirm({ open: true, sentenceId: sentence.id });
        else void removeAudio(sentence.id);
    };

    const startTraining = async () => {
        try {
            const info = await run(t('voice.training.running'), jobId =>
                window.kuraToolkit.voice.training.ttsStart(jobId, { language, corpusSet, engine, name })
            );
            setCreated(info);
            setName('');
        } catch (error) {
            if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
            else showNotice('error', voiceErrorMessage(t, error), 15000);
        } finally {
            // 学習が終わると (成否・キャンセルを問わず) 録音は消え、一覧は空になるため読み直す
            await loadDraft();
        }
    };

    const duration = sentence?.recording?.durationSec ?? 0;
    const lengthWarning = sentence?.recording && (duration < MIN_CLIP_SEC || duration > MAX_CLIP_SEC);

    return (
        <PageContainer>
            <VoiceFeatureHeader feature='tts' />
            {platform && !available && (
                <Alert severity='info'>
                    <AlertTitle>{t('voice.training.ttsUnavailableTitle')}</AlertTitle>
                    {t('voice.training.ttsUnavailable')}
                </Alert>
            )}
            {available && <ReadinessAlert state={readiness} />}

            <Panel>
                <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                    <FormControl size='small' sx={{ minWidth: 160 }}>
                        <InputLabel id='training-language'>{t('voice.tts.language')}</InputLabel>
                        <Select
                            labelId='training-language'
                            label={t('voice.tts.language')}
                            value={language}
                            disabled={recordingActive}
                            onChange={event => setLanguage(event.target.value as VoiceLanguage)}
                        >
                            {VOICE_LANGUAGES.map(item => (
                                <MenuItem key={item} value={item}>
                                    {t(`voice.languages.${item}`)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size='small' sx={{ minWidth: 240 }}>
                        <InputLabel id='training-corpus'>{t('voice.training.corpusSet')}</InputLabel>
                        <Select
                            labelId='training-corpus'
                            label={t('voice.training.corpusSet')}
                            value={corpusSet}
                            disabled={recordingActive}
                            onChange={event => setCorpusSet(event.target.value as CorpusSetId)}
                        >
                            <MenuItem value='quick'>{t('voice.training.corpus.quick')}</MenuItem>
                            <MenuItem value='accurate'>{t('voice.training.corpus.accurate')}</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl size='small' sx={{ minWidth: 200 }}>
                        <InputLabel id='training-engine'>{t('voice.tts.engine')}</InputLabel>
                        <Select
                            labelId='training-engine'
                            label={t('voice.tts.engine')}
                            value={engine}
                            onChange={event => setEngine(event.target.value as TtsEngineId)}
                        >
                            {LANGUAGE_DEFINITIONS[language].trainingEngines.map(item => (
                                <MenuItem key={item} value={item}>
                                    {t(`voice.engine.${item}`)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}>
                    {t('voice.training.ttsGuide')}
                </Typography>
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
                >
                    {t('voice.training.ttsDatasetNote')}
                </Typography>
            </Panel>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 320px' },
                    gap: 2,
                    alignItems: 'start',
                }}
            >
                <Panel>
                    {sentence ? (
                        <Stack spacing={2}>
                            <Stack direction='row' sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                                <Typography variant='body2' color='text.secondary'>
                                    {t('voice.training.sentenceIndex', {
                                        index: index + 1,
                                        total: sentences.length,
                                        id: sentence.id,
                                    })}
                                </Typography>
                                <Chip
                                    size='small'
                                    color={sentence.recording ? 'success' : 'default'}
                                    label={
                                        sentence.recording
                                            ? t('voice.training.recorded')
                                            : t('voice.training.notRecorded')
                                    }
                                />
                            </Stack>
                            <Typography sx={{ fontSize: '1.4rem', lineHeight: 1.7, minHeight: 96 }}>
                                {sentence.text}
                            </Typography>
                            <Stack
                                direction='row'
                                spacing={1.5}
                                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                            >
                                <RecorderControl
                                    disabled={job !== null}
                                    label={sentence.recording ? t('voice.training.rerecord') : undefined}
                                    onActiveChange={active =>
                                        setRecordingTarget(
                                            active ? { language, corpusSet, sentenceId: sentence.id } : null
                                        )
                                    }
                                    onRecorded={async audio => {
                                        if (!recordingTarget) return;
                                        try {
                                            const item = await window.kuraToolkit.voice.training.ttsSaveRecording(
                                                recordingTarget.language,
                                                recordingTarget.corpusSet,
                                                recordingTarget.sentenceId,
                                                audio.wav
                                            );
                                            replaceSentence(recordingTarget.sentenceId, item);
                                        } catch (error) {
                                            showNotice('error', voiceErrorMessage(t, error));
                                        }
                                    }}
                                />
                                <Button
                                    startIcon={<AudioFileOutlinedIcon />}
                                    disabled={job !== null}
                                    onClick={() => void chooseFile()}
                                >
                                    {t('voice.training.chooseSentenceFile')}
                                </Button>
                                {sentence.recording && (
                                    <Tooltip title={t('voice.training.removeSentenceAudio')}>
                                        <span>
                                            <IconButton
                                                aria-label={t('voice.training.removeSentenceAudio')}
                                                disabled={job !== null}
                                                onClick={askRemoveAudio}
                                            >
                                                <DeleteOutlineIcon />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                )}
                            </Stack>
                            {lengthWarning && (
                                <Alert severity='warning'>
                                    {t('voice.training.clipLength', {
                                        duration: duration.toFixed(1),
                                        min: MIN_CLIP_SEC,
                                        max: MAX_CLIP_SEC,
                                    })}
                                </Alert>
                            )}
                            <SyncPlayer
                                source={
                                    sentence.recording
                                        ? {
                                              key: sentence.recording.id + sentence.recording.media.url,
                                              url: sentence.recording.media.url,
                                              label: sentence.id,
                                          }
                                        : null
                                }
                                emptyHint={t('voice.training.noRecording')}
                            />
                            <Stack direction='row' spacing={1} sx={{ justifyContent: 'space-between' }}>
                                <Button
                                    startIcon={<NavigateBeforeIcon />}
                                    disabled={index === 0 || recordingActive}
                                    onClick={() => setIndex(index - 1)}
                                >
                                    {t('voice.training.previous')}
                                </Button>
                                <Button
                                    endIcon={<NavigateNextIcon />}
                                    disabled={index >= sentences.length - 1 || recordingActive}
                                    onClick={() => setIndex(index + 1)}
                                >
                                    {t('voice.training.next')}
                                </Button>
                            </Stack>
                        </Stack>
                    ) : (
                        <Typography variant='body2' color='text.secondary'>
                            {t('voice.common.loading')}
                        </Typography>
                    )}
                </Panel>
                <Panel disablePadding sx={{ maxHeight: 520, overflow: 'auto' }}>
                    <List dense disablePadding>
                        {sentences.map((item, itemIndex) => (
                            <ListItemButton
                                key={item.id}
                                selected={itemIndex === index}
                                disabled={recordingActive}
                                onClick={() => setIndex(itemIndex)}
                            >
                                <ListItemIcon sx={{ minWidth: 32 }}>
                                    {item.recording ? (
                                        <CheckCircleIcon fontSize='small' color='success' />
                                    ) : (
                                        <RadioButtonUncheckedIcon fontSize='small' color='disabled' />
                                    )}
                                </ListItemIcon>
                                <ListItemText
                                    primary={item.text}
                                    slotProps={{ primary: { variant: 'body2', noWrap: true } }}
                                />
                            </ListItemButton>
                        ))}
                    </List>
                </Panel>
            </Box>

            {/* すべて外す操作は、学習の操作から離して左端に置く */}
            <Panel>
                <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                    <Button
                        color='inherit'
                        startIcon={<DeleteSweepIcon />}
                        disabled={withAudio === 0 || job !== null}
                        onClick={() => setConfirmClear(true)}
                    >
                        {t('voice.training.clear')}
                    </Button>
                    <Typography variant='body2' sx={{ flexGrow: 1 }}>
                        {t('voice.training.progressSummary', {
                            recorded: withAudio,
                            total: sentences.length,
                            duration: formatDuration(
                                sentences.reduce((sum, item) => sum + (item.recording?.durationSec ?? 0), 0)
                            ),
                        })}
                    </Typography>
                    <TextField
                        size='small'
                        label={t('voice.training.modelName')}
                        value={name}
                        onChange={event => setName(event.target.value)}
                    />
                    <Button
                        variant='contained'
                        startIcon={<SchoolIcon />}
                        disabled={
                            !available ||
                            !(readiness.readiness?.ready ?? false) ||
                            job !== null ||
                            !name.trim() ||
                            withAudio < MIN_CLIPS
                        }
                        onClick={() => void startTraining()}
                    >
                        {t('voice.training.start')}
                    </Button>
                </Stack>
                {withAudio < MIN_CLIPS && (
                    <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
                        {t('voice.training.needMore', { count: MIN_CLIPS })}
                    </Typography>
                )}
            </Panel>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                status={trainingStatus(t, job?.payload)}
                message={job?.message ?? ''}
                onCancel={cancel}
            />

            <AppDialog
                open={removeConfirm.open}
                onClose={() => setRemoveConfirm(previous => ({ ...previous, open: false }))}
                maxWidth='xs'
                fullWidth
            >
                <DialogTitle>{t('voice.training.deleteRecordingTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.training.deleteSentenceRecordingConfirm')}
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
                            setRemoveConfirm(previous => ({ ...previous, open: false }));
                            void removeAudio(removeConfirm.sentenceId);
                        }}
                    >
                        {t('voice.training.deleteRecording')}
                    </Button>
                </DialogActions>
            </AppDialog>

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
                            await window.kuraToolkit.voice.training.ttsClear(language, corpusSet);
                            await loadDraft();
                        }}
                    >
                        {t('voice.training.clear')}
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
                    <Button variant='contained' onClick={() => navigate('/audio/tts/models')}>
                        {t('voice.training.openModels')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </PageContainer>
    );
}
