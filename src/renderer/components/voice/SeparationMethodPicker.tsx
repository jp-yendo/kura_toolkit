import React from 'react';
import {
    Autocomplete,
    Box,
    FormControl,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import SeparatorModelSummary from './SeparatorModelSummary';
import { filterSeparatorModels, separatorDisplayName } from './separatorModelNotes';
import { SEPARATOR_PURPOSES } from './separatorPurposes';
import { compareSeparatorModels, SEPARATION_CATEGORIES } from './separatorCategories';
import {
    ENSEMBLE_ALGORITHMS,
    type EnsembleAlgorithm,
    type SeparationArch,
    type SeparationCategory,
    type SeparationMethod,
    type SeparationMethodChoice,
    type SeparationOtherChoice,
    type SeparationModel,
    type SeparationModelList,
} from '@shared/voice/types';
import {
    DEREVERB_MODELS,
    dereverbOption,
    NOISE_REMOVAL_MODELS,
    noiseRemovalOption,
    silenceOption,
} from '@shared/voice/audio-filters';
import {
    DereverbFields,
    filterSummary,
    NoiseRemovalFields,
    resolvedDereverbOption,
    resolvedNoiseOption,
    SilenceFields,
    type FilterModel,
} from './AudioFilterFields';
import { wrapSelectSx } from '../common/selectStyles';

// 分離の方式の選択。選び方は 3 つ (タブで切り替える):
// - おすすめ: 目的別のおすすめ (ダウンロード画面と同じ。配布元が検証した組み合わせと、目的に合うモデル) から 1 つを選ぶ
// - モデル: 取得済みのモデルを、まとまり (分離の種類。ダウンロード画面と同じ名前・順) ごとの欄から選ぶ (欄ごとに複数選べ、
//   絞り込める)。まとまりをまたいでも選べ、2 つ以上選ぶと各モデルの結果から「結果の決め方」で 1 つの結果を決める
// - その他: 分離はせず、残響・エコーを除去する・ノイズを除去する・無音部分の雑音を消すで音を加工した 1 つの出力を作る
// 選んだ内容は SelectedMethodPanel で示す (分岐のダイアログの右側)

export type MethodSelection = SeparationMethodChoice;

export const EMPTY_METHOD_SELECTION: MethodSelection = {
    mode: null,
    recommended: '',
    keys: [],
    algorithm: 'avg_wave',
};

type PickMode = 'recommended' | 'model' | 'other';

// おすすめの項目
type RecommendedOption = {
    // 方式 (`verified:<組み合わせの ID>` または `model:<ファイル名>`)
    key: string;
    // 一覧の項目の値 (`<目的>|<方式>`)。同じ方式が複数の目的に並ぶため、どの目的の下のものかも含める
    value: string;
    name: string;
    // 2 回に分けて分離する目的で、どの回に使うか (ダウンロード画面と同じ印)
    labelKey?: string;
    // 組み合わせのモデル (ファイル名)
    members: string[];
    model: SeparationModel | null;
};

type RecommendedGroup = { purposeId: string; options: RecommendedOption[] };

// 選んだ方式と、詳細な設定を示す方式 (アーキテクチャ)
export type ResolvedMethod = {
    method: SeparationMethod | null;
    archs: SeparationArch[];
};

function installedModels(list: SeparationModelList | null): SeparationModel[] {
    return (list?.models ?? []).filter(model => model.installed).sort(compareSeparatorModels);
}

// おすすめ (目的ごと。取得済みのものだけ)。ダウンロード画面と同じく、複数の目的に載るものはそれぞれの目的に並べる
// (目的ごとの関係が分かるように)
function buildRecommended(list: SeparationModelList | null): RecommendedGroup[] {
    const models = installedModels(list);
    const groups: RecommendedGroup[] = [];
    for (const purpose of SEPARATOR_PURPOSES) {
        const options: RecommendedOption[] = [];
        for (const entry of purpose.entries) {
            if (entry.kind === 'ensemble') {
                const ensemble = (list?.ensembles ?? []).find(item => item.id === entry.id && item.installed);
                const key = `verified:${entry.id}`;
                if (!ensemble) continue;
                options.push({
                    key,
                    value: `${purpose.id}|${key}`,
                    name: ensemble.name,
                    labelKey: entry.labelKey,
                    members: ensemble.models,
                    model: null,
                });
            } else {
                const model = models.find(item => item.filename === entry.filename);
                const key = `model:${entry.filename}`;
                if (!model) continue;
                options.push({
                    key,
                    value: `${purpose.id}|${key}`,
                    name: separatorDisplayName(model.name),
                    members: [model.filename],
                    model,
                });
            }
        }
        if (options.length > 0) groups.push({ purposeId: purpose.id, options });
    }
    return groups;
}

// おすすめの選択 (一覧の項目の値) に当たる項目。目的を含まない値 (方式だけ) は、最初に並ぶものに当てる
function findRecommended(
    groups: RecommendedGroup[],
    value: string
): { group: RecommendedGroup; option: RecommendedOption } | undefined {
    const items = groups.flatMap(group => group.options.map(option => ({ group, option })));
    return (
        items.find(item => item.option.value === value) ??
        (value.includes('|') ? undefined : items.find(item => item.option.key === value))
    );
}

// 選べる選び方 (おすすめは取得済みのものが無ければ出さない)。モデルのタブは、取得済みのモデルが無くても
// まとまりと取得の案内を示すため常に出す。その他のタブもモデルを使わないため常に出す
function availableModes(list: SeparationModelList | null): PickMode[] {
    const modes: PickMode[] = [];
    if (buildRecommended(list).length > 0) modes.push('recommended');
    modes.push('model', 'other');
    return modes;
}

function activeMode(selection: MethodSelection, modes: PickMode[]): PickMode | null {
    return selection.mode && modes.includes(selection.mode) ? selection.mode : (modes[0] ?? null);
}

function archsOf(list: SeparationModelList | null, filenames: string[]): SeparationArch[] {
    return [
        ...new Set(
            filenames
                .map(filename => list?.models.find(model => model.filename === filename)?.arch)
                .filter((arch): arch is SeparationArch => arch !== undefined)
        ),
    ];
}

// 選んだモデル。並びは選んだ順ではなく、まとまりの順、まとまりの中は名前の順 (ダウンロード画面と同じ)
function selectedModels(selection: MethodSelection, list: SeparationModelList | null): SeparationModel[] {
    const models = installedModels(list);
    const categoryIndex = (model: SeparationModel) => SEPARATION_CATEGORIES.indexOf(model.category);
    return selection.keys
        .map(key => models.find(model => `model:${model.filename}` === key))
        .filter((model): model is SeparationModel => model !== undefined)
        .sort((a, b) => categoryIndex(a) - categoryIndex(b) || compareSeparatorModels(a, b));
}

// 選んだ方式を求める
export function resolveMethod(selection: MethodSelection, list: SeparationModelList | null): ResolvedMethod {
    const none: ResolvedMethod = { method: null, archs: [] };
    const mode = activeMode(selection, availableModes(list));
    if (mode === 'other') {
        const other = otherChoice(selection);
        const dereverb = resolvedDereverbOption(other.dereverb, installedRecommended(list, DEREVERB_MODELS));
        if (!dereverb.enabled && !other.noiseRemoval.enabled && !other.muteSilence.enabled) return none;
        return {
            method: {
                kind: 'process',
                dereverb,
                noiseRemoval: resolvedNoiseOption(other.noiseRemoval, installedRecommended(list, NOISE_REMOVAL_MODELS)),
                muteSilence: other.muteSilence,
            },
            archs: [],
        };
    }
    if (mode === 'recommended') {
        const option = findRecommended(buildRecommended(list), selection.recommended)?.option;
        if (!option) return none;
        if (option.model) {
            return {
                method: { kind: 'model', filename: option.model.filename },
                archs: [option.model.arch],
            };
        }
        return {
            method: { kind: 'verifiedEnsemble', ensembleId: option.key.slice('verified:'.length) },
            archs: archsOf(list, option.members),
        };
    }
    const models = selectedModels(selection, list);
    if (models.length === 0) return none;
    if (models.length === 1) {
        return {
            method: { kind: 'model', filename: models[0].filename },
            archs: [models[0].arch],
        };
    }
    const filenames = models.map(model => model.filename);
    return {
        method: { kind: 'ensemble', filenames, algorithm: selection.algorithm },
        archs: archsOf(list, filenames),
    };
}

// 「その他」の加工 (選んでいなければ初期値。どれもチェックなし)。保存したプリセットに無い項目 (後から増えた項目) も
// 初期値で補う
function otherChoice(selection: MethodSelection): SeparationOtherChoice {
    return {
        dereverb: { ...dereverbOption(false), ...selection.other?.dereverb },
        noiseRemoval: { ...noiseRemovalOption(false), ...selection.other?.noiseRemoval },
        muteSilence: { ...silenceOption(false), ...selection.other?.muteSilence },
    };
}

// 取得済みのおすすめのモデル (おすすめの順)
function installedRecommended(list: SeparationModelList | null, recommended: { filename: string }[]): FilterModel[] {
    return recommended.flatMap(item => {
        const model = list?.models.find(entry => entry.filename === item.filename && entry.installed);
        return model
            ? [{ filename: model.filename, name: model.name, arch: model.arch, stems: model.stems, sdr: model.sdr }]
            : [];
    });
}

// 方式の選択のうち、取得していないものがあるか (プリセットの呼び出しで使う)
export function hasUnavailableChoice(selection: MethodSelection, list: SeparationModelList | null): boolean {
    if (selection.mode === 'other') {
        const { dereverb, noiseRemoval } = otherChoice(selection);
        return (
            (noiseRemoval.enabled &&
                noiseRemoval.method === 'model' &&
                installedRecommended(list, NOISE_REMOVAL_MODELS).length === 0) ||
            (dereverb.enabled && installedRecommended(list, DEREVERB_MODELS).length === 0)
        );
    }
    if (selection.mode === 'recommended') {
        return !!selection.recommended && !findRecommended(buildRecommended(list), selection.recommended);
    }
    return selectedModels(selection, list).length !== selection.keys.length;
}

// 組み合わせの説明 (配布元が検証した組み合わせの特徴)
function ensembleDescription(t: TFunction, option: RecommendedOption): string {
    const id = option.key.slice('verified:'.length);
    return t(`voice.library.separatorEnsembleDescriptions.${id}`, {
        defaultValue: t('voice.separation.verifiedEnsemble', { count: option.members.length }),
    });
}

type Props = {
    models: SeparationModelList | null;
    value: MethodSelection;
    onChange(value: MethodSelection): void;
    disabled?: boolean;
    // タブの上に置くもの (プリセット。呼び出すとタブの状態から詳細な設定まで戻す)
    presets?: React.ReactNode;
};

const captionSx = { lineHeight: 1.5 } as const;

// モデルの一覧の高さ (上限・下限) と、画面の端から空ける幅 (px)
const LIST_MAX_HEIGHT = 480;
const LIST_MIN_HEIGHT = 160;
const LIST_MARGIN = 24;

// モデルの概要 (ダウンロード画面の行と同じ)
function ModelSummary({ model }: { model: SeparationModel }) {
    return <SeparatorModelSummary filename={model.filename} arch={model.arch} stems={model.stems} sdr={model.sdr} />;
}

// おすすめの項目の概要 (モデルはダウンロード画面の行と同じ、組み合わせはその特徴)
function OptionSummary({ t, option }: { t: TFunction; option: RecommendedOption }) {
    if (option.model) return <ModelSummary model={option.model} />;
    return (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', ...captionSx }}>
            {ensembleDescription(t, option)}
        </Typography>
    );
}

export default function SeparationMethodPicker({ models, value, onChange, disabled, presets }: Props) {
    const { t } = useTranslation();
    const modes = React.useMemo(() => availableModes(models), [models]);
    const recommended = React.useMemo(() => buildRecommended(models), [models]);
    const installed = React.useMemo(() => installedModels(models), [models]);
    const chosen = React.useMemo(() => selectedModels(value, models), [value, models]);
    const mode = activeMode(value, modes);
    const resolved = resolveMethod(value, models);
    const noiseModels = React.useMemo(() => installedRecommended(models, NOISE_REMOVAL_MODELS), [models]);
    const dereverbModels = React.useMemo(() => installedRecommended(models, DEREVERB_MODELS), [models]);
    const update = (patch: Partial<MethodSelection>) => onChange({ ...value, mode, ...patch });

    // まとまりごとの欄 (ダウンロード画面と同じ名前・順。取得済みのモデルが無いまとまりも示す)
    const groups = React.useMemo(
        () =>
            SEPARATION_CATEGORIES.map(category => ({
                category,
                models: installed.filter(model => model.category === category),
            })),
        [installed]
    );
    // 一覧を開く向きと高さ。開くときにその欄の上下の空きを測り、広い側へ、その空きに収まる高さで開く
    // (ダイアログの中で開くため、決まった高さでは画面からはみ出して選べなくなる)
    const listAnchors = React.useRef<Partial<Record<SeparationCategory, HTMLDivElement | null>>>({});
    const [listLayout, setListLayout] = React.useState<{ placement: 'bottom-start' | 'top-start'; maxHeight: number }>({
        placement: 'bottom-start',
        maxHeight: LIST_MAX_HEIGHT,
    });
    const fitList = (category: SeparationCategory) => {
        const rect = listAnchors.current[category]?.getBoundingClientRect();
        if (!rect) return;
        const below = window.innerHeight - rect.bottom - LIST_MARGIN;
        const above = rect.top - LIST_MARGIN;
        setListLayout({
            placement: below >= above ? 'bottom-start' : 'top-start',
            maxHeight: Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, Math.max(below, above))),
        });
    };
    // あるまとまりで選んだモデルを置き換える (ほかのまとまりで選んだものは残す)
    const chooseInCategory = (category: SeparationCategory, next: SeparationModel[]) =>
        update({
            keys: [...chosen.filter(model => model.category !== category), ...next].map(
                model => `model:${model.filename}`
            ),
        });

    const selectedRecommended = findRecommended(recommended, value.recommended);
    const other = otherChoice(value);

    return (
        <Stack spacing={1.5}>
            {presets}

            {modes.length > 1 && (
                <ToggleButtonGroup
                    exclusive
                    size='small'
                    color='primary'
                    disabled={disabled}
                    value={mode}
                    onChange={(_event, next: PickMode | null) => next && update({ mode: next })}
                >
                    {modes.map(item => (
                        <ToggleButton key={item} value={item} sx={{ flexGrow: 1 }}>
                            {t(`voice.separation.pickModes.${item}`)}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            )}

            {mode === 'recommended' && (
                <FormControl size='small' disabled={disabled}>
                    <InputLabel id='separation-recommended'>{t('voice.separation.method')}</InputLabel>
                    <Select
                        labelId='separation-recommended'
                        label={t('voice.separation.method')}
                        value={selectedRecommended ? selectedRecommended.option.value : ''}
                        onChange={event => update({ recommended: String(event.target.value) })}
                        renderValue={selected => findRecommended(recommended, selected)?.option.name ?? ''}
                        sx={wrapSelectSx}
                        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 480, maxWidth: 600 } } } }}
                    >
                        {recommended.flatMap(group => [
                            <ListSubheader key={group.purposeId}>
                                {t(`voice.library.separatorPurposes.${group.purposeId}.title`)}
                            </ListSubheader>,
                            ...group.options.map(option => (
                                <MenuItem key={option.value} value={option.value} sx={{ whiteSpace: 'normal' }}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant='body2'>{option.name}</Typography>
                                        {option.labelKey && (
                                            <Typography
                                                variant='caption'
                                                color='primary'
                                                sx={{ display: 'block', ...captionSx }}
                                            >
                                                {t(option.labelKey)}
                                            </Typography>
                                        )}
                                        <OptionSummary t={t} option={option} />
                                    </Box>
                                </MenuItem>
                            )),
                        ])}
                    </Select>
                </FormControl>
            )}

            {/* 処理の順 (残響・エコーの除去 → ノイズ除去 → 無音部分の雑音を消す) に並べる */}
            {mode === 'other' && (
                <Stack spacing={1}>
                    <DereverbFields
                        models={dereverbModels}
                        value={other.dereverb}
                        disabled={disabled}
                        onChange={dereverb => update({ other: { ...other, dereverb } })}
                    />
                    <NoiseRemovalFields
                        models={noiseModels}
                        value={other.noiseRemoval}
                        disabled={disabled}
                        onChange={noiseRemoval => update({ other: { ...other, noiseRemoval } })}
                    />
                    <SilenceFields
                        mode='mute'
                        value={other.muteSilence}
                        disabled={disabled}
                        onChange={muteSilence => update({ other: { ...other, muteSilence } })}
                    />
                </Stack>
            )}

            {mode === 'model' && (
                <>
                    {/* まとまりごとの欄 (複数選べる。名前・説明・出力で絞り込める)。取得済みのモデルが無いまとまりは、
                        選べない欄にして取得の案内を示す */}
                    {groups.map(group => {
                        const picked = chosen.filter(model => model.category === group.category);
                        const empty = group.models.length === 0;
                        return (
                            <Autocomplete
                                key={group.category}
                                ref={(element: HTMLDivElement | null) => {
                                    listAnchors.current[group.category] = element;
                                }}
                                onOpen={() => fitList(group.category)}
                                multiple
                                size='small'
                                disableCloseOnSelect
                                disabled={disabled || empty}
                                options={group.models}
                                value={picked}
                                onChange={(_event, next) => chooseInCategory(group.category, next)}
                                getOptionLabel={model => separatorDisplayName(model.name)}
                                getOptionKey={model => model.filename}
                                isOptionEqualToValue={(option, item) => option.filename === item.filename}
                                filterOptions={(options, state) => filterSeparatorModels(t, options, state.inputValue)}
                                noOptionsText={t('voice.separation.noMatch')}
                                renderOption={({ key, ...props }, model, { selected }) => (
                                    <li key={key} {...props}>
                                        <Stack direction='row' spacing={1} sx={{ width: '100%', minWidth: 0 }}>
                                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                                <Typography variant='body2'>
                                                    {separatorDisplayName(model.name)}
                                                </Typography>
                                                <ModelSummary model={model} />
                                            </Box>
                                            {selected && <CheckIcon fontSize='small' color='primary' />}
                                        </Stack>
                                    </li>
                                )}
                                renderInput={params => (
                                    <TextField
                                        {...params}
                                        label={t(`voice.separation.categories.${group.category}`)}
                                        placeholder={
                                            !empty && picked.length === 0
                                                ? t('voice.separation.methodSearch')
                                                : undefined
                                        }
                                        helperText={empty ? t('voice.separation.categoryEmpty') : undefined}
                                        // Autocomplete が渡す設定 (一覧を開くボタンなど) に、名前を常に上に出す設定を足す
                                        slotProps={{ ...params.slotProps, inputLabel: { shrink: true } }}
                                    />
                                )}
                                // 選んだものは名前を切らずに折り返して示す (似た名前を見分けられるように)
                                sx={{
                                    '& .MuiAutocomplete-tag': {
                                        maxWidth: 'calc(100% - 48px)',
                                        height: 'auto',
                                        py: 0.25,
                                    },
                                }}
                                slotProps={{
                                    chip: { sx: { '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.4 } } },
                                    popper: {
                                        placement: listLayout.placement,
                                        // 向きは開くときに決めたものに固定する (入れ替わると高さが合わなくなるため)
                                        modifiers: [{ name: 'flip', enabled: false }],
                                        sx: { width: 'min(600px, calc(100vw - 48px)) !important' },
                                    },
                                    listbox: { sx: { maxHeight: listLayout.maxHeight } },
                                }}
                            />
                        );
                    })}
                    <Typography variant='caption' color='text.secondary' sx={captionSx}>
                        {t('voice.separation.methodHint')}
                    </Typography>
                </>
            )}

            {resolved.method?.kind === 'ensemble' && (
                <FormControl size='small' disabled={disabled}>
                    <InputLabel id='ensemble-algorithm'>{t('voice.separation.algorithm')}</InputLabel>
                    <Select
                        labelId='ensemble-algorithm'
                        label={t('voice.separation.algorithm')}
                        value={value.algorithm}
                        onChange={event => update({ algorithm: event.target.value as EnsembleAlgorithm })}
                        renderValue={item => t(`voice.separation.algorithms.${item}`)}
                        MenuProps={{ slotProps: { paper: { sx: { maxWidth: 520 } } } }}
                    >
                        {ENSEMBLE_ALGORITHMS.map(item => (
                            <MenuItem key={item} value={item} sx={{ whiteSpace: 'normal' }}>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant='body2'>{t(`voice.separation.algorithms.${item}`)}</Typography>
                                    <Typography
                                        variant='caption'
                                        color='text.secondary'
                                        sx={{ display: 'block', ...captionSx }}
                                    >
                                        {t(`voice.separation.algorithmNotes.${item}`)}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}
        </Stack>
    );
}

// 選んだ内容 (分岐のダイアログの右側)。おすすめは選んだ方式と説明、モデルは選んだモデルを積み重ねて (まとまりの順、
// まとまりの中は名前の順)、その他はチェックした加工を処理の順に示す
export function SelectedMethodPanel({ models, value }: { models: SeparationModelList | null; value: MethodSelection }) {
    const { t } = useTranslation();
    const mode = activeMode(value, availableModes(models));
    const none = (
        <Typography variant='body2' color='text.secondary'>
            {t('voice.separation.selectedNone')}
        </Typography>
    );
    if (mode === 'recommended') {
        const selected = findRecommended(buildRecommended(models), value.recommended);
        if (!selected) return none;
        return (
            <Box sx={{ minWidth: 0 }}>
                <Typography variant='body2' sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {selected.option.name}
                </Typography>
                {selected.option.labelKey && (
                    <Typography variant='caption' color='primary' sx={{ display: 'block', ...captionSx }}>
                        {t(selected.option.labelKey)}
                    </Typography>
                )}
                <OptionSummary t={t} option={selected.option} />
            </Box>
        );
    }
    if (mode === 'model') {
        const chosen = selectedModels(value, models);
        if (chosen.length === 0) return none;
        return (
            <Stack spacing={1.5}>
                {chosen.map(model => (
                    <Box key={model.filename} sx={{ minWidth: 0 }}>
                        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', ...captionSx }}>
                            {t(`voice.separation.categories.${model.category}`)}
                        </Typography>
                        <Typography variant='body2' sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {separatorDisplayName(model.name)}
                        </Typography>
                        <ModelSummary model={model} />
                    </Box>
                ))}
            </Stack>
        );
    }
    const method = resolveMethod(value, models).method;
    if (method?.kind !== 'process') return none;
    const names = (models?.models ?? []).map(model => ({ filename: model.filename, name: model.name }));
    return (
        <Stack spacing={1} component='ol' sx={{ m: 0, pl: 2.5 }}>
            {filterSummary(t, method, names).map(part => (
                <Typography key={part} component='li' variant='body2' sx={{ overflowWrap: 'anywhere' }}>
                    {part}
                </Typography>
            ))}
        </Stack>
    );
}
