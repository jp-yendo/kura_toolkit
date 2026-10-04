import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    ListSubheader,
    MenuItem,
    Radio,
    Select,
    Stack,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tabs,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import DownloadIcon from '@mui/icons-material/Download';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import AppDialog from '../common/AppDialog';
import Panel from '../common/Panel';
import SectionLabel from '../common/SectionLabel';
import ProgressDialog from '../common/ProgressDialog';
import PresetBar from './PresetBar';
import SeparationParamsForm from './SeparationParamsForm';
import SyncPlayer, { type PlayerSource } from './SyncPlayer';
import {
    assignRoles,
    computeTracks,
    roleLabelKey,
    SOURCE_KEY,
    stageRoles,
    type SepStage,
    type Track,
} from './separationTracks';
import { isCancelledError, missingItemsFromError, voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { openVoiceLibrary, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import type { SeparationWorkStore } from '../../stores/separationWorkStore';
import {
    ENSEMBLE_ALGORITHMS,
    type EnsembleAlgorithm,
    type MediaRef,
    type SeparationArch,
    type SeparationCandidate,
    type SeparationCategory,
    type SeparationMethod,
    type SeparationModelList,
    type SeparationParams,
    type SeparationPresetParams,
} from '@shared/voice/types';

const CATEGORIES: SeparationCategory[] = ['vocals', 'multi', 'karaoke', 'cleanup', 'other'];
const CENTER_CANCEL = 'center-cancel';
const CUSTOM_ENSEMBLE = 'custom-ensemble';
const ARCH_KEYS: Record<SeparationArch, keyof SeparationParams> = {
    MDX: 'mdx',
    VR: 'vr',
    Demucs: 'demucs',
    MDXC: 'mdxc',
};
// 組み合わせるモデルの選択欄に名前を並べる上限 (超えたら数で示す)
const ENSEMBLE_NAMES_SHOWN = 2;

type PlaySelection = { kind: 'original' } | { kind: 'candidate'; candidateId: string; stems: string[] };

// 複数の出力を重ねた再生用の音 (組み合わせごとに作り、作り直したら前のものは消す)
type Overlay = { key: string; media: MediaRef };

type Props = {
    store: SeparationWorkStore;
    disabled?: boolean;
};

function stemLabel(t: TFunction, category: SeparationCategory, stemName: string, role: string): string {
    const key = roleLabelKey(category, role);
    return key ? `${t(key)} (${stemName})` : stemName;
}

// 出力の名前 (分離の品質の表示に使う)。訳がある名前は訳を、それ以外はそのまま表示する
function outputName(t: TFunction, name: string): string {
    const key = `voice.stems.${name.toLowerCase()}`;
    return i18n.exists(key) ? t(key) : name;
}

export function trackLabel(t: (key: string) => string, track: Track): string {
    return track.labelKey ? t(track.labelKey) : (track.label ?? track.key);
}

// 分離の操作部。音声分離の画面と、音声変換の画面 (入力と分離) で共用する
export default function SeparationWorkbench({ store, disabled }: Props) {
    const { t } = useTranslation();
    const libraryVersion = useVoiceLibraryStore(state => state.version);
    const {
        workKey,
        source,
        stages,
        activeStage,
        params,
        setActiveStage,
        addStage,
        truncateAfter,
        updateStage,
        addCandidate,
        removeCandidate,
        setParams,
    } = store();
    const [models, setModels] = React.useState<SeparationModelList | null>(null);
    const [modelError, setModelError] = React.useState<string | null>(null);
    const [methodKey, setMethodKey] = React.useState('');
    const [ensembleModels, setEnsembleModels] = React.useState<string[]>([]);
    const [algorithm, setAlgorithm] = React.useState<EnsembleAlgorithm>('avg_wave');
    const [play, setPlay] = React.useState<PlaySelection>({ kind: 'original' });
    const [overlay, setOverlay] = React.useState<Overlay | null>(null);
    const overlayRef = React.useRef<Overlay | null>(null);
    const [pendingAdoption, setPendingAdoption] = React.useState<{ index: number; patch: Partial<SepStage> } | null>(
        null
    );
    // 最後の段階の削除の確認。閉じる間も表示が変わらないよう、段階の名前を開いた時点で持つ
    const [removeStageConfirm, setRemoveStageConfirm] = React.useState({ open: false, name: '' });
    const { job, run, cancel } = useJobRunner();

    const loadModels = React.useCallback(
        async (refresh = false) => {
            try {
                setModels(await window.kuraToolkit.voice.separation.listModels(refresh));
                setModelError(null);
            } catch (error) {
                setModelError(voiceErrorMessage(t, error));
            }
        },
        [t]
    );

    // ダウンロードでモデルの取得状況が変わったら読み直す
    React.useEffect(() => {
        void loadModels();
    }, [loadModels, libraryVersion]);

    const stage = stages[activeStage];
    const before = React.useMemo(
        () => computeTracks(source?.media.path ?? null, stages.slice(0, activeStage)),
        [source, stages, activeStage]
    );
    const after = React.useMemo(() => computeTracks(source?.media.path ?? null, stages), [source, stages]);
    const inputTrack = before.tracks.find(track => track.key === stage?.inputKey);

    // 段階を切り替えたら、再生対象をその段階の入力に戻す
    React.useEffect(() => {
        setPlay({ kind: 'original' });
    }, [activeStage]);

    // 重ねた音を置き換える。使わなくなった前の音は消す
    const replaceOverlay = (next: Overlay | null) => {
        const previous = overlayRef.current;
        overlayRef.current = next;
        setOverlay(next);
        if (previous && previous.media.path !== next?.media.path)
            void window.kuraToolkit.voice.media.discard([previous.media.path]);
    };

    // --- 再生対象 (複数の出力を選んだ場合は重ねた音を作る) ---
    const playCandidate =
        play.kind === 'candidate' ? stage?.candidates.find(item => item.id === play.candidateId) : undefined;
    const playStems =
        playCandidate && play.kind === 'candidate'
            ? playCandidate.stems.filter(stem => play.stems.includes(stem.name))
            : [];
    const mixKey = playStems.map(stem => stem.media.path).join('|');
    const sourceChannels = source?.channels ?? 2;
    React.useEffect(() => {
        if (playStems.length < 2 || overlayRef.current?.key === mixKey) return;
        let cancelled = false;
        const jobId = crypto.randomUUID();
        void window.kuraToolkit.voice.media
            .mix(
                jobId,
                workKey,
                playStems.map(stem => stem.media.path),
                sourceChannels
            )
            .then(media => {
                // 作っている間に選択が変わった場合は使わないので消す
                if (cancelled) void window.kuraToolkit.voice.media.discard([media.path]);
                else replaceOverlay({ key: mixKey, media });
            })
            .catch(error => showNotice('error', voiceErrorMessage(t, error)));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 組み合わせ (mixKey) が変わったときだけ作る
    }, [mixKey]);

    if (!source || !stage) return null;
    const category = stage.category;
    const categoryModels = (models?.models ?? []).filter(model => model.category === category);
    const categoryPresets = (models?.presets ?? []).filter(preset => preset.category === category);
    const installedModels = categoryModels.filter(model => model.installed);

    // 選択中の方式
    let method: SeparationMethod | null = null;
    let methodArchs: SeparationArch[] = [];
    let missingItems: string[] = [];
    if (methodKey === CENTER_CANCEL) {
        method = { kind: 'centerCancel' };
    } else if (methodKey === CUSTOM_ENSEMBLE) {
        if (ensembleModels.length >= 2) method = { kind: 'ensemble', filenames: ensembleModels, algorithm };
        methodArchs = [
            ...new Set(
                categoryModels.filter(model => ensembleModels.includes(model.filename)).map(model => model.arch)
            ),
        ];
    } else if (methodKey.startsWith('preset:')) {
        const preset = categoryPresets.find(item => `preset:${item.id}` === methodKey);
        if (preset) {
            method = { kind: 'ensemblePreset', presetId: preset.id };
            const members = (models?.models ?? []).filter(model => preset.models.includes(model.filename));
            methodArchs = [...new Set(members.map(model => model.arch))];
            missingItems = members.filter(model => !model.installed).map(model => model.itemId);
        }
    } else if (methodKey.startsWith('model:')) {
        const model = categoryModels.find(item => `model:${item.filename}` === methodKey);
        if (model) {
            method = { kind: 'model', filename: model.filename };
            methodArchs = [model.arch];
            if (!model.installed) missingItems = [model.itemId];
        }
    }
    const selectedModel = methodKey.startsWith('model:')
        ? categoryModels.find(item => `model:${item.filename}` === methodKey)
        : undefined;
    const quality = selectedModel
        ? Object.entries(selectedModel.sdr)
              .filter(([, value]) => value !== null)
              .map(([stem, value]) => `${outputName(t, stem)} ${Number(value).toFixed(1)}`)
              .join(' / ')
        : '';
    const busy = disabled || job !== null;
    const canEditStage = stage.candidates.length === 0;
    const lastIndex = stages.length - 1;

    const candidateLabel = (candidate: SeparationCandidate) =>
        candidate.method.kind === 'centerCancel' ? t('voice.separation.centerCancel') : candidate.methodLabel;
    const stageName = (item: SepStage, index: number) =>
        t('voice.separation.stageLabel', {
            index: index + 1,
            category: t(`voice.separation.categories.${item.category}`),
        });

    // 候補を破棄する (出力のファイルと、それを使った重ねた音を消す)
    const discardCandidates = (candidates: SeparationCandidate[]) => {
        const paths = candidates.flatMap(candidate => candidate.stems.map(stem => stem.media.path));
        if (paths.length === 0) return;
        void window.kuraToolkit.voice.media.discard(paths);
        if (overlayRef.current && paths.some(path => overlayRef.current?.key.split('|').includes(path)))
            replaceOverlay(null);
    };

    const runSeparation = async () => {
        if (!method || !inputTrack) return;
        if (missingItems.length > 0) {
            openVoiceLibrary({ select: missingItems, focus: 'separator' });
            return;
        }
        const input = inputTrack.paths.length === 1 ? inputTrack.paths[0] : null;
        try {
            const candidate = await run(t('voice.separation.running'), async jobId => {
                // 複数の音を重ねたトラック (伴奏に戻したコーラスなど) は、先に 1 つにしてから分離する
                const inputPath =
                    input ??
                    (await window.kuraToolkit.voice.media.mix(jobId, workKey, inputTrack.paths, source.channels)).path;
                return window.kuraToolkit.voice.separation.run(jobId, {
                    workKey,
                    input: inputPath,
                    channels: source.channels,
                    method: method as SeparationMethod,
                    params,
                    category,
                });
            });
            addCandidate(activeStage, candidate);
            setPlay({ kind: 'candidate', candidateId: candidate.id, stems: [candidate.stems[0]?.name ?? ''] });
        } catch (error) {
            if (isCancelledError(error)) {
                showNotice('warning', t('voice.common.cancelled'));
                return;
            }
            const missing = missingItemsFromError(error);
            showNotice('error', voiceErrorMessage(t, error), 10000);
            if (missing.length > 0) openVoiceLibrary({ select: missing, focus: 'separator' });
        }
    };

    // 採用を変えると後ろの段階の結果は無効になる。後ろに段階がある場合は確認してから変える
    const changeAdoption = (patch: Partial<SepStage>) => {
        if (activeStage < lastIndex && stages.slice(activeStage + 1).some(item => item.candidates.length > 0)) {
            setPendingAdoption({ index: activeStage, patch });
            return;
        }
        updateStage(activeStage, patch);
    };

    const applyPendingAdoption = () => {
        if (!pendingAdoption) return;
        const removed = truncateAfter(pendingAdoption.index);
        updateStage(pendingAdoption.index, pendingAdoption.patch);
        discardCandidates(removed);
        setPendingAdoption(null);
    };

    // 最後の段階を取り除く。候補がある場合は確認してから破棄する
    const closeRemoveStage = () => setRemoveStageConfirm(previous => ({ ...previous, open: false }));
    const removeLastStage = () => {
        closeRemoveStage();
        discardCandidates(truncateAfter(lastIndex - 1));
    };
    const askRemoveLastStage = () => {
        if (stages[lastIndex].candidates.length > 0)
            setRemoveStageConfirm({ open: true, name: stageName(stages[lastIndex], lastIndex) });
        else removeLastStage();
    };

    const deleteCandidate = (candidate: SeparationCandidate) => {
        const adoptedSomewhere =
            stage.sameCandidate === candidate.id || Object.values(stage.perRole).includes(candidate.id);
        if (adoptedSomewhere && activeStage < lastIndex) {
            // 後ろの段階が使っている候補は消せない (採用を変えてから消す)
            showNotice('warning', t('voice.separation.candidateInUse'));
            return;
        }
        removeCandidate(activeStage, candidate.id);
        discardCandidates([candidate]);
        if (play.kind === 'candidate' && play.candidateId === candidate.id) setPlay({ kind: 'original' });
    };

    let playerSource: PlayerSource | null = null;
    if (play.kind === 'original') {
        const path = inputTrack?.paths.length === 1 ? inputTrack.paths[0] : null;
        const media = path === source.media.path ? source.media : null;
        if (media)
            playerSource = { key: `original-${stage.id}`, url: media.url, label: t('voice.separation.playOriginal') };
        else if (inputTrack && path) {
            const candidateStem = stages
                .flatMap(item => item.candidates)
                .flatMap(candidate => candidate.stems)
                .find(stem => stem.media.path === path);
            if (candidateStem)
                playerSource = {
                    key: `input-${stage.id}`,
                    url: candidateStem.media.url,
                    label: t('voice.separation.playInput', { name: trackLabel(t, inputTrack) }),
                };
        }
    } else if (playCandidate) {
        const assigned = assignRoles(
            category,
            playCandidate.stems.map(stem => stem.name)
        );
        const stemsLabel = playStems.map(stem => stemLabel(t, category, stem.name, assigned[stem.name])).join(' + ');
        if (playStems.length === 1) {
            playerSource = {
                key: `${playCandidate.id}-${playStems[0].name}`,
                url: playStems[0].media.url,
                label: `${candidateLabel(playCandidate)} - ${stemsLabel}`,
            };
        } else if (playStems.length > 1 && overlay?.key === mixKey) {
            playerSource = {
                key: `${playCandidate.id}-mix-${mixKey}`,
                url: overlay.media.url,
                label: `${candidateLabel(playCandidate)} - ${stemsLabel}`,
            };
        }
    }

    const toggleStem = (candidate: SeparationCandidate, stemName: string) => {
        setPlay(previous => {
            if (previous.kind !== 'candidate' || previous.candidateId !== candidate.id) {
                return { kind: 'candidate', candidateId: candidate.id, stems: [stemName] };
            }
            const stems = previous.stems.includes(stemName)
                ? previous.stems.filter(name => name !== stemName)
                : [...previous.stems, stemName];
            return stems.length === 0 ? { kind: 'original' } : { ...previous, stems };
        });
    };

    const roles = stageRoles(stage);
    const lastComplete = after.completedStages === stages.length;

    // パラメーターの値の表示 (未指定はモデルの既定、オン・オフは言葉で示す)
    const paramValue = (value: unknown) => {
        if (value === null) return t('voice.separation.params.modelDefault');
        if (typeof value === 'boolean') return value ? t('voice.common.on') : t('voice.common.off');
        return String(value);
    };
    const archName = (key: string) =>
        (Object.keys(ARCH_KEYS) as SeparationArch[]).find(arch => ARCH_KEYS[arch] === key) ?? key;
    const paramsSummary = (candidate: SeparationCandidate) =>
        Object.entries(candidate.params)
            .map(
                ([key, values]) =>
                    `${archName(key)}: ${Object.entries(values as Record<string, unknown>)
                        .map(([name, value]) => `${t(`voice.separation.params.${name}`)}=${paramValue(value)}`)
                        .join(', ')}`
            )
            .join(' / ');

    const modelName = (filename: string) =>
        installedModels.find(model => model.filename === filename)?.name ?? filename;

    return (
        <Stack spacing={2}>
            <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                <Tabs
                    value={activeStage}
                    onChange={(_e, value: number) => setActiveStage(value)}
                    variant='scrollable'
                    sx={{ flexGrow: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
                >
                    {stages.map((item, index) => (
                        <Tab key={item.id} value={index} label={stageName(item, index)} />
                    ))}
                </Tabs>
                {stages.length > 1 && (
                    <Button
                        size='small'
                        color='inherit'
                        startIcon={<RemoveIcon />}
                        disabled={busy}
                        onClick={askRemoveLastStage}
                    >
                        {t('voice.separation.removeStage')}
                    </Button>
                )}
                <Tooltip title={lastComplete ? '' : t('voice.separation.addStageHint')}>
                    <span>
                        <Button
                            size='small'
                            startIcon={<AddIcon />}
                            disabled={busy || !lastComplete}
                            onClick={() => {
                                const vocals = after.tracks.find(track => track.key === 'vocals');
                                addStage(
                                    vocals ? vocals.key : (after.tracks[0]?.key ?? SOURCE_KEY),
                                    vocals ? 'karaoke' : 'vocals'
                                );
                            }}
                        >
                            {t('voice.separation.addStage')}
                        </Button>
                    </span>
                </Tooltip>
            </Stack>

            {modelError && (
                <Alert
                    severity='warning'
                    action={
                        <Button color='inherit' size='small' onClick={() => void loadModels(true)}>
                            {t('voice.common.retry')}
                        </Button>
                    }
                >
                    {modelError}
                </Alert>
            )}

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '340px minmax(0, 1fr)' },
                    gap: 2,
                    alignItems: 'start',
                }}
            >
                {/* 左: 分離の設定 */}
                <Panel>
                    <Stack spacing={2}>
                        {activeStage > 0 && (
                            <FormControl size='small' disabled={busy || !canEditStage}>
                                <InputLabel id='stage-input'>{t('voice.separation.stageInput')}</InputLabel>
                                <Select
                                    labelId='stage-input'
                                    label={t('voice.separation.stageInput')}
                                    value={
                                        before.tracks.some(track => track.key === stage.inputKey) ? stage.inputKey : ''
                                    }
                                    onChange={event =>
                                        updateStage(activeStage, { inputKey: String(event.target.value) })
                                    }
                                >
                                    {before.tracks.map(track => (
                                        <MenuItem key={track.key} value={track.key}>
                                            {trackLabel(t, track)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        <FormControl size='small' disabled={busy || !canEditStage}>
                            <InputLabel id='stage-category'>{t('voice.separation.category')}</InputLabel>
                            <Select
                                labelId='stage-category'
                                label={t('voice.separation.category')}
                                value={category}
                                onChange={event => {
                                    updateStage(activeStage, { category: event.target.value as SeparationCategory });
                                    setMethodKey('');
                                    setEnsembleModels([]);
                                }}
                            >
                                {CATEGORIES.map(item => (
                                    <MenuItem key={item} value={item}>
                                        {t(`voice.separation.categories.${item}`)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {!canEditStage && (
                            <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                                {t('voice.separation.stageLocked')}
                            </Typography>
                        )}
                        <FormControl size='small' disabled={busy}>
                            <InputLabel id='separation-method'>{t('voice.separation.method')}</InputLabel>
                            <Select
                                labelId='separation-method'
                                label={t('voice.separation.method')}
                                value={methodKey}
                                onChange={event => setMethodKey(String(event.target.value))}
                                MenuProps={{ slotProps: { paper: { sx: { maxHeight: 460 } } } }}
                            >
                                {category === 'vocals' && (
                                    <ListSubheader>{t('voice.separation.classicMethods')}</ListSubheader>
                                )}
                                {category === 'vocals' && (
                                    <MenuItem value={CENTER_CANCEL}>{t('voice.separation.centerCancel')}</MenuItem>
                                )}
                                {categoryPresets.length > 0 && (
                                    <ListSubheader>{t('voice.separation.ensemblePresets')}</ListSubheader>
                                )}
                                {categoryPresets.map(preset => (
                                    <MenuItem key={preset.id} value={`preset:${preset.id}`}>
                                        {preset.name}
                                        {!preset.installed && (
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
                                {installedModels.length >= 2 && (
                                    <MenuItem value={CUSTOM_ENSEMBLE}>{t('voice.separation.customEnsemble')}</MenuItem>
                                )}
                                <ListSubheader>{t('voice.separation.models')}</ListSubheader>
                                {categoryModels.map(model => (
                                    <MenuItem key={model.filename} value={`model:${model.filename}`}>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant='body2' noWrap>
                                                {model.name}
                                            </Typography>
                                            <Typography variant='caption' color='text.secondary'>
                                                {model.arch}
                                                {model.installed ? '' : ` / ${t('voice.separation.notDownloaded')}`}
                                            </Typography>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Button
                            size='small'
                            startIcon={<DownloadIcon />}
                            onClick={() => openVoiceLibrary({ focus: 'separator' })}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            {t('voice.separation.getModels')}
                        </Button>
                        {quality && (
                            <Tooltip title={t('voice.separation.qualityHint')} describeChild>
                                <Stack
                                    direction='row'
                                    spacing={0.5}
                                    sx={{ alignItems: 'center', alignSelf: 'flex-start', color: 'text.secondary' }}
                                >
                                    <Typography variant='caption' sx={{ lineHeight: 1.5 }}>
                                        {t('voice.separation.quality', { values: quality })}
                                    </Typography>
                                    <InfoOutlinedIcon sx={{ fontSize: 14 }} />
                                </Stack>
                            </Tooltip>
                        )}
                        {methodKey.startsWith('preset:') && (
                            <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                                {categoryPresets.find(item => `preset:${item.id}` === methodKey)?.description}
                            </Typography>
                        )}
                        {methodKey === CUSTOM_ENSEMBLE && (
                            <Stack spacing={1}>
                                <FormControl size='small'>
                                    <InputLabel id='ensemble-models'>{t('voice.separation.ensembleModels')}</InputLabel>
                                    <Select
                                        labelId='ensemble-models'
                                        label={t('voice.separation.ensembleModels')}
                                        multiple
                                        value={ensembleModels}
                                        onChange={event => setEnsembleModels(event.target.value as string[])}
                                        renderValue={value => {
                                            const filenames = value as string[];
                                            return filenames.length > ENSEMBLE_NAMES_SHOWN
                                                ? t('voice.separation.modelCount', { count: filenames.length })
                                                : filenames.map(modelName).join(t('voice.common.listSeparator'));
                                        }}
                                    >
                                        {installedModels.map(model => (
                                            <MenuItem key={model.filename} value={model.filename}>
                                                <Checkbox
                                                    size='small'
                                                    checked={ensembleModels.includes(model.filename)}
                                                />
                                                {model.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size='small'>
                                    <InputLabel id='ensemble-algorithm'>{t('voice.separation.algorithm')}</InputLabel>
                                    <Select
                                        labelId='ensemble-algorithm'
                                        label={t('voice.separation.algorithm')}
                                        value={algorithm}
                                        onChange={event => setAlgorithm(event.target.value as EnsembleAlgorithm)}
                                    >
                                        {ENSEMBLE_ALGORITHMS.map(item => (
                                            <MenuItem key={item} value={item}>
                                                {t(`voice.separation.algorithms.${item}`)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Stack>
                        )}
                        {methodArchs.map(arch => (
                            <Stack key={arch} spacing={1}>
                                <SectionLabel>{t('voice.separation.paramsFor', { arch })}</SectionLabel>
                                <PresetBar<SeparationPresetParams>
                                    kind='separation'
                                    disabled={busy}
                                    filter={preset => (preset.params as SeparationPresetParams).arch === arch}
                                    current={() => ({
                                        arch,
                                        values: params[ARCH_KEYS[arch]] as unknown as Record<
                                            string,
                                            number | boolean | null
                                        >,
                                    })}
                                    onApply={preset =>
                                        setParams({
                                            ...params,
                                            [ARCH_KEYS[arch]]: { ...params[ARCH_KEYS[arch]], ...preset.values },
                                        })
                                    }
                                />
                                <SeparationParamsForm
                                    arch={arch}
                                    params={params}
                                    onChange={setParams}
                                    disabled={busy}
                                />
                            </Stack>
                        ))}
                        <Button
                            variant='contained'
                            startIcon={missingItems.length > 0 ? undefined : <CallSplitIcon />}
                            disabled={busy || !method || !inputTrack}
                            onClick={() => void runSeparation()}
                        >
                            {missingItems.length > 0 ? t('voice.separation.downloadModel') : t('voice.separation.run')}
                        </Button>
                    </Stack>
                </Panel>

                {/* 右: 候補の比較と採用 */}
                <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                    <Stack direction='row' spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                        <SectionLabel sx={{ flexGrow: 1 }}>{t('voice.separation.candidates')}</SectionLabel>
                        <ToggleButtonGroup
                            size='small'
                            exclusive
                            value={stage.adoptionMode}
                            disabled={busy || roles.length < 2}
                            onChange={(_e, value: 'same' | 'separate' | null) => {
                                if (!value) return;
                                if (value === 'separate') {
                                    // 別々に指定するときは、その時点の選択を初期値として引き継ぐ
                                    const perRole: Record<string, string | null> = {};
                                    for (const role of roles) perRole[role] = stage.sameCandidate;
                                    changeAdoption({ adoptionMode: value, perRole });
                                } else {
                                    changeAdoption({ adoptionMode: value });
                                }
                            }}
                        >
                            <ToggleButton value='same' sx={{ textTransform: 'none', px: 1.5 }}>
                                {t('voice.separation.adoptSame')}
                            </ToggleButton>
                            <ToggleButton value='separate' sx={{ textTransform: 'none', px: 1.5 }}>
                                {t('voice.separation.adoptSeparate')}
                            </ToggleButton>
                        </ToggleButtonGroup>
                        <Button
                            size='small'
                            variant={play.kind === 'original' ? 'contained' : 'outlined'}
                            startIcon={<PlayArrowIcon />}
                            onClick={() => setPlay({ kind: 'original' })}
                        >
                            {activeStage === 0
                                ? t('voice.separation.playOriginal')
                                : t('voice.separation.playStageInput')}
                        </Button>
                    </Stack>

                    <Panel disablePadding sx={{ overflow: 'auto' }}>
                        {stage.candidates.length === 0 ? (
                            <Typography variant='body2' color='text.secondary' sx={{ p: 2, lineHeight: 1.6 }}>
                                {t('voice.separation.noCandidates')}
                            </Typography>
                        ) : (
                            <Table size='small'>
                                <TableHead>
                                    <TableRow>
                                        {stage.adoptionMode === 'same' && (
                                            <TableCell padding='checkbox'>{t('voice.separation.adopt')}</TableCell>
                                        )}
                                        <TableCell>{t('voice.separation.method')}</TableCell>
                                        <TableCell>{t('voice.separation.outputs')}</TableCell>
                                        <TableCell padding='checkbox' />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {stage.candidates.map(candidate => {
                                        const assigned = assignRoles(
                                            category,
                                            candidate.stems.map(stem => stem.name)
                                        );
                                        return (
                                            <TableRow
                                                key={candidate.id}
                                                hover
                                                selected={
                                                    play.kind === 'candidate' && play.candidateId === candidate.id
                                                }
                                            >
                                                {stage.adoptionMode === 'same' && (
                                                    <TableCell padding='checkbox'>
                                                        <Radio
                                                            size='small'
                                                            checked={stage.sameCandidate === candidate.id}
                                                            disabled={busy}
                                                            onChange={() =>
                                                                changeAdoption({ sameCandidate: candidate.id })
                                                            }
                                                            slotProps={{
                                                                input: { 'aria-label': candidateLabel(candidate) },
                                                            }}
                                                        />
                                                    </TableCell>
                                                )}
                                                <TableCell sx={{ minWidth: 180 }}>
                                                    <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                                        {candidateLabel(candidate)}
                                                    </Typography>
                                                    <Typography
                                                        variant='caption'
                                                        color='text.secondary'
                                                        sx={{ display: 'block', lineHeight: 1.5 }}
                                                    >
                                                        {paramsSummary(candidate)}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Stack
                                                        direction='row'
                                                        spacing={0.5}
                                                        sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                                                    >
                                                        {candidate.stems.map(stem => {
                                                            const active =
                                                                play.kind === 'candidate' &&
                                                                play.candidateId === candidate.id &&
                                                                play.stems.includes(stem.name);
                                                            return (
                                                                <Chip
                                                                    key={stem.name}
                                                                    size='small'
                                                                    color={active ? 'primary' : 'default'}
                                                                    variant={active ? 'filled' : 'outlined'}
                                                                    label={stemLabel(
                                                                        t,
                                                                        category,
                                                                        stem.name,
                                                                        assigned[stem.name]
                                                                    )}
                                                                    onClick={() => toggleStem(candidate, stem.name)}
                                                                />
                                                            );
                                                        })}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell padding='checkbox'>
                                                    <Tooltip title={t('voice.common.deleteCandidate')}>
                                                        <span>
                                                            <IconButton
                                                                size='small'
                                                                aria-label={t('voice.common.deleteCandidate')}
                                                                disabled={busy}
                                                                onClick={() => deleteCandidate(candidate)}
                                                            >
                                                                <DeleteOutlineIcon fontSize='small' />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </Panel>
                    {stage.candidates.length > 0 && (
                        <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                            {t('voice.separation.playHint')}
                        </Typography>
                    )}

                    {stage.adoptionMode === 'separate' && stage.candidates.length > 0 && (
                        <Panel>
                            <Stack spacing={1.5}>
                                {roles.map(role => (
                                    <FormControl key={role} size='small' disabled={busy}>
                                        <InputLabel id={`adopt-${role}`}>
                                            {roleLabelKey(category, role)
                                                ? t(roleLabelKey(category, role) as string)
                                                : role}
                                        </InputLabel>
                                        <Select
                                            labelId={`adopt-${role}`}
                                            label={
                                                roleLabelKey(category, role)
                                                    ? t(roleLabelKey(category, role) as string)
                                                    : role
                                            }
                                            value={stage.perRole[role] ?? ''}
                                            onChange={event =>
                                                changeAdoption({
                                                    perRole: { ...stage.perRole, [role]: String(event.target.value) },
                                                })
                                            }
                                        >
                                            {stage.candidates.map(candidate => (
                                                <MenuItem key={candidate.id} value={candidate.id}>
                                                    {candidateLabel(candidate)}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                ))}
                            </Stack>
                        </Panel>
                    )}

                    {category === 'karaoke' && stage.inputKey !== SOURCE_KEY && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={stage.removedToAccompaniment}
                                    disabled={busy}
                                    onChange={(_e, value) => changeAdoption({ removedToAccompaniment: value })}
                                />
                            }
                            label={t('voice.separation.removedToAccompaniment')}
                        />
                    )}

                    <SyncPlayer source={playerSource} />
                </Stack>
            </Box>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                message={job?.message ?? ''}
                onCancel={cancel}
            />

            <AppDialog open={pendingAdoption !== null} onClose={() => setPendingAdoption(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.separation.invalidateTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.separation.invalidateMessage')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingAdoption(null)}>{t('common.cancel')}</Button>
                    <Button variant='contained' color='warning' onClick={applyPendingAdoption}>
                        {t('voice.separation.invalidateRun')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={removeStageConfirm.open} onClose={closeRemoveStage} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.separation.removeStageTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.separation.removeStageMessage', { name: removeStageConfirm.name })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeRemoveStage}>{t('common.cancel')}</Button>
                    <Button variant='contained' color='warning' onClick={removeLastStage}>
                        {t('voice.common.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </Stack>
    );
}
