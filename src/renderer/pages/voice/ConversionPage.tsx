import React from 'react';
import {
    Alert,
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Radio,
    RadioGroup,
    Select,
    Stack,
    Step,
    StepButton,
    Stepper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import TuneIcon from '@mui/icons-material/Tune';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import SectionLabel from '../../components/common/SectionLabel';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import SeparationWorkbench from '../../components/voice/SeparationWorkbench';
import SyncPlayer, { type PlayerSource } from '../../components/voice/SyncPlayer';
import SliderField from '../../components/voice/SliderField';
import MixForm from '../../components/voice/MixForm';
import PresetBar from '../../components/voice/PresetBar';
import ExportDialog, { type ExportEntry } from '../../components/voice/ExportDialog';
import { computeTracks, vocalsAndAccompaniment } from '../../components/voice/separationTracks';
import { AUDIO_INPUT_EXTENSIONS, audioInputFilters } from '../../components/voice/audioInput';
import { formatDuration, voiceLabel } from '../../components/voice/voiceFormat';
import { isCancelledError, missingItemsFromError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useConversionSeparationStore } from '../../stores/separationWorkStore';
import { useConversionStore, type ConversionInputMode } from '../../stores/conversionStore';
import { useVoiceHandoffStore, type VoiceHandoff } from '../../stores/voiceHandoffStore';
import { openVoiceLibrary } from '../../stores/voiceLibraryStore';
import {
    F0_METHODS,
    type ConversionCandidate,
    type F0Method,
    type MediaRef,
    type MixParams,
    type VoiceModelInfo,
} from '@shared/voice/types';

// ピッチ抽出の方式ごとに必要なモデル (CREPE は Applio のパッケージに含まれる)
const F0_ITEMS: Record<F0Method, string | null> = {
    rmvpe: 'model:converter:rmvpe',
    fcpe: 'model:converter:fcpe',
    crepe: null,
    'crepe-tiny': null,
};

type Step1Target =
    { kind: 'converted' | 'withAccompaniment'; candidateId: string } | { kind: 'originalVocals' } | { kind: 'source' };

// 新しい作業の確認。受け取った音声 (handoff) がある場合は、作業を破棄した後にそれで始める。
// 閉じる間も表示が変わらないよう、開閉とは別に持つ
type ResetConfirm = { open: boolean; handoff: VoiceHandoff | null };

// 候補を破棄するときに消すファイル (変換した声と、伴奏と重ねたもの)
function candidateFiles(candidate: ConversionCandidate): string[] {
    return candidate.withAccompaniment
        ? [candidate.vocals.path, candidate.withAccompaniment.path]
        : [candidate.vocals.path];
}

export default function ConversionPage() {
    const { t } = useTranslation();
    const readiness = useFeatureReadiness('conversion');
    const separationReadiness = useFeatureReadiness('separation');
    const sep = useConversionSeparationStore();
    const conv = useConversionStore();
    const [voices, setVoices] = React.useState<VoiceModelInfo[]>([]);
    const [vocalsMedia, setVocalsMedia] = React.useState<MediaRef | null>(null);
    const [target, setTarget] = React.useState<Step1Target>({ kind: 'originalVocals' });
    const [mixTarget, setMixTarget] = React.useState<'mix' | 'source'>('mix');
    const [exportOpen, setExportOpen] = React.useState(false);
    const [confirmInvalidate, setConfirmInvalidate] = React.useState(false);
    const [resetConfirm, setResetConfirm] = React.useState<ResetConfirm>({ open: false, handoff: null });
    const { job, run, cancel } = useJobRunner();
    const ready = readiness.readiness?.ready ?? false;
    const workKey = sep.workKey;
    const installed = (id: string | null) =>
        !id || readiness.status?.items.find(item => item.id === id)?.status === 'installed';

    React.useEffect(() => {
        let cancelled = false;
        void window.kuraToolkit.voice.models.list('converter').then(list => {
            if (!cancelled) setVoices(list);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // 作業を破棄して新しい作業を始める。受け取った音声があれば、それを入力にして変換から始める
    const startNewWork = (handoff: VoiceHandoff | null) => {
        const separation = useConversionSeparationStore.getState();
        const conversion = useConversionStore.getState();
        void window.kuraToolkit.voice.media.discardWork(separation.workKey);
        separation.reset();
        conversion.reset();
        setTarget({ kind: 'originalVocals' });
        setMixTarget('mix');
        if (handoff) {
            conversion.setInputMode('external');
            conversion.setExternal(handoff);
            conversion.setStep(1);
        }
    };

    // 分離や読み上げから受け取った音声で作業を始める。作業中の結果がある場合は、破棄してよいかを先に確かめる
    React.useEffect(() => {
        const handoff = useVoiceHandoffStore.getState().take();
        if (!handoff) return;
        const hasWork =
            useConversionSeparationStore.getState().source !== null ||
            useConversionStore.getState().candidates.length > 0;
        if (hasWork) setResetConfirm({ open: true, handoff });
        else startNewWork(handoff);
    }, []);

    // --- 変換に使うボーカルと伴奏 ---
    let vocals: string | null = null;
    let accompaniment: string[] = [];
    let sourceMedia: MediaRef | null = null;
    let sourcePath = '';
    let channels = 2;
    if (conv.inputMode === 'external' && conv.external) {
        vocals = conv.external.vocals;
        accompaniment = conv.external.accompaniment;
        sourceMedia = conv.external.sourceMedia;
        sourcePath = conv.external.sourcePath;
        channels = conv.external.channels;
    } else if (sep.source) {
        sourceMedia = sep.source.media;
        sourcePath = sep.source.sourcePath;
        channels = sep.source.channels;
        if (conv.inputMode === 'direct') {
            vocals = sep.source.media.path;
        } else {
            const selected = vocalsAndAccompaniment(computeTracks(sep.source.media.path, sep.stages).tracks);
            vocals = selected.vocals?.paths[0] ?? null;
            accompaniment = selected.accompaniment;
        }
    }
    const inputKey = `${vocals ?? ''}|${accompaniment.join(',')}`;

    React.useEffect(() => {
        if (!vocals) {
            setVocalsMedia(null);
            return;
        }
        let cancelled = false;
        void window.kuraToolkit.voice.media.ref(vocals).then(media => {
            if (!cancelled) setVocalsMedia(media);
        });
        return () => {
            cancelled = true;
        };
    }, [vocals]);

    const voice = voices.find(item => item.id === conv.voiceId) ?? null;
    const adopted = conv.candidates.find(item => item.id === conv.adoptedId) ?? null;
    const busy = job !== null;

    // 伴奏が複数の音から成る場合は 1 つに重ねたものを使う
    const accompanimentPath = async (jobId: string): Promise<string | null> => {
        if (accompaniment.length === 0) return null;
        if (accompaniment.length === 1) return accompaniment[0];
        return (await window.kuraToolkit.voice.media.mix(jobId, workKey, accompaniment, channels)).path;
    };

    const handleError = (error: unknown) => {
        if (isCancelledError(error)) {
            showNotice('warning', t('voice.common.cancelled'));
            return;
        }
        const missing = missingItemsFromError(error);
        showNotice('error', voiceErrorMessage(t, error), 12000);
        if (missing.length > 0) openVoiceLibrary({ select: missing, focus: 'converter' });
    };

    const loadSource = async (paths: string[]) => {
        const path = paths[0];
        if (!path) return;
        try {
            const prepared = await run(t('voice.common.loading'), jobId =>
                window.kuraToolkit.voice.media.prepareInput(jobId, workKey, path)
            );
            sep.setSource(prepared, path.split(/[\\/]/).pop() ?? path);
        } catch (error) {
            handleError(error);
        }
    };

    const goToConversion = () => {
        if (conv.candidates.length > 0 && conv.candidatesInput !== inputKey) {
            setConfirmInvalidate(true);
            return;
        }
        conv.setStep(1);
    };

    const invalidateResults = () => {
        const previousMix = conv.mix;
        const removed = conv.clearResults();
        void window.kuraToolkit.voice.media.discard([
            ...removed.flatMap(candidateFiles),
            ...(previousMix ? [previousMix.path] : []),
        ]);
        setConfirmInvalidate(false);
        conv.setStep(1);
    };

    const runConversion = async () => {
        if (!vocals || !voice) return;
        // オクターブ単位以外の移調では伴奏も移調するため、ffmpeg に rubberband フィルタが必要
        if (accompaniment.length > 0 && conv.params.pitch % 12 !== 0) {
            const available = await window.kuraToolkit.voice.conversion.hasRubberband();
            if (!available) {
                showNotice('error', t('voice.errors.RUBBERBAND_UNAVAILABLE'), 15000);
                return;
            }
        }
        try {
            const candidate = await run(t('voice.conversion.running'), async jobId =>
                window.kuraToolkit.voice.conversion.run(jobId, {
                    workKey,
                    vocals: vocals as string,
                    accompaniment: await accompanimentPath(jobId),
                    voiceId: voice.id,
                    params: conv.params,
                })
            );
            conv.addCandidate(candidate, inputKey);
            setTarget({ kind: 'converted', candidateId: candidate.id });
        } catch (error) {
            handleError(error);
        }
    };

    const mixSignature = adopted ? JSON.stringify({ candidate: adopted.id, params: conv.mixParams }) : null;
    const mixStale = conv.mix !== null && conv.mixSignature !== mixSignature;

    const renderMix = async (jobId: string): Promise<MediaRef> => {
        if (!adopted) throw new Error('NO_CANDIDATE');
        if (conv.mix && conv.mixSignature === mixSignature) return conv.mix;
        const media = await window.kuraToolkit.voice.conversion.renderMix(jobId, {
            workKey,
            vocals: adopted.vocals.path,
            accompaniment: await accompanimentPath(jobId),
            pitch: adopted.params.pitch,
            params: conv.mixParams,
        });
        // 前の合成結果は使わなくなるため消す
        const previous = useConversionStore.getState().mix;
        conv.setMix(media, mixSignature);
        if (previous && previous.path !== media.path) void window.kuraToolkit.voice.media.discard([previous.path]);
        return media;
    };

    const previewMix = async () => {
        try {
            await run(t('voice.mix.rendering'), renderMix);
            setMixTarget('mix');
        } catch (error) {
            handleError(error);
        }
    };

    // --- 再生対象 ---
    let step1Source: PlayerSource | null = null;
    if (target.kind === 'originalVocals' && vocalsMedia) {
        step1Source = {
            key: 'original-vocals',
            url: vocalsMedia.url,
            label: t('voice.conversion.targets.originalVocals'),
        };
    } else if (target.kind === 'source' && sourceMedia) {
        step1Source = { key: 'source', url: sourceMedia.url, label: t('voice.conversion.targets.source') };
    } else if (target.kind === 'converted' || target.kind === 'withAccompaniment') {
        const candidate = conv.candidates.find(item => item.id === target.candidateId);
        const media = candidate ? (target.kind === 'converted' ? candidate.vocals : candidate.withAccompaniment) : null;
        if (candidate && media) {
            step1Source = {
                key: `${candidate.id}-${target.kind}`,
                url: media.url,
                label: `${candidate.voiceName} - ${t(`voice.conversion.targets.${target.kind}`)}`,
            };
        }
    }
    const step2Source: PlayerSource | null =
        mixTarget === 'mix' && conv.mix
            ? { key: `mix-${conv.mixSignature}`, url: conv.mix.url, label: t('voice.conversion.targets.mix') }
            : sourceMedia
              ? { key: 'source', url: sourceMedia.url, label: t('voice.conversion.targets.source') }
              : null;

    const exportEntries: ExportEntry[] = adopted
        ? [
              {
                  key: 'mix',
                  label: t('voice.conversion.exportMix'),
                  suffix: t('voice.conversion.suffixConverted'),
                  resolve: async jobId => (await renderMix(jobId)).path,
              },
              {
                  key: 'vocals',
                  label: t('voice.conversion.exportVocals'),
                  suffix: t('voice.conversion.suffixConvertedVocals'),
                  resolve: async () => adopted.vocals.path,
                  defaultChecked: false,
              },
          ]
        : [];

    const steps = [
        t('voice.conversion.steps.input'),
        t('voice.conversion.steps.convert'),
        t('voice.conversion.steps.mix'),
    ];
    const stepEnabled = [true, !!vocals, !!adopted];

    return (
        <PageContainer>
            <VoiceFeatureHeader feature='conversion' />
            <ReadinessAlert state={readiness} />
            <Stack direction='row' spacing={2} sx={{ alignItems: 'center' }}>
                <Stepper nonLinear activeStep={conv.step} sx={{ flexGrow: 1 }}>
                    {steps.map((label, index) => (
                        <Step key={label} completed={false}>
                            <StepButton
                                disabled={!stepEnabled[index] || busy}
                                onClick={() => (index === 1 ? goToConversion() : conv.setStep(index))}
                            >
                                {label}
                            </StepButton>
                        </Step>
                    ))}
                </Stepper>
                <Button
                    startIcon={<RestartAltIcon />}
                    onClick={() => setResetConfirm({ open: true, handoff: null })}
                    disabled={busy}
                >
                    {t('voice.common.newWork')}
                </Button>
            </Stack>

            {conv.step === 0 && (
                <Stack spacing={2}>
                    <Panel>
                        <RadioGroup
                            row
                            value={conv.inputMode}
                            onChange={event => conv.setInputMode(event.target.value as ConversionInputMode)}
                        >
                            <FormControlLabel
                                value='separate'
                                control={<Radio />}
                                label={t('voice.conversion.modeSeparate')}
                            />
                            <FormControlLabel
                                value='direct'
                                control={<Radio />}
                                label={t('voice.conversion.modeDirect')}
                            />
                            {conv.external && (
                                <FormControlLabel
                                    value='external'
                                    control={<Radio />}
                                    label={t(
                                        conv.external.from === 'tts'
                                            ? 'voice.conversion.modeFromTts'
                                            : 'voice.conversion.modeFromSeparation',
                                        {
                                            name: conv.external.name,
                                        }
                                    )}
                                />
                            )}
                        </RadioGroup>
                        <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                            {t('voice.conversion.modeHint')}
                        </Typography>
                    </Panel>
                    {conv.inputMode !== 'external' && !sep.source && (
                        <FileDropZone
                            onFiles={paths => void loadSource(paths)}
                            filters={audioInputFilters(t)}
                            accept={AUDIO_INPUT_EXTENSIONS}
                            hint={t('voice.conversion.dropHint')}
                            sx={{ minHeight: 200, opacity: ready ? 1 : 0.6, pointerEvents: ready ? 'auto' : 'none' }}
                        />
                    )}
                    {conv.inputMode !== 'external' && sep.source && (
                        <Panel sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                <Typography
                                    variant='body2'
                                    sx={{ fontWeight: 600 }}
                                    noWrap
                                    title={sep.source.sourcePath}
                                >
                                    {sep.sourceName}
                                </Typography>
                                <Typography variant='caption' color='text.secondary'>
                                    {formatDuration(sep.source.media.durationSec)}
                                </Typography>
                            </Box>
                        </Panel>
                    )}
                    {conv.inputMode === 'separate' && sep.source && (
                        <>
                            <ReadinessAlert state={separationReadiness} />
                            <SeparationWorkbench
                                store={useConversionSeparationStore}
                                disabled={!(separationReadiness.readiness?.ready ?? false)}
                            />
                        </>
                    )}
                    {conv.inputMode === 'direct' && sep.source && (
                        <SyncPlayer source={{ key: 'direct', url: sep.source.media.url, label: sep.sourceName }} />
                    )}
                    <Panel sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant='body2' sx={{ flexGrow: 1, lineHeight: 1.6 }}>
                            {vocals
                                ? t('voice.conversion.inputSummary', {
                                      accompaniment:
                                          accompaniment.length > 0
                                              ? t('voice.conversion.withAccompaniment')
                                              : t('voice.conversion.withoutAccompaniment'),
                                  })
                                : t('voice.conversion.inputMissing')}
                        </Typography>
                        <Button variant='contained' disabled={!vocals || busy} onClick={goToConversion}>
                            {t('voice.common.next')}
                        </Button>
                    </Panel>
                </Stack>
            )}

            {conv.step === 1 && (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '340px minmax(0, 1fr)' },
                        gap: 2,
                        alignItems: 'start',
                    }}
                >
                    <Panel>
                        <Stack spacing={2}>
                            <FormControl size='small' disabled={busy}>
                                <InputLabel id='conversion-voice'>{t('voice.conversion.voice')}</InputLabel>
                                <Select
                                    labelId='conversion-voice'
                                    label={t('voice.conversion.voice')}
                                    value={voice ? voice.id : ''}
                                    onChange={event => conv.setVoiceId(String(event.target.value))}
                                >
                                    {voices.map(item => (
                                        <MenuItem key={item.id} value={item.id}>
                                            {voiceLabel(t, item)}
                                            <Typography
                                                component='span'
                                                variant='caption'
                                                color='text.secondary'
                                                sx={{ ml: 1 }}
                                            >
                                                {t(`voice.models.categories.${item.category}`)}
                                            </Typography>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            {voices.length === 0 && <Alert severity='info'>{t('voice.conversion.noVoices')}</Alert>}
                            <SliderField
                                label={t('voice.conversion.pitch')}
                                value={conv.params.pitch}
                                min={-24}
                                max={24}
                                step={1}
                                format={value => `${value > 0 ? '+' : ''}${value}`}
                                disabled={busy}
                                helperText={accompaniment.length > 0 ? t('voice.conversion.pitchHint') : undefined}
                                onChange={pitch => conv.setParams({ ...conv.params, pitch })}
                            />
                            <FormControl size='small' disabled={busy}>
                                <InputLabel id='conversion-f0'>{t('voice.conversion.f0Method')}</InputLabel>
                                <Select
                                    labelId='conversion-f0'
                                    label={t('voice.conversion.f0Method')}
                                    value={conv.params.f0Method}
                                    onChange={event =>
                                        conv.setParams({ ...conv.params, f0Method: event.target.value as F0Method })
                                    }
                                >
                                    {F0_METHODS.map(method => (
                                        <MenuItem key={method} value={method}>
                                            {t(`voice.conversion.f0Methods.${method}`)}
                                            {F0_ITEMS[method] && !installed(F0_ITEMS[method]) && (
                                                <Typography
                                                    component='span'
                                                    variant='caption'
                                                    color='text.secondary'
                                                    sx={{ ml: 1 }}
                                                >
                                                    {t('voice.separation.notDownloaded')}
                                                </Typography>
                                            )}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <SliderField
                                label={t('voice.conversion.indexRate')}
                                value={conv.params.indexRate}
                                min={0}
                                max={1}
                                step={0.05}
                                format={value => value.toFixed(2)}
                                disabled={busy || (voice?.rvc ? !voice.rvc.hasIndex : false)}
                                helperText={
                                    voice?.rvc && !voice.rvc.hasIndex
                                        ? t('voice.conversion.noIndex')
                                        : t('voice.conversion.indexRateHint')
                                }
                                onChange={indexRate => conv.setParams({ ...conv.params, indexRate })}
                            />
                            <SliderField
                                label={t('voice.conversion.volumeEnvelope')}
                                value={conv.params.volumeEnvelope}
                                min={0}
                                max={1}
                                step={0.05}
                                format={value => value.toFixed(2)}
                                disabled={busy}
                                helperText={t('voice.conversion.volumeEnvelopeHint')}
                                onChange={volumeEnvelope => conv.setParams({ ...conv.params, volumeEnvelope })}
                            />
                            <SliderField
                                label={t('voice.conversion.protect')}
                                value={conv.params.protect}
                                min={0}
                                max={0.5}
                                step={0.01}
                                format={value => value.toFixed(2)}
                                disabled={busy}
                                helperText={t('voice.conversion.protectHint')}
                                onChange={protect => conv.setParams({ ...conv.params, protect })}
                            />
                            <Button
                                variant='contained'
                                startIcon={<RecordVoiceOverIcon />}
                                disabled={busy || !voice || !vocals || !ready}
                                onClick={() => void runConversion()}
                            >
                                {t('voice.conversion.run')}
                            </Button>
                        </Stack>
                    </Panel>
                    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                        <Stack direction='row' spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                            <SectionLabel sx={{ flexGrow: 1 }}>{t('voice.conversion.candidates')}</SectionLabel>
                            <Button
                                size='small'
                                variant={target.kind === 'originalVocals' ? 'contained' : 'outlined'}
                                onClick={() => setTarget({ kind: 'originalVocals' })}
                            >
                                {t('voice.conversion.targets.originalVocals')}
                            </Button>
                            <Button
                                size='small'
                                variant={target.kind === 'source' ? 'contained' : 'outlined'}
                                disabled={!sourceMedia}
                                onClick={() => setTarget({ kind: 'source' })}
                            >
                                {t('voice.conversion.targets.source')}
                            </Button>
                        </Stack>
                        <Panel disablePadding sx={{ overflow: 'auto' }}>
                            {conv.candidates.length === 0 ? (
                                <Typography variant='body2' color='text.secondary' sx={{ p: 2, lineHeight: 1.6 }}>
                                    {t('voice.conversion.noCandidates')}
                                </Typography>
                            ) : (
                                <Table size='small'>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell padding='checkbox'>{t('voice.separation.adopt')}</TableCell>
                                            <TableCell>{t('voice.conversion.voice')}</TableCell>
                                            <TableCell>{t('voice.conversion.preview')}</TableCell>
                                            <TableCell padding='checkbox' />
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {conv.candidates.map(candidate => (
                                            <TableRow key={candidate.id} hover>
                                                <TableCell padding='checkbox'>
                                                    <Radio
                                                        size='small'
                                                        checked={conv.adoptedId === candidate.id}
                                                        onChange={() => conv.setAdopted(candidate.id)}
                                                        slotProps={{ input: { 'aria-label': candidate.voiceName } }}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                                        {candidate.voiceName}
                                                    </Typography>
                                                    <Typography variant='caption' color='text.secondary'>
                                                        {t('voice.conversion.paramsSummary', {
                                                            pitch: candidate.params.pitch,
                                                            f0: candidate.params.f0Method,
                                                            index: candidate.params.indexRate.toFixed(2),
                                                            envelope: candidate.params.volumeEnvelope.toFixed(2),
                                                            protect: candidate.params.protect.toFixed(2),
                                                        })}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Stack direction='row' spacing={0.5}>
                                                        <Button
                                                            size='small'
                                                            variant={
                                                                target.kind === 'converted' &&
                                                                target.candidateId === candidate.id
                                                                    ? 'contained'
                                                                    : 'outlined'
                                                            }
                                                            onClick={() =>
                                                                setTarget({
                                                                    kind: 'converted',
                                                                    candidateId: candidate.id,
                                                                })
                                                            }
                                                        >
                                                            {t('voice.conversion.targets.converted')}
                                                        </Button>
                                                        {candidate.withAccompaniment && (
                                                            <Button
                                                                size='small'
                                                                variant={
                                                                    target.kind === 'withAccompaniment' &&
                                                                    target.candidateId === candidate.id
                                                                        ? 'contained'
                                                                        : 'outlined'
                                                                }
                                                                onClick={() =>
                                                                    setTarget({
                                                                        kind: 'withAccompaniment',
                                                                        candidateId: candidate.id,
                                                                    })
                                                                }
                                                            >
                                                                {t('voice.conversion.targets.withAccompaniment')}
                                                            </Button>
                                                        )}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell padding='checkbox'>
                                                    <Tooltip title={t('voice.common.deleteCandidate')}>
                                                        <span>
                                                            <IconButton
                                                                size='small'
                                                                aria-label={t('voice.common.deleteCandidate')}
                                                                disabled={busy}
                                                                onClick={() => {
                                                                    conv.removeCandidate(candidate.id);
                                                                    void window.kuraToolkit.voice.media.discard(
                                                                        candidateFiles(candidate)
                                                                    );
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
                        <SyncPlayer source={step1Source} />
                        <Stack direction='row' spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Button onClick={() => conv.setStep(0)}>{t('voice.common.back')}</Button>
                            <Button variant='contained' disabled={!adopted} onClick={() => conv.setStep(2)}>
                                {t('voice.common.next')}
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            )}

            {conv.step === 2 && (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '340px minmax(0, 1fr)' },
                        gap: 2,
                        alignItems: 'start',
                    }}
                >
                    <Panel>
                        <Stack spacing={2}>
                            <PresetBar<MixParams>
                                kind='mix'
                                disabled={busy}
                                current={() => conv.mixParams}
                                onApply={params => conv.setMixParams(params)}
                            />
                            <MixForm
                                value={conv.mixParams}
                                onChange={conv.setMixParams}
                                hasAccompaniment={accompaniment.length > 0}
                                disabled={busy}
                            />
                        </Stack>
                    </Panel>
                    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                            {t('voice.mix.hint')}
                        </Typography>
                        {mixStale && <Alert severity='info'>{t('voice.mix.stale')}</Alert>}
                        <Stack direction='row' spacing={1}>
                            <Button
                                variant='contained'
                                startIcon={<TuneIcon />}
                                disabled={busy || !adopted}
                                onClick={() => void previewMix()}
                            >
                                {t('voice.mix.preview')}
                            </Button>
                            <Button
                                variant={mixTarget === 'mix' ? 'contained' : 'outlined'}
                                disabled={!conv.mix}
                                onClick={() => setMixTarget('mix')}
                            >
                                {t('voice.conversion.targets.mix')}
                            </Button>
                            <Button
                                variant={mixTarget === 'source' ? 'contained' : 'outlined'}
                                disabled={!sourceMedia}
                                onClick={() => setMixTarget('source')}
                            >
                                {t('voice.conversion.targets.source')}
                            </Button>
                        </Stack>
                        <SyncPlayer source={step2Source} />
                        <Stack direction='row' spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Button onClick={() => conv.setStep(1)}>{t('voice.common.back')}</Button>
                            <Button
                                variant='contained'
                                startIcon={<SaveAltIcon />}
                                disabled={!adopted || busy}
                                onClick={() => setExportOpen(true)}
                            >
                                {t('voice.export.open')}
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            )}

            <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                entries={exportEntries}
                sourcePath={sourcePath || 'output'}
            />

            <AppDialog open={confirmInvalidate} onClose={() => setConfirmInvalidate(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.separation.invalidateTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.conversion.invalidateMessage')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmInvalidate(false)}>{t('common.cancel')}</Button>
                    <Button variant='contained' color='warning' onClick={invalidateResults}>
                        {t('voice.separation.invalidateRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog
                open={resetConfirm.open}
                onClose={() => setResetConfirm(previous => ({ ...previous, open: false }))}
                maxWidth='xs'
                fullWidth
            >
                <DialogTitle>{t('voice.common.newWork')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.common.newWorkConfirm')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetConfirm(previous => ({ ...previous, open: false }))}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            startNewWork(resetConfirm.handoff);
                            setResetConfirm({ open: false, handoff: null });
                        }}
                    >
                        {t('voice.common.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                message={job?.message ?? ''}
                onCancel={cancel}
            />
        </PageContainer>
    );
}
