import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Collapse,
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
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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
import { filterSummary, useDereverbModels, useNoiseRemovalModels } from '../../components/voice/AudioFilterFields';
import { effectsSummary } from '../../components/voice/AudioEffectFields';
import CandidateFilterDialog from '../../components/voice/CandidateFilterDialog';
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
import { DEFAULT_CONVERSION_PARAMS, useConversionStore, type ConversionInputMode } from '../../stores/conversionStore';
import { openVoiceLibrary } from '../../stores/voiceLibraryStore';
import {
    F0_METHODS,
    type CandidateFilters,
    type ConversionCandidate,
    type F0Method,
    type MediaRef,
    type MixParams,
    type VoiceModelInfo,
} from '@shared/voice/types';
import { wrapMenuItemSx, wrapSelectSx } from '../../components/common/selectStyles';

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
    // 行ごとの保存 (その行の音だけを書き出す)。閉じる途中で中身が変わらないよう、開閉と項目を分けて持つ
    const [rowExport, setRowExport] = React.useState<ExportEntry | null>(null);
    const [rowExportOpen, setRowExportOpen] = React.useState(false);
    const [confirmInvalidate, setConfirmInvalidate] = React.useState(false);
    // フィルターをかける候補 (閉じる途中で中身が変わらないよう、開閉と対象を分けて持つ)
    const [filterTarget, setFilterTarget] = React.useState<ConversionCandidate | null>(null);
    const [filterOpen, setFilterOpen] = React.useState(false);
    // 変換の段階で、伴奏の音を展開して示すか
    const [accompanimentOpen, setAccompanimentOpen] = React.useState(false);
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

    // --- 変換する音 (1 つ) と伴奏 (複数の音から成る場合は、使うときに 1 つに重ねる) ---
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

    // 変換前のボーカルの再生用
    React.useEffect(() => {
        if (vocals.length === 0) {
            setVocalsMedia(null);
            return;
        }
        let cancelled = false;
        window.kuraToolkit.voice.media
            .ref(workKey, vocals[0])
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
    const noiseModels = useNoiseRemovalModels();
    const dereverbModels = useDereverbModels();

    // 候補の条件の表示 (変換のパラメーターと、フィルターをかけた候補ではかけたフィルターを処理の順に足す)
    const paramsSummary = (candidate: ConversionCandidate): string => {
        const params = candidate.params;
        const names = [...dereverbModels, ...noiseModels];
        const parts = [
            t('voice.conversion.paramsSummary', {
                pitch: params.pitch,
                f0: params.f0Method,
                index: params.indexRate.toFixed(2),
                envelope: params.volumeEnvelope.toFixed(2),
                protect: params.protect.toFixed(2),
            }),
        ];
        for (const filters of candidate.filters ?? []) {
            parts.push(
                ...filterSummary(t, { ...filters.process, loudness: undefined }, names),
                ...effectsSummary(t, filters.effects),
                ...filterSummary(t, { loudness: filters.process.loudness }, names)
            );
        }
        return parts.join(' / ');
    };
    const selected = conv.candidates.find(item => item.id === conv.selectedId) ?? null;
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

    // 候補にフィルターをかけて、新しい候補を作る (元にした候補のすぐ下に加わる)。使った値は次に開いたときに引き継ぐ。
    // 成功したら true (ダイアログを閉じる)
    const runFilter = async (filters: CandidateFilters): Promise<boolean> => {
        const target = filterTarget;
        if (!target) return false;
        conv.setCandidateFilters(filters);
        try {
            const candidate = await run(t('voice.conversion.filterRunning'), jobId =>
                window.kuraToolkit.voice.conversion.filter(jobId, { workKey, source: target, filters })
            );
            conv.addCandidate(candidate, conv.candidatesInput ?? inputKey);
            return true;
        } catch (error) {
            handleError(error);
            return false;
        }
    };

    // 分離した音の出力の、再生と書き出しに使う音声
    const outputMedia = (output: TreeOutput): MediaRef | null =>
        output.node.result.stems.find(stem => stem.name === output.stemName)?.media ?? null;
    // 伴奏として重ねる音 (分離した音の木の順)
    const accompanimentOutputs = outputs.filter(output => accompanimentKeys.includes(output.key));

    // 入力 (伴奏) が変わった場合も作り直すよう、入力も含める
    const mixSignature = selected
        ? JSON.stringify({ candidate: selected.id, input: inputKey, params: conv.mixParams })
        : null;
    const mixStale = conv.mix !== null && conv.mixSignature !== mixSignature;

    const renderMix = async (jobId: string): Promise<MediaRef> => {
        if (!selected) throw new Error('NO_CANDIDATE');
        if (conv.mix && conv.mixSignature === mixSignature) return conv.mix;
        const media = await window.kuraToolkit.voice.conversion.renderMix(jobId, {
            workKey,
            vocals: selected.vocals.path,
            accompaniment: await singlePath(jobId, accompaniment),
            channels: selected.channels,
            pitch: selected.params.pitch,
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

    // 候補の変換後のボーカルと伴奏を、音量を変えずにそのまま重ねた試聴用の音を作る (ピークが上限を超える場合は
    // 全体を一律に下げる)。ボタンを押したときだけ作る。伴奏を変えると候補ごと破棄されるため、作り直しは無い
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
            conv.setCandidatePreview(candidate.id, media);
        } catch (error) {
            handleError(error);
        }
    };

    // その音だけを書き出すボタン (書き出しのダイアログを 1 項目で開く。ファイル名は元の名前 + suffix)
    const saveButton = (key: string, name: string, media: MediaRef, suffix: string) => (
        <Tooltip title={t('voice.conversion.saveRow')}>
            <span>
                <IconButton
                    size='small'
                    aria-label={t('voice.conversion.saveRowFor', { name })}
                    disabled={busy}
                    onClick={event => {
                        // 候補のカードを選ぶクリックとして扱わない
                        event.stopPropagation();
                        setRowExport({ key, label: name, suffix, resolve: async () => media.path });
                        setRowExportOpen(true);
                    }}
                >
                    <SaveAltIcon fontSize='small' />
                </IconButton>
            </span>
        </Tooltip>
    );

    // 名前の下にプレーヤーを置く行。プレーヤーはどの行も同じ幅にして波形の位置をそろえる。
    // 行の操作 (保存) は名前の行の右端に置く
    const playerRow = (key: string, label: string, media: MediaRef, action?: React.ReactNode) => (
        <Stack key={key} spacing={0.5} sx={{ minWidth: 0 }}>
            <Stack direction='row' sx={{ alignItems: 'center', minHeight: 30 }}>
                <Typography variant='body2' sx={{ fontWeight: 600, flexGrow: 1, overflowWrap: 'anywhere' }}>
                    {label}
                </Typography>
                {action}
            </Stack>
            <SyncPlayer source={{ key, url: media.url }} keepPosition={false} />
        </Stack>
    );

    // 合成の段階の書き出しは合成結果だけ (変換後のボーカルは、変換の段階の候補ごとに書き出す)
    const exportEntries: ExportEntry[] = selected
        ? [
              {
                  key: 'mix',
                  label: t('voice.conversion.exportMix'),
                  suffix: t('voice.conversion.suffixConverted'),
                  resolve: async jobId => (await renderMix(jobId)).path,
              },
          ]
        : [];

    const steps = [
        t('voice.conversion.steps.input'),
        t('voice.conversion.steps.convert'),
        t('voice.conversion.steps.mix'),
    ];
    // 合成は、候補を作ったときから入力が変わっていない場合だけ開ける (変わった場合は変換の段階で確認する)
    const stepEnabled = [true, hasVocals, !!selected && conv.candidatesInput === inputKey];

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
                                onExportOutput={output => {
                                    // ファイル名は、元のファイル名と上の階層からの名前 (音声分離・加工の書き出しと同じ)
                                    setRowExport({
                                        key: output.key,
                                        label: output.displayPath,
                                        suffix: output.path,
                                        resolve: async () => output.mediaPath,
                                    });
                                    setRowExportOpen(true);
                                }}
                            />
                            {/* 分離した音から、変換する音と、伴奏として重ねる音を選ぶ (名前は上の階層からの名前) */}
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
                                                    outputs.find(output => output.key === key)?.displayPath ?? ''
                                                }
                                            >
                                                {outputs.map(output => (
                                                    <MenuItem key={output.key} value={output.key}>
                                                        {output.displayPath}
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
                                                                sx={{ mr: 0 }}
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
                                                                        {output.displayPath}
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
                    <Stack direction='row' sx={{ justifyContent: 'flex-end' }}>
                        <Button variant='contained' disabled={!hasVocals || busy} onClick={goToConversion}>
                            {t('voice.common.next')}
                        </Button>
                    </Stack>
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
                                    sx={wrapSelectSx}
                                >
                                    {voices.map(item => (
                                        <MenuItem key={item.id} value={item.id} sx={wrapMenuItemSx}>
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
                                defaultValue={DEFAULT_CONVERSION_PARAMS.pitch}
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
                                defaultValue={DEFAULT_CONVERSION_PARAMS.indexRate}
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
                                defaultValue={DEFAULT_CONVERSION_PARAMS.volumeEnvelope}
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
                                defaultValue={DEFAULT_CONVERSION_PARAMS.protect}
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
                        {/* 元の音源と、変換前のボーカル (伴奏は折りたたみ、展開すると伴奏として重ねる音をすべて示す) を
                            別のカードで上に置き、作った候補を下へ足していく */}
                        {sourceMedia && (
                            <Panel>{playerRow('source', t('voice.conversion.targets.source'), sourceMedia)}</Panel>
                        )}
                        {conv.inputMode === 'separate' && vocalsMedia && (
                            <Panel>
                                <Stack spacing={1.5}>
                                    {playerRow(
                                        'original-vocals',
                                        t('voice.conversion.targets.originalVocals'),
                                        vocalsMedia,
                                        saveButton(
                                            'original-vocals',
                                            t('voice.conversion.targets.originalVocals'),
                                            vocalsMedia,
                                            t('voice.conversion.suffixOriginalVocals')
                                        )
                                    )}
                                    {accompanimentOutputs.length > 0 && (
                                        <Box>
                                            <Button
                                                size='small'
                                                startIcon={accompanimentOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                                aria-expanded={accompanimentOpen}
                                                onClick={() => setAccompanimentOpen(!accompanimentOpen)}
                                            >
                                                {t('voice.conversion.accompanimentShow', {
                                                    count: accompanimentOutputs.length,
                                                })}
                                            </Button>
                                            <Collapse in={accompanimentOpen} unmountOnExit>
                                                <Stack spacing={1.5} sx={{ pt: 1 }}>
                                                    {accompanimentOutputs.map(output => {
                                                        const media = outputMedia(output);
                                                        return media
                                                            ? playerRow(
                                                                  `accompaniment-${output.key}`,
                                                                  output.displayPath,
                                                                  media,
                                                                  saveButton(
                                                                      `accompaniment-${output.key}`,
                                                                      output.displayPath,
                                                                      media,
                                                                      output.path
                                                                  )
                                                              )
                                                            : null;
                                                    })}
                                                </Stack>
                                            </Collapse>
                                        </Box>
                                    )}
                                </Stack>
                            </Panel>
                        )}
                        <SectionLabel>{t('voice.conversion.candidates')}</SectionLabel>
                        {conv.candidates.length === 0 ? (
                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t('voice.conversion.noCandidates')}
                            </Typography>
                        ) : (
                            conv.candidates.map(candidate => (
                                // 候補のカードをクリックする (再生を含む) と選んだ状態になり、合成ではこの候補を使う
                                <Panel
                                    key={candidate.id}
                                    selected={conv.selectedId === candidate.id}
                                    onClick={() => conv.selectCandidate(candidate.id)}
                                >
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                                <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                                    {candidate.voiceName}
                                                </Typography>
                                                <Typography variant='caption' color='text.secondary'>
                                                    {paramsSummary(candidate)}
                                                </Typography>
                                            </Box>
                                            {/* 見出しの行には候補全体の操作 (削除) だけを置く。フィルターと保存は、どの音に
                                                かかるかが分かるよう、変換後のボーカルの行に置く */}
                                            <Tooltip title={t('voice.common.deleteCandidate')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('voice.common.deleteCandidate')}
                                                        disabled={busy}
                                                        onClick={event => {
                                                            // 消す候補を選んだ状態にしない (カードのクリックとして扱わない)
                                                            event.stopPropagation();
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
                                            candidate.vocals,
                                            <Stack direction='row' spacing={0.5}>
                                                <Tooltip title={t('voice.filters.filterButton')}>
                                                    <span>
                                                        <IconButton
                                                            size='small'
                                                            aria-label={t('voice.filters.filterFor', {
                                                                name: `${candidate.voiceName} ${t('voice.conversion.targets.converted')}`,
                                                            })}
                                                            disabled={busy}
                                                            onClick={event => {
                                                                // 候補のカードを選ぶクリックとして扱わない
                                                                event.stopPropagation();
                                                                setFilterTarget(candidate);
                                                                setFilterOpen(true);
                                                            }}
                                                        >
                                                            <GraphicEqIcon fontSize='small' />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                                {saveButton(
                                                    `${candidate.id}-converted`,
                                                    `${candidate.voiceName} ${t('voice.conversion.targets.converted')}`,
                                                    candidate.vocals,
                                                    `${candidate.voiceName}_${t('voice.conversion.suffixConvertedVocals')}`
                                                )}
                                            </Stack>
                                        )}
                                        {/* 伴奏と重ねた音は、ボタンを押したときに作る (変換の実行では作らない) */}
                                        {accompaniment.length > 0 &&
                                            (candidate.withAccompaniment ? (
                                                playerRow(
                                                    `${candidate.id}-with-accompaniment`,
                                                    t('voice.conversion.targets.withAccompaniment'),
                                                    candidate.withAccompaniment
                                                )
                                            ) : (
                                                <Box>
                                                    <Button
                                                        size='small'
                                                        variant='outlined'
                                                        startIcon={<HeadphonesIcon />}
                                                        disabled={busy}
                                                        aria-label={t('voice.conversion.withAccompanimentFor', {
                                                            name: candidate.voiceName,
                                                        })}
                                                        onClick={() => void createWithAccompaniment(candidate)}
                                                    >
                                                        {t('voice.conversion.withAccompanimentCreate')}
                                                    </Button>
                                                </Box>
                                            ))}
                                    </Stack>
                                </Panel>
                            ))
                        )}
                        <Stack direction='row' spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Button onClick={() => conv.setStep(0)}>{t('voice.common.back')}</Button>
                            <Button variant='contained' disabled={!selected} onClick={() => conv.setStep(2)}>
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
                            <Button variant='contained' disabled={busy || !selected} onClick={() => void createMix()}>
                                {t('voice.mix.preview')}
                            </Button>
                        </Stack>
                    </Panel>
                    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                        {mixStale && <Alert severity='info'>{t('voice.mix.stale')}</Alert>}
                        <Panel>
                            <Stack spacing={1.5}>
                                {sourceMedia &&
                                    playerRow('mix-source', t('voice.conversion.targets.source'), sourceMedia)}
                                {conv.mix &&
                                    playerRow(
                                        `mix-${conv.mixSignature ?? ''}`,
                                        t('voice.conversion.targets.mix'),
                                        conv.mix
                                    )}
                            </Stack>
                        </Panel>
                        <Stack direction='row' spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Button onClick={() => conv.setStep(1)}>{t('voice.common.back')}</Button>
                            <Button
                                variant='contained'
                                disabled={!selected || busy}
                                onClick={() => setExportOpen(true)}
                            >
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
            <CandidateFilterDialog
                open={filterOpen && filterTarget !== null && job === null}
                name={filterTarget?.voiceName ?? ''}
                initial={conv.candidateFilters}
                stereo={filterTarget?.channels === 2}
                dereverbModels={dereverbModels}
                noiseModels={noiseModels}
                onRun={runFilter}
                onClose={() => setFilterOpen(false)}
                disabled={busy}
            />
            <ExportDialog
                workKey={workKey}
                open={rowExportOpen}
                onClose={() => setRowExportOpen(false)}
                entries={rowExport ? [rowExport] : []}
                sourcePath={sourcePath || 'output'}
                fixedSelection
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
