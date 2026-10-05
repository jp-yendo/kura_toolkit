import React from 'react';
import {
    Autocomplete,
    Box,
    Chip,
    FormControl,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import SectionLabel from '../common/SectionLabel';
import { stemName } from './voiceFormat';
import { SEPARATOR_ARCH_LABELS, separatorFileNoteKey } from './separatorModelNotes';
import { SEPARATOR_PURPOSES } from './separatorPurposes';
import {
    ENSEMBLE_ALGORITHMS,
    type EnsembleAlgorithm,
    type SeparationArch,
    type SeparationCategory,
    type SeparationMethod,
    type SeparationModel,
    type SeparationModelList,
    type VerifiedEnsemble,
} from '@shared/voice/types';

// 方式の選び方。おすすめ (目的別のおすすめの組み合わせとモデル)・モデル (1 つ)・組み合わせ (任意の複数のモデル)・
// 信号処理 (中央定位の打ち消し。ボーカルと伴奏の 2 分割だけ)
export type PickMode = 'recommended' | 'model' | 'ensemble' | 'signal';

export type MethodSelection = {
    // 利用者が選んだ選び方 (選べない選び方を指していれば、選べるもののうち先頭を使う)
    mode: PickMode | null;
    // おすすめから選んだもの (`verified:<組み合わせの ID>` または `model:<ファイル名>`)
    recommended: string;
    model: string;
    ensemble: string[];
    algorithm: EnsembleAlgorithm;
};

export const EMPTY_METHOD_SELECTION: MethodSelection = {
    mode: null,
    recommended: '',
    model: '',
    ensemble: [],
    algorithm: 'avg_wave',
};

// おすすめの選択肢 (目的ごとの見出しの下に、取得済みのものだけを並べる)
type RecommendedGroup = {
    purposeId: string;
    options: { key: string; name: string }[];
};

// 選んだ方式と、パラメーターを示す方式 (アーキテクチャ)・品質の表示に使うモデル
export type ResolvedMethod = {
    method: SeparationMethod | null;
    archs: SeparationArch[];
    model: SeparationModel | null;
};

type Choices = {
    modes: PickMode[];
    recommended: RecommendedGroup[];
    models: SeparationModel[];
    ensembles: VerifiedEnsemble[];
};

// 品質 (出力のうち最も高い値) が高いモデル、名前の順
function compareModels(a: SeparationModel, b: SeparationModel): number {
    const best = (model: SeparationModel) =>
        Math.max(-Infinity, ...Object.values(model.sdr).filter((value): value is number => value !== null));
    const order = best(b) - best(a);
    return Number.isNaN(order) || order === 0 ? a.name.localeCompare(b.name) : order;
}

// 分離の種類で選べるもの (取得済みのものだけ)
function choicesFor(category: SeparationCategory, list: SeparationModelList | null): Choices {
    const models = (list?.models ?? [])
        .filter(model => model.category === category && model.installed)
        .sort(compareModels);
    const ensembles = (list?.ensembles ?? []).filter(item => item.category === category && item.installed);
    const shown = new Set<string>();
    const recommended: RecommendedGroup[] = [];
    for (const purpose of SEPARATOR_PURPOSES) {
        const options: RecommendedGroup['options'] = [];
        for (const entry of purpose.entries) {
            const found =
                entry.kind === 'ensemble'
                    ? ensembles.find(item => item.id === entry.id)
                    : models.find(model => model.filename === entry.filename);
            if (!found) continue;
            const key = entry.kind === 'ensemble' ? `verified:${entry.id}` : `model:${entry.filename}`;
            // 複数の目的に載るもの (2 段階の分割の 1 段目など) は、最初の目的にだけ並べる
            if (shown.has(key)) continue;
            shown.add(key);
            options.push({ key, name: found.name });
        }
        if (options.length > 0) recommended.push({ purposeId: purpose.id, options });
    }
    const modes: PickMode[] = [];
    if (recommended.length > 0) modes.push('recommended');
    if (models.length > 0) modes.push('model');
    if (models.length >= 2) modes.push('ensemble');
    if (category === 'vocals') modes.push('signal');
    return { modes, recommended, models, ensembles };
}

function activeMode(selection: MethodSelection, modes: PickMode[]): PickMode | null {
    return selection.mode && modes.includes(selection.mode) ? selection.mode : (modes[0] ?? null);
}

// 選んだ方式を求める
export function resolveMethod(
    selection: MethodSelection,
    category: SeparationCategory,
    list: SeparationModelList | null
): ResolvedMethod {
    const choices = choicesFor(category, list);
    const mode = activeMode(selection, choices.modes);
    const byFile = (filename: string) => choices.models.find(model => model.filename === filename) ?? null;
    const none: ResolvedMethod = { method: null, archs: [], model: null };
    if (mode === 'signal') return { method: { kind: 'centerCancel' }, archs: [], model: null };
    if (mode === 'model') {
        const model = byFile(selection.model);
        return model ? { method: { kind: 'model', filename: model.filename }, archs: [model.arch], model } : none;
    }
    if (mode === 'ensemble') {
        const members = selection.ensemble.map(byFile).filter((model): model is SeparationModel => model !== null);
        if (members.length < 2) return { ...none, archs: [...new Set(members.map(model => model.arch))] };
        return {
            method: {
                kind: 'ensemble',
                filenames: members.map(model => model.filename),
                algorithm: selection.algorithm,
            },
            archs: [...new Set(members.map(model => model.arch))],
            model: null,
        };
    }
    if (mode === 'recommended') {
        if (selection.recommended.startsWith('model:')) {
            const model = byFile(selection.recommended.slice('model:'.length));
            return model ? { method: { kind: 'model', filename: model.filename }, archs: [model.arch], model } : none;
        }
        const ensemble = choices.ensembles.find(item => `verified:${item.id}` === selection.recommended);
        if (!ensemble) return none;
        const members = (list?.models ?? []).filter(model => ensemble.models.includes(model.filename));
        return {
            method: { kind: 'verifiedEnsemble', ensembleId: ensemble.id },
            archs: [...new Set(members.map(model => model.arch))],
            model: null,
        };
    }
    return none;
}

// モデルの説明 (方式と概要)
function modelDetail(t: TFunction, model: SeparationModel): string {
    const noteKey = separatorFileNoteKey(model.filename);
    const arch = SEPARATOR_ARCH_LABELS[model.arch];
    return noteKey ? `${arch} / ${t(noteKey)}` : arch;
}

// 名前・ファイル名・方式・概要に、空白で区切った語がすべて含まれるモデルに絞る
function filterModels(t: TFunction, options: SeparationModel[], query: string): SeparationModel[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter(model => {
        const text = `${model.name} ${model.filename} ${modelDetail(t, model)}`.toLowerCase();
        return terms.every(term => text.includes(term));
    });
}

function ModelOption({ model, detail }: { model: SeparationModel; detail: string }) {
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography variant='body2'>{model.name}</Typography>
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.5 }}>
                {detail}
            </Typography>
        </Box>
    );
}

type Props = {
    category: SeparationCategory;
    models: SeparationModelList | null;
    value: MethodSelection;
    onChange(value: MethodSelection): void;
    disabled?: boolean;
};

const captionSx = { lineHeight: 1.5 } as const;

// 分離の方式を選ぶ。選び方 (おすすめ・モデル・組み合わせ・信号処理) を切り替え、取得済みのものだけを示す
export default function SeparationMethodPicker({ category, models, value, onChange, disabled }: Props) {
    const { t } = useTranslation();
    const choices = React.useMemo(() => choicesFor(category, models), [category, models]);
    const mode = activeMode(value, choices.modes);
    const resolved = resolveMethod(value, category, models);
    const update = (patch: Partial<MethodSelection>) => onChange({ ...value, ...patch });

    if (choices.modes.length === 0) {
        return (
            <Typography variant='body2' color='text.secondary' sx={captionSx}>
                {t('voice.separation.noModels')}
            </Typography>
        );
    }

    const quality = resolved.model
        ? Object.entries(resolved.model.sdr)
              .filter(([, sdr]) => sdr !== null)
              .map(([stem, sdr]) => `${stemName(t, stem)} ${Number(sdr).toFixed(1)}`)
              .join(' / ')
        : '';
    // 選んだもの (今の選択肢にあるもの) の説明
    const recommendedDescription =
        resolved.method?.kind === 'verifiedEnsemble'
            ? t(`voice.library.separatorEnsembleDescriptions.${resolved.method.ensembleId}`)
            : resolved.model
              ? (() => {
                    const noteKey = separatorFileNoteKey(resolved.model.filename);
                    return noteKey ? t(noteKey) : '';
                })()
              : '';

    return (
        <Stack spacing={1.5}>
            <SectionLabel>{t('voice.separation.method')}</SectionLabel>
            <ToggleButtonGroup
                exclusive
                size='small'
                color='primary'
                disabled={disabled}
                value={mode}
                onChange={(_event, next: PickMode | null) => next && update({ mode: next })}
                sx={{ flexWrap: 'wrap' }}
            >
                {choices.modes.map(item => (
                    <ToggleButton key={item} value={item} sx={{ flexGrow: 1 }}>
                        {t(`voice.separation.pickModes.${item}`)}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>

            {mode === 'recommended' && (
                <>
                    <FormControl size='small' disabled={disabled}>
                        <InputLabel id='separation-recommended'>{t('voice.separation.recommended')}</InputLabel>
                        <Select
                            labelId='separation-recommended'
                            label={t('voice.separation.recommended')}
                            value={
                                choices.recommended.some(group => group.options.some(o => o.key === value.recommended))
                                    ? value.recommended
                                    : ''
                            }
                            onChange={event => update({ recommended: String(event.target.value) })}
                            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 460 } } } }}
                        >
                            {choices.recommended.flatMap(group => [
                                <ListSubheader key={group.purposeId}>
                                    {t(`voice.library.separatorPurposes.${group.purposeId}.title`)}
                                </ListSubheader>,
                                ...group.options.map(option => (
                                    <MenuItem key={option.key} value={option.key}>
                                        {option.name}
                                    </MenuItem>
                                )),
                            ])}
                        </Select>
                    </FormControl>
                    {recommendedDescription && (
                        <Typography variant='caption' color='text.secondary' sx={captionSx}>
                            {recommendedDescription}
                        </Typography>
                    )}
                </>
            )}

            {mode === 'model' && (
                <Autocomplete
                    size='small'
                    disabled={disabled}
                    options={choices.models}
                    value={resolved.model}
                    onChange={(_event, model) => update({ model: model?.filename ?? '' })}
                    getOptionLabel={model => model.name}
                    getOptionKey={model => model.filename}
                    isOptionEqualToValue={(option, selected) => option.filename === selected.filename}
                    filterOptions={(options, state) => filterModels(t, options, state.inputValue)}
                    renderOption={({ key, ...props }, model) => (
                        <li key={key} {...props}>
                            <ModelOption model={model} detail={modelDetail(t, model)} />
                        </li>
                    )}
                    renderInput={params => (
                        <TextField
                            {...params}
                            label={t('voice.separation.model')}
                            placeholder={t('voice.separation.modelSearch')}
                        />
                    )}
                    noOptionsText={t('voice.separation.noMatch')}
                    slotProps={{ listbox: { sx: { maxHeight: 420 } } }}
                />
            )}
            {mode === 'model' && resolved.model && (
                <Typography variant='caption' color='text.secondary' sx={captionSx}>
                    {modelDetail(t, resolved.model)}
                </Typography>
            )}

            {mode === 'ensemble' && (
                <>
                    <Autocomplete
                        multiple
                        size='small'
                        disabled={disabled}
                        disableCloseOnSelect
                        options={choices.models}
                        value={value.ensemble
                            .map(filename => choices.models.find(model => model.filename === filename))
                            .filter((model): model is SeparationModel => model !== undefined)}
                        onChange={(_event, selected) => update({ ensemble: selected.map(model => model.filename) })}
                        getOptionLabel={model => model.name}
                        getOptionKey={model => model.filename}
                        isOptionEqualToValue={(option, selected) => option.filename === selected.filename}
                        filterOptions={(options, state) => filterModels(t, options, state.inputValue)}
                        renderOption={({ key, ...props }, model) => (
                            <li key={key} {...props}>
                                <ModelOption model={model} detail={modelDetail(t, model)} />
                            </li>
                        )}
                        renderValue={(selected, getItemProps) =>
                            selected.map((model, index) => {
                                const { key, ...itemProps } = getItemProps({ index });
                                return <Chip key={key} size='small' label={model.name} {...itemProps} />;
                            })
                        }
                        renderInput={params => (
                            <TextField
                                {...params}
                                label={t('voice.separation.ensembleModels')}
                                placeholder={t('voice.separation.modelSearch')}
                                helperText={t('voice.separation.ensembleHint')}
                            />
                        )}
                        noOptionsText={t('voice.separation.noMatch')}
                        slotProps={{ listbox: { sx: { maxHeight: 420 } } }}
                    />
                    <FormControl size='small' disabled={disabled}>
                        <InputLabel id='ensemble-algorithm'>{t('voice.separation.algorithm')}</InputLabel>
                        <Select
                            labelId='ensemble-algorithm'
                            label={t('voice.separation.algorithm')}
                            value={value.algorithm}
                            onChange={event => update({ algorithm: event.target.value as EnsembleAlgorithm })}
                        >
                            {ENSEMBLE_ALGORITHMS.map(item => (
                                <MenuItem key={item} value={item}>
                                    {t(`voice.separation.algorithms.${item}`)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </>
            )}

            {mode === 'signal' && (
                <Typography variant='caption' color='text.secondary' sx={captionSx}>
                    {t('voice.separation.centerCancelDescription')}
                </Typography>
            )}

            {quality && (
                <Tooltip title={t('voice.separation.qualityHint')} describeChild>
                    <Stack
                        direction='row'
                        spacing={0.5}
                        sx={{ alignItems: 'center', alignSelf: 'flex-start', color: 'text.secondary' }}
                    >
                        <Typography variant='caption' sx={captionSx}>
                            {t('voice.separation.quality', { values: quality })}
                        </Typography>
                        <InfoOutlinedIcon sx={{ fontSize: 14 }} />
                    </Stack>
                </Tooltip>
            )}
        </Stack>
    );
}
