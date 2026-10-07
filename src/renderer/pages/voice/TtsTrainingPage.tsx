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
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import SchoolIcon from '@mui/icons-material/School';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import AppDialog from '../../components/common/AppDialog';
import FileDropTarget from '../../components/common/FileDropTarget';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import RecorderControl from '../../components/voice/RecorderControl';
import SyncPlayer from '../../components/voice/SyncPlayer';
import TrainingSetBar from '../../components/voice/TrainingSetBar';
import TrainingFilterDialog from '../../components/voice/TrainingFilterDialog';
import TrainingGroupRow from '../../components/voice/TrainingGroupRow';
import { TEXT_EXTENSIONS } from '../../components/voice/textInput';
import type { RecordedAudio } from '../../components/voice/useRecorder';
import { silenceOption } from '@shared/voice/audio-filters';
import { useTrainingSets } from '../../components/voice/useTrainingSets';
import { AUDIO_INPUT_EXTENSIONS, audioInputFilters } from '../../components/voice/audioInput';
import { formatDuration, formatNameList } from '../../components/voice/voiceFormat';
import { isCancelledError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { showNotice } from '../../stores/noticeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { LANGUAGE_DEFINITIONS, ttsTrainingItems, type TtsModelType } from '@shared/voice/languages';
import type { TrainingAudio, TrainingSentence, TrainingSetDetail, VoiceModelInfo } from '@shared/voice/types';

// 録音中の保存先。録音を止めた時点の表示に関わらず、録音を始めた時点の学習セットと文 (グループ) に保存する
type RecordingTarget = { setId: string; sentenceId: string };

// グループの削除の確認の対象。閉じる間も表示が変わらないよう、開閉とは別に持つ
type RemoveGroupConfirm = { open: boolean; setId: string; group: TrainingSentence | null; index: number };

// 本文を保存するまでの待ち時間 (入力が止まってから保存する。入力のたびに学習セットの記録を書き直さないため)
const TEXT_SAVE_DELAY_MS = 800;

// 任意の文で作成する学習セットのグループの本文。入力中の本文は手元に持って表示し、入力が止まったとき・欄を離れたときに
// 保存する。保存した後も手元の本文を表示に使う (読み直すまで、学習セットの内容は保存前の本文のため)
function useGroupTexts(onError: (error: unknown) => void) {
    const [drafts, setDrafts] = React.useState<Record<string, string>>({});
    const draftsRef = React.useRef(drafts);
    draftsRef.current = drafts;
    // 保存を待っている本文 (学習セットとグループごと)
    const pending = React.useRef(
        new Map<string, { setId: string; groupId: string; timer: ReturnType<typeof setTimeout> }>()
    );
    const onErrorRef = React.useRef(onError);
    onErrorRef.current = onError;
    const keyOf = (setId: string, groupId: string) => `${setId}:${groupId}`;

    const save = React.useCallback(async (key: string) => {
        const entry = pending.current.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.current.delete(key);
        try {
            await window.kuraToolkit.voice.trainingSets.setGroupText(
                entry.setId,
                entry.groupId,
                draftsRef.current[key] ?? ''
            );
        } catch (error) {
            onErrorRef.current(error);
        }
    }, []);

    const change = (setId: string, groupId: string, text: string) => {
        const key = keyOf(setId, groupId);
        // 保存の前に手元の本文を変える (保存はその時点の手元の本文を書く)
        draftsRef.current = { ...draftsRef.current, [key]: text };
        setDrafts(draftsRef.current);
        const previous = pending.current.get(key);
        if (previous) clearTimeout(previous.timer);
        pending.current.set(key, { setId, groupId, timer: setTimeout(() => void save(key), TEXT_SAVE_DELAY_MS) });
    };

    // 保存を待っている本文をすぐに保存する (欄を離れたとき・学習を始める前)
    const flush = React.useCallback(
        (setId?: string, groupId?: string) =>
            Promise.all(
                [...pending.current.keys()]
                    .filter(key => setId === undefined || groupId === undefined || key === keyOf(setId, groupId))
                    .map(key => save(key))
            ).then(() => undefined),
        [save]
    );

    // 画面を離れるときも、待っている本文を保存する
    React.useEffect(() => () => void flush(), [flush]);

    const textOf = (setId: string, group: TrainingSentence) => drafts[keyOf(setId, group.id)] ?? group.text;
    return { change, flush, textOf };
}

// 読み上げのモデルの学習。学習セット (言語を 1 つ持つ) を選び、左の一覧から文を選んで、
// 右でその文の音声を録音するか、その文を読み上げた音声ファイルを指定する。読みたくない文は飛ばしてよい
export default function TtsTrainingPage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { settings } = useSettingsStore();
    const sets = useTrainingSets('tts');
    const set = sets.selected;
    const language = set?.language ?? 'ja';
    const [detail, setDetail] = React.useState<TrainingSetDetail | null>(null);
    const [index, setIndex] = React.useState(0);
    const [modelType, setModelType] = React.useState<TtsModelType>(
        LANGUAGE_DEFINITIONS[language].trainingModelTypes[0]
    );
    const [name, setName] = React.useState('');
    // 音声の削除の確認の対象。閉じる間も表示が変わらないよう、開閉とは別に持つ
    const [removeConfirm, setRemoveConfirm] = React.useState<{ open: boolean; audio: TrainingAudio | null }>({
        open: false,
        audio: null,
    });
    const [created, setCreated] = React.useState<VoiceModelInfo | null>(null);
    // 学習用の音のフィルター (audio が null のときは学習セットのすべての音)
    const [filterTarget, setFilterTarget] = React.useState<{ open: boolean; audio: TrainingAudio | null }>({
        open: false,
        audio: null,
    });
    // 学習前の確かめで見つかった、長い無音を含む音 (名前と無音の長さ)
    const [silenceWarning, setSilenceWarning] = React.useState<
        { audioId: string; name: string; seconds: number }[] | null
    >(null);
    const [recordingTarget, setRecordingTarget] = React.useState<RecordingTarget | null>(null);
    const recordingActive = recordingTarget !== null;
    const [removeGroupConfirm, setRemoveGroupConfirm] = React.useState<RemoveGroupConfirm>({
        open: false,
        setId: '',
        group: null,
        index: 0,
    });
    const groupTexts = useGroupTexts(error => showNotice('error', voiceErrorMessage(t, error)));
    const { job, run, cancel } = useJobRunner();
    // 学習用の音声の追加は件数で進むため、そこから残り時間を見積もる
    const remaining = useRemainingTime(job?.jobId ?? null, job?.percent);

    const extra = ttsTrainingItems(modelType, language);
    const readiness = useFeatureReadiness('ttsTraining', extra);
    const platform = readiness.readiness?.platform;
    const available = platform?.ttsTrainingAvailable ?? false;

    const setId = set?.id ?? null;
    // 選んでいる学習セット (読み直しの途中で学習セットを切り替えた場合に、前の学習セットの内容で上書きしないため)
    const setIdRef = React.useRef(setId);
    setIdRef.current = setId;
    const loadDetail = React.useCallback(async () => {
        if (!setId) {
            setDetail(null);
            return;
        }
        try {
            const next = await window.kuraToolkit.voice.trainingSets.get('tts', setId);
            if (setIdRef.current === setId) setDetail(next);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 12000);
        }
    }, [setId, t]);
    React.useEffect(() => {
        void loadDetail();
        setIndex(0);
    }, [loadDetail]);
    React.useEffect(() => {
        const modelTypes = LANGUAGE_DEFINITIONS[language].trainingModelTypes;
        if (!modelTypes.includes(modelType)) setModelType(modelTypes[0]);
    }, [language, modelType]);

    // 音声を変えたら、学習セットの内容と一覧の要約 (音声の数・長さ) を読み直す
    const refresh = async () => {
        await Promise.all([loadDetail(), sets.reload()]);
    };

    const shown = detail && detail.summary.id === setId ? detail : null;
    // 任意の文で作成する学習セット (文はグループ)
    const custom = shown?.summary.mode === 'custom';
    const sentences = shown?.sentences ?? [];
    const audioBySentence = new Map((shown?.audios ?? []).map(item => [item.sentenceId, item]));
    const sentence = sentences[index] ?? null;
    const audio = sentence ? (audioBySentence.get(sentence.id) ?? null) : null;
    const withAudio = sentences.filter(item => audioBySentence.has(item.id)).length;
    const totalSec = (shown?.audios ?? []).reduce((sum, item) => sum + item.durationSec, 0);
    // 任意の文で作成する学習セットで、音声と本文 (空白だけでないもの) がそろったグループの数 (学習に使うもの)
    const readyGroups =
        custom && setId
            ? sentences.filter(item => audioBySentence.has(item.id) && groupTexts.textOf(setId, item).trim()).length
            : 0;
    const { minimum, recommended } = LANGUAGE_DEFINITIONS[language].trainingSentences;
    const editDisabled = job !== null || !shown;

    // 文 (グループ) の音声ファイルを加える (ボタンか、枠へのドロップ。どちらも 1 つだけ)。学習セットのほかの文に
    // すでに同じ名前の音声がある場合は加えず、そのことを示す
    const addAudioFile = async (sentenceId: string, filePath: string | undefined) => {
        if (!setId || !filePath) return;
        try {
            const result = await run(t('voice.training.adding'), jobId =>
                window.kuraToolkit.voice.trainingSets.addFiles(jobId, 'tts', setId, [filePath], sentenceId)
            );
            if (result.skipped.length > 0) {
                showNotice(
                    'info',
                    t('voice.training.duplicateSkipped', { names: formatNameList(result.skipped, i18n.language) }),
                    12000
                );
            }
        } catch (error) {
            if (!isCancelledError(error)) showNotice('error', voiceErrorMessage(t, error));
        }
        await refresh();
    };

    const chooseFile = async (sentenceId: string) => {
        const paths = await window.kuraToolkit.dialog.openFiles({ filters: audioInputFilters(t) });
        await addAudioFile(sentenceId, paths[0]);
    };

    // 録音を止めたら、録音を始めた時点の学習セット・文 (グループ) に保存する
    const saveRecording = async (recorded: RecordedAudio) => {
        if (!recordingTarget) {
            void window.kuraToolkit.voice.recording.discard(recorded.recordingId);
            return;
        }
        try {
            await window.kuraToolkit.voice.trainingSets.addRecording(
                'tts',
                recordingTarget.setId,
                recorded.recordingId,
                {
                    name: t('voice.training.recordingName', { date: new Date().toLocaleString() }),
                    sentenceId: recordingTarget.sentenceId,
                }
            );
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
        await refresh();
    };

    // --- 任意の文で作成する学習セットのグループ ---

    const addGroup = async () => {
        if (!setId) return;
        try {
            await window.kuraToolkit.voice.trainingSets.addGroup(setId);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
        await refresh();
    };

    const removeGroup = async (targetSetId: string, group: TrainingSentence) => {
        try {
            await window.kuraToolkit.voice.trainingSets.removeGroup(targetSetId, group.id);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
        await refresh();
    };

    // テキストファイルの内容で、グループの本文を置き換える (すぐに保存する)
    const loadGroupText = async (group: TrainingSentence) => {
        if (!setId) return;
        const target = (
            await window.kuraToolkit.dialog.openFiles({
                filters: [{ name: t('voice.fileFilters.text'), extensions: TEXT_EXTENSIONS }],
            })
        )[0];
        if (!target) return;
        try {
            const text = await window.kuraToolkit.voice.tts.loadText(target, language);
            groupTexts.change(setId, group.id, text);
            await groupTexts.flush(setId, group.id);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const removeAudio = async (target: TrainingAudio) => {
        if (!setId) return;
        try {
            await window.kuraToolkit.voice.trainingSets.removeAudio('tts', setId, target.id);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
        await refresh();
    };

    // 学習前の確かめ: 長い無音を含む音があれば知らせ、了解して続行するかを選んでもらう。判断はフィルターの
    // 「無音部分を除去する」の初期値と同じ
    const checkBeforeTraining = async () => {
        if (!setId || !shown) return;
        // 入力したばかりの本文を、学習が読む前に保存する
        await groupTexts.flush();
        try {
            // 処理役の起動と解析に時間がかかるため、進捗を示して操作を止める (二重に始めないため)
            const report = await run(t('voice.filters.checking'), () =>
                window.kuraToolkit.voice.trainingSets.silenceReport('tts', setId, silenceOption(true))
            );
            const names = new Map(shown.audios.map(item => [item.id, item.name]));
            const found = report
                .filter(item => item.silenceSec > 0)
                .map(item => ({
                    audioId: item.audioId,
                    name: names.get(item.audioId) ?? item.audioId,
                    seconds: item.silenceSec,
                }));
            if (found.length > 0) {
                setSilenceWarning(found);
                return;
            }
        } catch (error) {
            if (isCancelledError(error)) {
                showNotice('warning', t('voice.common.cancelled'));
                return;
            }
            // 確かめられなかった場合も学習は始める (補助の確かめのため)
            showNotice('warning', t('voice.filters.checkFailed', { error: voiceErrorMessage(t, error) }), 12000);
        }
        await startTraining();
    };

    const startTraining = async () => {
        if (!setId) return;
        try {
            const info = await run(t('voice.training.running'), jobId =>
                window.kuraToolkit.voice.training.ttsStart(jobId, { setId, modelType, name })
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
            <VoiceFeatureHeader feature='tts' />
            {platform && !available && (
                <Alert severity='info'>
                    <AlertTitle>{t('voice.training.ttsUnavailableTitle')}</AlertTitle>
                    {t('voice.training.ttsUnavailable')}
                </Alert>
            )}
            {available && <ReadinessAlert state={readiness} />}

            <Panel>
                <TrainingSetBar
                    feature='tts'
                    state={sets}
                    defaultLanguage={settings?.app.language === 'en' ? 'en' : 'ja'}
                    disabled={job !== null || recordingActive}
                />
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}>
                    {t(set?.mode === 'custom' ? 'voice.training.ttsCustomGuide' : 'voice.training.ttsGuide')}
                </Typography>
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
                >
                    {t('voice.training.datasetNote')}
                </Typography>
            </Panel>

            {/* 任意の文で作成する学習セット: グループを縦に並べる (音声変換の学習と同じ形) */}
            {shown && custom && setId && (
                <>
                    <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                        <Button
                            variant='outlined'
                            startIcon={<AddIcon />}
                            disabled={editDisabled || recordingActive}
                            onClick={() => void addGroup()}
                        >
                            {t('voice.training.addGroup')}
                        </Button>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            startIcon={<GraphicEqIcon />}
                            disabled={editDisabled || recordingActive || withAudio === 0}
                            onClick={() => setFilterTarget({ open: true, audio: null })}
                        >
                            {t('voice.filters.filterAll')}
                        </Button>
                    </Stack>
                    {/* グループは 1 つずつ枠で囲み、間を空けて並べる (境目を分かりやすくするため) */}
                    {sentences.length === 0 ? (
                        <Panel>
                            <Typography variant='body2' color='text.secondary'>
                                {t('voice.training.groupsEmpty')}
                            </Typography>
                        </Panel>
                    ) : (
                        <Stack spacing={2}>
                            {sentences.map((group, groupIndex) => {
                                const groupAudio = audioBySentence.get(group.id) ?? null;
                                return (
                                    <TrainingGroupRow
                                        key={group.id}
                                        index={groupIndex + 1}
                                        audio={groupAudio}
                                        text={groupTexts.textOf(setId, group)}
                                        disabled={editDisabled}
                                        recordingActive={recordingActive}
                                        recordingThis={recordingTarget?.sentenceId === group.id}
                                        onRecordingChange={active =>
                                            setRecordingTarget(active ? { setId, sentenceId: group.id } : null)
                                        }
                                        onRecorded={recorded => void saveRecording(recorded)}
                                        onChooseFile={() => void chooseFile(group.id)}
                                        onDropFile={filePath => void addAudioFile(group.id, filePath)}
                                        onFilter={() =>
                                            groupAudio && setFilterTarget({ open: true, audio: groupAudio })
                                        }
                                        onRemove={() =>
                                            setRemoveGroupConfirm({
                                                open: true,
                                                setId,
                                                group,
                                                index: groupIndex + 1,
                                            })
                                        }
                                        onTextChange={text => groupTexts.change(setId, group.id, text)}
                                        onTextBlur={() => void groupTexts.flush(setId, group.id)}
                                        onLoadText={() => void loadGroupText(group)}
                                    />
                                );
                            })}
                        </Stack>
                    )}
                </>
            )}

            {shown && !custom && (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '320px minmax(0, 1fr)' },
                        gap: 2,
                        alignItems: 'start',
                    }}
                >
                    {/* 左: 文の一覧 (音声のある文に印を付ける。読みたくない文は飛ばしてよい) */}
                    <Stack spacing={1}>
                        <Button
                            size='small'
                            startIcon={<GraphicEqIcon />}
                            disabled={editDisabled || recordingActive || withAudio === 0}
                            onClick={() => setFilterTarget({ open: true, audio: null })}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            {t('voice.filters.filterAll')}
                        </Button>
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
                                            {audioBySentence.has(item.id) ? (
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
                    </Stack>

                    {/* 右: 選んだ文の録音・ファイルの指定 (ボタンか、この枠へのドロップ)・再生 */}
                    <FileDropTarget
                        accept={AUDIO_INPUT_EXTENSIONS}
                        disabled={editDisabled || recordingActive || !sentence}
                        onFiles={paths => sentence && void addAudioFile(sentence.id, paths[0])}
                        onRejected={() => showNotice('warning', t('voice.training.dropUnsupported'))}
                    >
                        <Panel>
                            {sentence && (
                                <Stack spacing={2}>
                                    <Stack
                                        direction='row'
                                        sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                                    >
                                        <Typography variant='body2' color='text.secondary'>
                                            {t('voice.training.sentenceIndex', {
                                                index: index + 1,
                                                total: sentences.length,
                                                id: sentence.id,
                                            })}
                                        </Typography>
                                        <Chip
                                            size='small'
                                            color={audio ? 'success' : 'default'}
                                            label={
                                                audio ? t('voice.training.recorded') : t('voice.training.notRecorded')
                                            }
                                        />
                                    </Stack>
                                    <Typography sx={{ fontSize: '1.4rem', lineHeight: 1.7, minHeight: 96 }}>
                                        {sentence.text}
                                    </Typography>
                                    <Stack
                                        direction='row'
                                        spacing={1.5}
                                        // 録音中はフィルター・削除のボタン (高さ 40px) を出さないため、行の高さを保ち、下の波形を
                                        // 動かさない
                                        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, minHeight: 40 }}
                                    >
                                        <RecorderControl
                                            disabled={editDisabled}
                                            label={audio ? t('voice.training.rerecord') : undefined}
                                            onActiveChange={active =>
                                                setRecordingTarget(
                                                    active && setId ? { setId, sentenceId: sentence.id } : null
                                                )
                                            }
                                            onRecorded={recorded => void saveRecording(recorded)}
                                        />
                                        {/* 録音中は、録音中に使えないボタン (音声ファイル選択・フィルター・削除) を出さない
                                            (録音のメーターの幅を空けるため) */}
                                        {!recordingActive && (
                                            <>
                                                <Button
                                                    startIcon={<AudioFileOutlinedIcon />}
                                                    disabled={editDisabled || recordingActive}
                                                    onClick={() => void chooseFile(sentence.id)}
                                                >
                                                    {t('voice.training.chooseSentenceFile')}
                                                </Button>
                                                {audio && (
                                                    <Tooltip title={t('voice.filters.filterButton')}>
                                                        <span>
                                                            <IconButton
                                                                aria-label={t('voice.filters.filterFor', {
                                                                    name: audio.name,
                                                                })}
                                                                disabled={editDisabled || recordingActive}
                                                                onClick={() => setFilterTarget({ open: true, audio })}
                                                            >
                                                                <GraphicEqIcon />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                                {audio && (
                                                    <Tooltip title={t('voice.training.removeSentenceAudio')}>
                                                        <span>
                                                            <IconButton
                                                                aria-label={t('voice.training.removeSentenceAudio')}
                                                                disabled={editDisabled || recordingActive}
                                                                onClick={() => setRemoveConfirm({ open: true, audio })}
                                                            >
                                                                <DeleteOutlineIcon />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                            </>
                                        )}
                                    </Stack>
                                    {/* 録音し直したとき・別の文を選んだときは、先頭から止めた状態で示す */}
                                    <SyncPlayer
                                        source={
                                            audio ? { key: audio.id + audio.media.url, url: audio.media.url } : null
                                        }
                                        keepPosition={false}
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
                            )}
                        </Panel>
                    </FileDropTarget>
                </Box>
            )}

            {shown && (
                <Panel>
                    <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
                        <Typography variant='body2' sx={{ flexGrow: 1 }}>
                            {custom
                                ? t('voice.training.groupSummary', {
                                      ready: readyGroups,
                                      total: sentences.length,
                                      duration: formatDuration(totalSec),
                                  })
                                : t('voice.training.progressSummary', {
                                      recorded: withAudio,
                                      total: sentences.length,
                                      duration: formatDuration(totalSec),
                                  })}
                        </Typography>
                        <FormControl size='small' sx={{ minWidth: 200 }}>
                            <InputLabel id='training-model-type'>{t('voice.tts.modelType')}</InputLabel>
                            <Select
                                labelId='training-model-type'
                                label={t('voice.tts.modelType')}
                                value={modelType}
                                onChange={event => setModelType(event.target.value as TtsModelType)}
                            >
                                {LANGUAGE_DEFINITIONS[language].trainingModelTypes.map(item => (
                                    <MenuItem key={item} value={item}>
                                        {t(`voice.modelType.${item}`)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
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
                                recordingActive ||
                                !name.trim() ||
                                (custom ? readyGroups === 0 : withAudio < minimum)
                            }
                            onClick={() => void checkBeforeTraining()}
                        >
                            {t('voice.training.start')}
                        </Button>
                    </Stack>
                    {!custom && (
                        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
                            {t('voice.training.sentenceCounts', { minimum, recommended })}
                        </Typography>
                    )}
                </Panel>
            )}

            {setId && (
                <TrainingFilterDialog
                    key={filterTarget.audio?.id ?? 'set'}
                    open={filterTarget.open}
                    feature='tts'
                    setId={setId}
                    audio={filterTarget.audio}
                    onClose={() => setFilterTarget(previous => ({ ...previous, open: false }))}
                    onChanged={() => void refresh()}
                />
            )}

            <AppDialog open={silenceWarning !== null} onClose={() => setSilenceWarning(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.filters.silenceCheckTitle')}</DialogTitle>
                <DialogContent dividers>
                    <Typography variant='body2' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.filters.silenceCheckMessage')}
                    </Typography>
                    {silenceWarning?.map(item => (
                        <Typography key={item.audioId} variant='body2' color='text.secondary'>
                            {t('voice.filters.silenceCheckItem', { name: item.name, seconds: item.seconds.toFixed(1) })}
                        </Typography>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSilenceWarning(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            setSilenceWarning(null);
                            void startTraining();
                        }}
                    >
                        {t('voice.filters.continueAnyway')}
                    </Button>
                </DialogActions>
            </AppDialog>

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
                        {t('voice.training.deleteSentenceAudioConfirm')}
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
                            const target = removeConfirm.audio;
                            setRemoveConfirm(previous => ({ ...previous, open: false }));
                            if (target) void removeAudio(target);
                        }}
                    >
                        {t('voice.training.deleteAudio')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog
                open={removeGroupConfirm.open}
                onClose={() => setRemoveGroupConfirm(previous => ({ ...previous, open: false }))}
                maxWidth='xs'
                fullWidth
            >
                <DialogTitle>{t('voice.training.removeGroup')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.training.removeGroupConfirm', { index: removeGroupConfirm.index })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoveGroupConfirm(previous => ({ ...previous, open: false }))}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant='contained'
                        color='error'
                        onClick={() => {
                            const { setId: targetSetId, group } = removeGroupConfirm;
                            setRemoveGroupConfirm(previous => ({ ...previous, open: false }));
                            if (group) void removeGroup(targetSetId, group);
                        }}
                    >
                        {t('voice.training.removeGroupAction')}
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
