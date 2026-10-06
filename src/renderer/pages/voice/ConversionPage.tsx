import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
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
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import TuneIcon from '@mui/icons-material/Tune';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import SectionLabel from '../../components/common/SectionLabel';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import UserModelIcon from '../../components/voice/UserModelIcon';
import SeparationWorkbench from '../../components/voice/SeparationWorkbench';
import SyncPlayer from '../../components/voice/SyncPlayer';
import SliderField from '../../components/voice/SliderField';
import MixForm from '../../components/voice/MixForm';
import PresetBar from '../../components/voice/PresetBar';
import ExportDialog, { type ExportEntry } from '../../components/voice/ExportDialog';
import {
    defaultAccompaniment,
    defaultVocals,
    treeOutputs,
    type TreeOutput,
} from '../../components/voice/separationTree';
import { AUDIO_INPUT_EXTENSIONS, audioInputFilters } from '../../components/voice/audioInput';
import { formatDuration, voiceLabel } from '../../components/voice/voiceFormat';
import { isCancelledError, missingItemsFromError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useConversionSeparationStore } from '../../stores/separationWorkStore';
import { useConversionStore, type ConversionInputMode } from '../../stores/conversionStore';
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
    const [exportOpen, setExportOpen] = React.useState(false);
    const [confirmInvalidate, setConfirmInvalidate] = React.useState(false);
    const [resetConfirm, setResetConfirm] = React.useState(false);
    const { job, run, cancel } = useJobRunner();
    const ready = readiness.readiness?.ready ?? false;
    const workKey = sep.workKey;
    const installed = (id: string | null) =>
        !id || readiness.status?.items.find(item => item.id === id)?.status === 'installed';
    // ピッチ抽出の方式は、必要なモデルを取得済みのものだけを示す
    const f0Methods = F0_METHODS.filter(method => installed(F0_ITEMS[method]));

    React.useEffect(() => {
        let cancelled = false;
        window.kuraToolkit.voice.models
            .list('converter')
            .then(list => {
                if (!cancelled) setVoices(list);
            })
            .catch(error => {
                if (!cancelled) showNotice('error', voiceErrorMessage(t, error), 12000);
            });
        return () => {
            cancelled = true;
        };
    }, [t]);

    // 作業を破棄して新しい作業を始める
    const startNewWork = () => {
        const separation = useConversionSeparationStore.getState();
        void window.kuraToolkit.voice.media.discardWork(separation.workKey);
        separation.reset();
        useConversionStore.getState().reset();
    };

    // --- 変換に使うボーカルと伴奏 (どちらも複数の音から成る場合は、使うときに 1 つに重ねる) ---
    let vocals: string[] = [];
    let accompaniment: string[] = [];
    let sourceMedia: MediaRef | null = null;
    let sourcePath = '';
    let channels = 2;
    // 分離した音 (木の順) と、そのうち変換する音・伴奏として重ねる音
    let outputs: TreeOutput[] = [];
    let vocalsTrack: TreeOutput | null = null;
    let accompanimentKeys: string[] = [];
    if (sep.source) {
        sourceMedia = sep.source.media;
        sourcePath = sep.source.sourcePath;
        channels = sep.source.channels;
        if (conv.inputMode === 'direct') {
            vocals = [sep.source.media.path];
        } else {
            outputs = treeOutputs(sep.nodes);
            vocalsTrack = outputs.find(output => output.key === conv.vocalsTrack) ?? defaultVocals(sep.nodes, outputs);
            vocals = vocalsTrack ? [vocalsTrack.mediaPath] : [];
            const chosen =
                conv.accompanimentTracks ?? defaultAccompaniment(sep.nodes, outputs, vocalsTrack?.key ?? null);
            accompanimentKeys = chosen.filter(
                key => key !== vocalsTrack?.key && outputs.some(output => output.key === key)
            );
            accompaniment = outputs
                .filter(output => accompanimentKeys.includes(output.key))
                .map(output => output.mediaPath);
        }
    }
    const hasVocals = vocals.length > 0;
    const vocalsKey = vocals.join(',');
    const inputKey = `${vocalsKey}|${accompaniment.join(',')}`;

    // 元のボーカルの再生用 (複数の音から成る場合は重ねた音を作る)
    React.useEffect(() => {
        if (vocals.length === 0) {
            setVocalsMedia(null);
            return;
        }
        let cancelled = false;
        const request =
            vocals.length > 1
                ? window.kuraToolkit.voice.media.mix(crypto.randomUUID(), workKey, vocals, channels)
                : window.kuraToolkit.voice.media.ref(workKey, vocals[0]);
        // 重ねた音は同じ組み合わせなら同じファイルで、変換の入力や分離の再生にも使うため、ここでは消さない
        // (機能の作業を破棄するときに消える)
        request
            .then(result => {
                if (!cancelled) setVocalsMedia(result);
            })
            .catch(error => {
                if (!cancelled) showNotice('error', voiceErrorMessage(t, error));
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- ボーカルの組み合わせ (vocalsKey) が変わったときだけ読み直す
    }, [vocalsKey]);

    const voice = voices.find(item => item.id === conv.voiceId) ?? null;
    const adopted = conv.candidates.find(item => item.id === conv.adoptedId) ?? null;
    const busy = job !== null;

    // 複数の音から成る場合は 1 つに重ねたものを使う
    const singlePath = async (jobId: string, paths: string[]): Promise<string | null> => {
        if (paths.length === 0) return null;
        if (paths.length === 1) return paths[0];
        return (await window.kuraToolkit.voice.media.mix(jobId, workKey, paths, channels)).path;
    };

    const handleError = (error: unknown) => {
        if (isCancelledError(error)) {
            showNotice('warning', t('voice.common.cancelled'));
            return;
        }
        const missing = missingItemsFromError(error);
        showNotice('error', voiceErrorMessage(t, error), 12000);
        if (missing.length > 0) openVoiceLibrary({ select: missing, focus: 'conversion' });
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
        void window.kuraToolkit.voice.media.discard(workKey, [
            ...removed.flatMap(candidateFiles),
            ...(previousMix ? [previousMix.path] : []),
        ]);
        setConfirmInvalidate(false);
        conv.setStep(1);
    };

    const runConversion = async () => {
        if (!hasVocals || !voice) return;
        try {
            // オクターブ単位以外の移調では伴奏も移調するため、ffmpeg に rubberband フィルタが必要
            if (accompaniment.length > 0 && conv.params.pitch % 12 !== 0) {
                const available = await window.kuraToolkit.voice.conversion.hasRubberband();
                if (!available) {
                    showNotice('error', t('voice.errors.RUBBERBAND_UNAVAILABLE'), 15000);
                    return;
                }
            }
            const candidate = await run(t('voice.conversion.running'), async jobId =>
                window.kuraToolkit.voice.conversion.run(jobId, {
                    workKey,
                    vocals: (await singlePath(jobId, vocals)) as string,
                    accompaniment: await singlePath(jobId, accompaniment),
                    voiceId: voice.id,
                    params: conv.params,
                })
            );
            conv.addCandidate(candidate, inputKey);
        } catch (error) {
            handleError(error);
        }
    };

    // 入力 (伴奏) が変わった場合も作り直すよう、入力も含める
    const mixSignature = adopted
        ? JSON.stringify({ candidate: adopted.id, input: inputKey, params: conv.mixParams })
        : null;
    const mixStale = conv.mix !== null && conv.mixSignature !== mixSignature;

    const renderMix = async (jobId: string): Promise<MediaRef> => {
        if (!adopted) throw new Error('NO_CANDIDATE');
        if (conv.mix && conv.mixSignature === mixSignature) return conv.mix;
        const media = await window.kuraToolkit.voice.conversion.renderMix(jobId, {
            workKey,
            vocals: adopted.vocals.path,
            accompaniment: await singlePath(jobId, accompaniment),
            channels: adopted.channels,
            pitch: adopted.params.pitch,
            params: conv.mixParams,
        });
        // 前の合成結果は使わなくなるため消す
        const previous = useConversionStore.getState().mix;
        conv.setMix(media, mixSignature);
        if (previous && previous.path !== media.path)
            void window.kuraToolkit.voice.media.discard(workKey, [previous.path]);
        return media;
    };

    const createMix = async () => {
        try {
            await run(t('voice.mix.rendering'), renderMix);
        } catch (error) {
            handleError(error);
        }
    };

    // 候補の変換後のボーカルと伴奏を、音量を変えずにそのまま重ねた試聴用の音を作る (押したときだけ作る手動の更新。
    // 作り直したら前のものは消す)
    const createWithAccompaniment = async (candidate: ConversionCandidate) => {
        try {
            const media = await run(t('voice.conversion.withAccompanimentRendering'), async jobId =>
                window.kuraToolkit.voice.conversion.renderMix(jobId, {
                    workKey,
                    vocals: candidate.vocals.path,
                    accompaniment: await singlePath(jobId, accompaniment),
                    channels: candidate.channels,
                    pitch: candidate.params.pitch,
                    params: null,
                })
            );
            const previous = candidate.withAccompaniment;
            conv.setCandidatePreview(candidate.id, media);
            if (previous && previous.path !== media.path)
                void window.kuraToolkit.voice.media.discard(workKey, [previous.path]);
        } catch (error) {
            handleError(error);
        }
    };

    // 名前と波形を 1 行に並べる行 (分離の画面と同じ形)
    const playerRow = (key: string, label: string, url: string | null, action?: React.ReactNode) => (
        <Stack key={key} spacing={0.5} sx={{ minWidth: 0 }}>
            <Stack direction='row' spacing={1} sx={{ alignItems: 'center', minHeight: 30 }}>
                <Typography variant='body2' sx={{ fontWeight: 600, flexGrow: 1, overflowWrap: 'anywhere' }}>
                    {label}
                </Typography>
                {action}
            </Stack>
            {url && <SyncPlayer source={{ key, url }} keepPosition={false} />}
        </Stack>
    );

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
    // 合成は、候補を作ったときから入力が変わっていない場合だけ開ける (変わった場合は変換の段階で確認する)
    const stepEnabled = [true, hasVocals, !!adopted && conv.candidatesInput === inputKey];

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
                <Button startIcon={<RestartAltIcon />} onClick={() => setResetConfirm(true)} disabled={busy}>
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
                        </RadioGroup>
                        <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                            {t('voice.conversion.modeHint')}
                        </Typography>
                    </Panel>
                    {!sep.source && (
                        <FileDropZone
                            onFiles={paths => void loadSource(paths)}
                            filters={audioInputFilters(t)}
                            accept={AUDIO_INPUT_EXTENSIONS}
                            hint={t('voice.conversion.dropHint')}
                            sx={{ minHeight: 200, opacity: ready ? 1 : 0.6, pointerEvents: ready ? 'auto' : 'none' }}
                        />
                    )}
                    {sep.source && (
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
                            {/* 分離した音から、変換する音と、伴奏として重ねる音を選ぶ (分離の木と同じ字下げで並べる) */}
                            {outputs.length > 0 && (
                                <Panel>
                                    <Stack spacing={1.5}>
                                        <FormControl size='small' sx={{ maxWidth: 360 }} disabled={busy}>
                                            <InputLabel id='conversion-vocals-track'>
                                                {t('voice.conversion.vocalsTrack')}
                                            </InputLabel>
                                            <Select
                                                labelId='conversion-vocals-track'
                                                label={t('voice.conversion.vocalsTrack')}
                                                value={vocalsTrack?.key ?? ''}
                                                onChange={event => conv.setVocalsTrack(String(event.target.value))}
                                                renderValue={key =>
                                                    outputs.find(output => output.key === key)?.path ?? ''
                                                }
                                            >
                                                {outputs.map(output => (
                                                    <MenuItem
                                                        key={output.key}
                                                        value={output.key}
                                                        sx={{ pl: 2 + output.depth * 3 }}
                                                    >
                                                        {output.label}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        {outputs.length > 1 && (
                                            <Box>
                                                <Typography variant='body2' color='text.secondary'>
                                                    {t('voice.conversion.accompanimentTracks')}
                                                </Typography>
                                                <Stack>
                                                    {outputs
                                                        .filter(output => output !== vocalsTrack)
                                                        .map(output => (
                                                            <FormControlLabel
                                                                key={output.key}
                                                                disabled={busy}
                                                                sx={{ pl: output.depth * 3, mr: 0 }}
                                                                control={
                                                                    <Checkbox
                                                                        size='small'
                                                                        checked={accompanimentKeys.includes(output.key)}
                                                                        onChange={(_event, checked) =>
                                                                            conv.setAccompanimentTracks(
                                                                                checked
                                                                                    ? [...accompanimentKeys, output.key]
                                                                                    : accompanimentKeys.filter(
                                                                                          key => key !== output.key
                                                                                      )
                                                                            )
                                                                        }
                                                                    />
                                                                }
                                                                label={
                                                                    <Typography variant='body2'>
                                                                        {output.label}
                                                                    </Typography>
                                                                }
                                                            />
                                                        ))}
                                                </Stack>
                                            </Box>
                                        )}
                                    </Stack>
                                </Panel>
                            )}
                        </>
                    )}
                    {conv.inputMode === 'direct' && sep.source && (
                        <SyncPlayer source={{ key: 'direct', url: sep.source.media.url }} />
                    )}
                    <Panel sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant='body2' sx={{ flexGrow: 1, lineHeight: 1.6 }}>
                            {hasVocals
                                ? t('voice.conversion.inputSummary', {
                                      accompaniment:
                                          accompaniment.length > 0
                                              ? t('voice.conversion.withAccompaniment')
                                              : t('voice.conversion.withoutAccompaniment'),
                                  })
                                : t('voice.conversion.inputMissing')}
                        </Typography>
                        <Button variant='contained' disabled={!hasVocals || busy} onClick={goToConversion}>
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
                                            {/* ユーザーモデルにだけ、名前の右にアイコンを付ける */}
                                            <Box component='span' sx={{ flexGrow: 1, minWidth: 0, mr: 1 }}>
                                                {voiceLabel(item)}
                                            </Box>
                                            <UserModelIcon voice={item} />
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
                                    value={f0Methods.includes(conv.params.f0Method) ? conv.params.f0Method : ''}
                                    onChange={event =>
                                        conv.setParams({ ...conv.params, f0Method: event.target.value as F0Method })
                                    }
                                >
                                    {f0Methods.map(method => (
                                        <MenuItem key={method} value={method}>
                                            {t(`voice.conversion.f0Methods.${method}`)}
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
                                disabled={
                                    busy || !voice || !hasVocals || !ready || !f0Methods.includes(conv.params.f0Method)
                                }
                                onClick={() => void runConversion()}
                            >
                                {t('voice.conversion.run')}
                            </Button>
                        </Stack>
                    </Panel>
                    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                        {/* 元の音源・変換前のボーカルを上に置き、作った候補を作った順に下へ足していく */}
                        <Panel>
                            <Stack spacing={1.5}>
                                {sourceMedia &&
                                    playerRow('source', t('voice.conversion.targets.source'), sourceMedia.url)}
                                {conv.inputMode === 'separate' &&
                                    vocalsMedia &&
                                    playerRow(
                                        'original-vocals',
                                        t('voice.conversion.targets.originalVocals'),
                                        vocalsMedia.url
                                    )}
                            </Stack>
                        </Panel>
                        <SectionLabel>{t('voice.conversion.candidates')}</SectionLabel>
                        {conv.candidates.length === 0 ? (
                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t('voice.conversion.noCandidates')}
                            </Typography>
                        ) : (
                            conv.candidates.map(candidate => (
                                <Panel key={candidate.id}>
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                                            <FormControlLabel
                                                sx={{ m: 0 }}
                                                control={
                                                    <Radio
                                                        size='small'
                                                        checked={conv.adoptedId === candidate.id}
                                                        onChange={() => conv.setAdopted(candidate.id)}
                                                        slotProps={{ input: { 'aria-label': candidate.voiceName } }}
                                                    />
                                                }
                                                label={
                                                    <Typography variant='body2' color='text.secondary'>
                                                        {t('voice.separation.adopt')}
                                                    </Typography>
                                                }
                                            />
                                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
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
                                            </Box>
                                            <Tooltip title={t('voice.common.deleteCandidate')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('voice.common.deleteCandidate')}
                                                        disabled={busy}
                                                        onClick={() => {
                                                            conv.removeCandidate(candidate.id);
                                                            void window.kuraToolkit.voice.media.discard(
                                                                workKey,
                                                                candidateFiles(candidate)
                                                            );
                                                        }}
                                                    >
                                                        <DeleteOutlineIcon fontSize='small' />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Stack>
                                        {playerRow(
                                            `${candidate.id}-converted`,
                                            t('voice.conversion.targets.converted'),
                                            candidate.vocals.url
                                        )}
                                        {accompaniment.length > 0 &&
                                            playerRow(
                                                `${candidate.id}-with-accompaniment-${candidate.withAccompaniment?.path ?? ''}`,
                                                t('voice.conversion.targets.withAccompaniment'),
                                                candidate.withAccompaniment?.url ?? null,
                                                <Button
                                                    size='small'
                                                    variant='outlined'
                                                    startIcon={
                                                        candidate.withAccompaniment ? (
                                                            <RefreshIcon />
                                                        ) : (
                                                            <QueueMusicIcon />
                                                        )
                                                    }
                                                    disabled={busy}
                                                    aria-label={t('voice.conversion.withAccompanimentFor', {
                                                        name: candidate.voiceName,
                                                    })}
                                                    onClick={() => void createWithAccompaniment(candidate)}
                                                >
                                                    {candidate.withAccompaniment
                                                        ? t('voice.conversion.withAccompanimentRecreate')
                                                        : t('voice.conversion.withAccompanimentCreate')}
                                                </Button>
                                            )}
                                    </Stack>
                                </Panel>
                            ))
                        )}
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
                            <Button
                                variant='contained'
                                startIcon={<TuneIcon />}
                                disabled={busy || !adopted}
                                onClick={() => void createMix()}
                            >
                                {t('voice.mix.preview')}
                            </Button>
                        </Stack>
                    </Panel>
                    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                            {t('voice.mix.hint')}
                        </Typography>
                        {mixStale && <Alert severity='info'>{t('voice.mix.stale')}</Alert>}
                        <Panel>
                            <Stack spacing={1.5}>
                                {sourceMedia &&
                                    playerRow('mix-source', t('voice.conversion.targets.source'), sourceMedia.url)}
                                {playerRow(
                                    `mix-${conv.mixSignature ?? ''}`,
                                    t('voice.conversion.targets.mix'),
                                    conv.mix?.url ?? null
                                )}
                                {!conv.mix && (
                                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                        {t('voice.mix.notCreated')}
                                    </Typography>
                                )}
                            </Stack>
                        </Panel>
                        <Stack direction='row' spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Button onClick={() => conv.setStep(1)}>{t('voice.common.back')}</Button>
                            <Button variant='contained' disabled={!adopted || busy} onClick={() => setExportOpen(true)}>
                                {t('voice.export.open')}
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            )}

            <ExportDialog
                workKey={workKey}
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

            <AppDialog open={resetConfirm} onClose={() => setResetConfirm(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.common.newWork')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.common.newWorkConfirm')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetConfirm(false)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            startNewWork();
                            setResetConfirm(false);
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
                status={job?.status}
                message={job?.message ?? ''}
                onCancel={cancel}
            />
        </PageContainer>
    );
}
