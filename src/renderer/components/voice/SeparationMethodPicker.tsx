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
import { separatorFileNoteKey, separatorFileOutputs } from './separatorModelNotes';
import { SEPARATOR_PURPOSES } from './separatorPurposes';
import { compareSeparatorModels, SEPARATION_CATEGORIES } from './separatorCategories';
import {
    ENSEMBLE_ALGORITHMS,
    type EnsembleAlgorithm,
    type SeparationArch,
    type SeparationCategory,
    type SeparationMethod,
    type SeparationMethodChoice,
    type SeparationModel,
    type SeparationModelList,
} from '@shared/voice/types';

// 分離の方式の選択。選び方は 2 つ (タブで切り替える):
// - おすすめ: 目的別のおすすめ (ダウンロード画面と同じ。配布元が検証した組み合わせと、目的に合うモデル) から 1 つを選ぶ
// - モデル: 取得済みのモデルを、ダウンロード画面と同じまとまり (分離の種類) の見出しと並びの一覧から選ぶ (絞り込める)。
//   まとまりをまたいで複数選べ、2 つ以上選ぶと各モデルの結果から「結果の決め方」で 1 つの結果を決める

export type MethodSelection = SeparationMethodChoice;

export const EMPTY_METHOD_SELECTION: MethodSelection = {
    mode: null,
    recommended: '',
    keys: [],
    algorithm: 'avg_wave',
};

// 画面に示すモデル名。audio-separator の名前の先頭の方式の前置き (「Roformer Model: 」「VR Arch Single Model v5: 」
// 「Demucs v4: 」など) を除く (方式は説明の行に別に示すため。長い名前が欄に入りきらず途切れないようにする)
export function separatorDisplayName(name: string): string {
    return name.replace(/^(?:[^:]*\bModel\b[^:]*|Demucs[^:]*):\s*/, '') || name;
}

type PickMode = 'recommended' | 'model';

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

// 選んだ方式と、パラメーターを示す方式 (アーキテクチャ)・品質の表示に使うモデル
export type ResolvedMethod = {
    method: SeparationMethod | null;
    archs: SeparationArch[];
    model: SeparationModel | null;
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
// まとまりと取得の案内を示すため常に出す
function availableModes(list: SeparationModelList | null): PickMode[] {
    const modes: PickMode[] = [];
    if (buildRecommended(list).length > 0) modes.push('recommended');
    modes.push('model');
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

function selectedModels(selection: MethodSelection, list: SeparationModelList | null): SeparationModel[] {
    const models = installedModels(list);
    return selection.keys
        .map(key => models.find(model => `model:${model.filename}` === key))
        .filter((model): model is SeparationModel => model !== undefined);
}

// 選んだ方式を求める
export function resolveMethod(selection: MethodSelection, list: SeparationModelList | null): ResolvedMethod {
    const none: ResolvedMethod = { method: null, archs: [], model: null };
    const mode = activeMode(selection, availableModes(list));
    if (mode === 'recommended') {
        const option = findRecommended(buildRecommended(list), selection.recommended)?.option;
        if (!option) return none;
        if (option.model) {
            return {
                method: { kind: 'model', filename: option.model.filename },
                archs: [option.model.arch],
                model: option.model,
            };
        }
        return {
            method: { kind: 'verifiedEnsemble', ensembleId: option.key.slice('verified:'.length) },
            archs: archsOf(list, option.members),
            model: null,
        };
    }
    const models = selectedModels(selection, list);
    if (models.length === 0) return none;
    if (models.length === 1) {
        return {
            method: { kind: 'model', filename: models[0].filename },
            archs: [models[0].arch],
            model: models[0],
        };
    }
    const filenames = models.map(model => model.filename);
    return {
        method: { kind: 'ensemble', filenames, algorithm: selection.algorithm },
        archs: archsOf(list, filenames),
        model: null,
    };
}

// 方式の選択のうち、取得していないものがあるか (プリセットの呼び出しで使う)
export function hasUnavailableChoice(selection: MethodSelection, list: SeparationModelList | null): boolean {
    if (selection.mode === 'recommended') {
        return !!selection.recommended && !findRecommended(buildRecommended(list), selection.recommended);
    }
    return selectedModels(selection, list).length !== selection.keys.length;
}

// モデルの一覧の項目 (取得済みのモデルが無いまとまりは、そのことを示す項目を置く)
type ModelOption =
    | { kind: 'model'; category: SeparationCategory; model: SeparationModel }
    | { kind: 'empty'; category: SeparationCategory };

// 名前・ファイル名・概要・出力・まとまりの名前に、空白で区切った語がすべて含まれるものに絞り込む
// (語を入れている間は、取得済みのモデルが無いまとまりの項目は出さない)
function filterModelOptions(t: TFunction, options: ModelOption[], input: string): ModelOption[] {
    const terms = input.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter(option => {
        if (option.kind === 'empty') return false;
        const { model } = option;
        const note = separatorFileNoteKey(model.filename);
        const text = [
            model.name,
            model.filename,
            note ? t(note) : '',
            separatorFileOutputs(model.filename, model.stems).join(' '),
            t(`voice.separation.categories.${option.category}`),
        ]
            .join('\n')
            .toLowerCase();
        return terms.every(term => text.includes(term));
    });
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
    const update = (patch: Partial<MethodSelection>) => onChange({ ...value, mode, ...patch });

    // モデルの一覧のまとまり (ダウンロード画面と同じ名前・順。取得済みのモデルが無いまとまりも示す)
    const groups = React.useMemo(
        () =>
            SEPARATION_CATEGORIES.map(category => ({
                category,
                models: installed.filter(model => model.category === category),
            })),
        [installed]
    );
    const modelOptions = React.useMemo<ModelOption[]>(
        () =>
            groups.flatMap((group): ModelOption[] =>
                group.models.length > 0
                    ? group.models.map(model => ({ kind: 'model' as const, category: group.category, model }))
                    : [{ kind: 'empty' as const, category: group.category }]
            ),
        [groups]
    );
    // モデルの一覧を開く向きと高さ。開くときに入力欄の上下の空きを測り、広い側へ、その空きに収まる高さで開く
    // (ダイアログの中で開くため、決まった高さでは画面からはみ出して選べなくなる)
    const listAnchorRef = React.useRef<HTMLDivElement>(null);
    const [listLayout, setListLayout] = React.useState<{ placement: 'bottom-start' | 'top-start'; maxHeight: number }>({
        placement: 'bottom-start',
        maxHeight: LIST_MAX_HEIGHT,
    });
    const fitList = () => {
        const rect = listAnchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        const below = window.innerHeight - rect.bottom - LIST_MARGIN;
        const above = rect.top - LIST_MARGIN;
        setListLayout({
            placement: below >= above ? 'bottom-start' : 'top-start',
            maxHeight: Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, Math.max(below, above))),
        });
    };

    const chosenOptions = chosen.map(
        model =>
            modelOptions.find(option => option.kind === 'model' && option.model.filename === model.filename) ?? {
                kind: 'model' as const,
                category: model.category,
                model,
            }
    );

    const selectedRecommended = findRecommended(recommended, value.recommended);

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

            {mode === 'model' && (
                <>
                    {/* 1 つの一覧から選ぶ (複数選べる。名前・説明・出力などで絞り込める)。まとまりはダウンロード画面と同じ
                        名前・順で見出しにし、取得済みのモデルが無いまとまりも示す */}
                    <Autocomplete
                        ref={listAnchorRef}
                        onOpen={fitList}
                        multiple
                        size='small'
                        disableCloseOnSelect
                        disabled={disabled}
                        options={modelOptions}
                        value={chosenOptions}
                        onChange={(_event, next) =>
                            update({
                                keys: next.flatMap(option =>
                                    option.kind === 'model' ? [`model:${option.model.filename}`] : []
                                ),
                            })
                        }
                        groupBy={option =>
                            t('voice.library.separatorCategoryCount', {
                                name: t(`voice.separation.categories.${option.category}`),
                                count: groups.find(group => group.category === option.category)?.models.length ?? 0,
                            })
                        }
                        getOptionLabel={option =>
                            option.kind === 'model' ? separatorDisplayName(option.model.name) : ''
                        }
                        getOptionKey={option =>
                            option.kind === 'model' ? option.model.filename : `empty:${option.category}`
                        }
                        getOptionDisabled={option => option.kind === 'empty'}
                        isOptionEqualToValue={(option, item) =>
                            option.kind === 'model' &&
                            item.kind === 'model' &&
                            option.model.filename === item.model.filename
                        }
                        filterOptions={(options, state) => filterModelOptions(t, options, state.inputValue)}
                        noOptionsText={t('voice.separation.noMatch')}
                        renderOption={({ key, ...props }, option, { selected }) => (
                            <li key={key} {...props}>
                                {option.kind === 'empty' ? (
                                    <Typography variant='caption' sx={captionSx}>
                                        {t('voice.separation.categoryEmpty')}
                                    </Typography>
                                ) : (
                                    <Stack direction='row' spacing={1} sx={{ width: '100%', minWidth: 0 }}>
                                        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                            <Typography variant='body2'>
                                                {separatorDisplayName(option.model.name)}
                                            </Typography>
                                            <ModelSummary model={option.model} />
                                        </Box>
                                        {selected && <CheckIcon fontSize='small' color='primary' />}
                                    </Stack>
                                )}
                            </li>
                        )}
                        renderInput={params => (
                            <TextField
                                {...params}
                                label={t('voice.separation.method')}
                                placeholder={
                                    chosenOptions.length === 0 ? t('voice.separation.methodSearch') : undefined
                                }
                            />
                        )}
                        // 選んだものは名前を切らずに折り返して示す (似た名前を見分けられるように)
                        sx={{ '& .MuiAutocomplete-tag': { maxWidth: 'calc(100% - 48px)', height: 'auto', py: 0.25 } }}
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
                    <Typography variant='caption' color='text.secondary' sx={captionSx}>
                        {t('voice.separation.methodHint')}
                    </Typography>
                    {/* 選んだモデルの説明。1 つでも 2 つ以上でも同じ形で示す */}
                    {chosen.map(model => (
                        <Box key={model.filename} sx={{ minWidth: 0 }}>
                            <Typography variant='body2' sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                                {separatorDisplayName(model.name)}
                            </Typography>
                            <ModelSummary model={model} />
                        </Box>
                    ))}
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

            {mode === 'recommended' && selectedRecommended && (
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant='body2' sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                        {selectedRecommended.option.name}
                    </Typography>
                    <OptionSummary t={t} option={selectedRecommended.option} />
                </Box>
            )}
        </Stack>
    );
}
