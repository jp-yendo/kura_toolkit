import React from 'react';
import {
    Autocomplete,
    Box,
    Checkbox,
    FormControlLabel,
    Radio,
    RadioGroup,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import CheckIcon from '@mui/icons-material/Check';
import SliderField from './SliderField';
import ResetButton from '../common/ResetButton';
import LufsGuide from '../common/LufsGuide';
import SeparatorModelSummary from './SeparatorModelSummary';
import { filterSeparatorModels, separatorDisplayName } from './separatorModelNotes';
import { useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import { SEPARATOR_MODEL_PREFIX } from '@shared/voice/requirements';
import {
    DEREVERB_MODELS,
    LOUDNESS_DEFAULT_LUFS,
    LOUDNESS_RANGE,
    NOISE_REMOVAL_DEFAULTS,
    NOISE_REMOVAL_MODELS,
    NOISE_REMOVAL_RANGE,
    SILENCE_DEFAULTS,
    SILENCE_RANGE,
    type DereverbOption,
    type LoudnessOption,
    type NoiseRemovalOption,
    type SilenceOption,
} from '@shared/voice/audio-filters';
import type { SeparationArch } from '@shared/voice/types';

// 声の音の加工の設定欄 (残響・エコーの除去・無音の扱い・ノイズ除去・音量をそろえる)。変換のオプション・学習用の音の
// フィルター・分岐の「その他」で同じものを使う。どれもチェックすると、その下にスライダーなどを出す

// 加工で使うモデル (ファイル名・ダウンロード画面の名前と、概要に示す方式・出力・分離の品質)
export type FilterModel = {
    filename: string;
    name: string;
    arch: SeparationArch;
    stems: string[];
    sdr: Record<string, number | null>;
};

const db = (value: number) => `${value} dB`;

// チェックで有効・無効を切り替える項目。チェックしているときだけ、中身の欄と、行の右端に中身をまとめて初期値に戻すボタンを
// 出す (チェックの状態は変えない)。エフェクトの欄 (AudioEffectFields) も同じ形にする
export function OptionBlock({
    label,
    checked,
    onChecked,
    disabled,
    onReset,
    isDefault,
    children,
}: {
    label: string;
    checked: boolean;
    onChecked(checked: boolean): void;
    disabled?: boolean;
    onReset(): void;
    // 中身がすでに初期値か (初期値に戻すボタンを押せない状態にする)
    isDefault: boolean;
    children: React.ReactNode;
}) {
    return (
        <Stack spacing={1}>
            <Stack direction='row' sx={{ alignItems: 'center' }}>
                <FormControlLabel
                    disabled={disabled}
                    control={<Checkbox size='small' checked={checked} onChange={(_e, value) => onChecked(value)} />}
                    label={label}
                    sx={{ flexGrow: 1, mr: 0 }}
                />
                {checked && <ResetButton onClick={onReset} disabled={disabled || isDefault} />}
            </Stack>
            {checked && (
                <Stack spacing={1} sx={{ pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                    {children}
                </Stack>
            )}
        </Stack>
    );
}

// 無音の判断。mode は、無音部分の音量を 0 にする (mute) か、除去して詰める (remove) か (欄の名前だけが変わる)
export function SilenceFields({
    value,
    onChange,
    mode,
    disabled,
}: {
    value: SilenceOption;
    onChange(value: SilenceOption): void;
    mode: 'mute' | 'remove';
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    return (
        <OptionBlock
            label={t(mode === 'mute' ? 'voice.filters.muteSilence' : 'voice.filters.removeSilence')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...SILENCE_DEFAULTS })}
            isDefault={
                value.thresholdDb === SILENCE_DEFAULTS.thresholdDb && value.minSeconds === SILENCE_DEFAULTS.minSeconds
            }
        >
            <SliderField
                label={t('voice.filters.silenceThreshold')}
                defaultValue={SILENCE_DEFAULTS.thresholdDb}
                value={value.thresholdDb}
                min={SILENCE_RANGE.thresholdDb.min}
                max={SILENCE_RANGE.thresholdDb.max}
                step={1}
                format={db}
                disabled={disabled}
                onChange={thresholdDb => onChange({ ...value, thresholdDb })}
            />
            <SliderField
                label={t('voice.filters.silenceLength')}
                defaultValue={SILENCE_DEFAULTS.minSeconds}
                value={value.minSeconds}
                min={SILENCE_RANGE.minSeconds.min}
                max={SILENCE_RANGE.minSeconds.max}
                step={0.1}
                format={value => t('voice.filters.secondsValue', { value: value.toFixed(1) })}
                disabled={disabled}
                onChange={minSeconds => onChange({ ...value, minSeconds })}
            />
        </OptionBlock>
    );
}

// 取得済みのおすすめのモデル (おすすめの順。名前はダウンロード画面の名前)
function useRecommendedModels(recommended: { filename: string }[]): FilterModel[] {
    const version = useVoiceLibraryStore(state => state.version);
    const [models, setModels] = React.useState<FilterModel[]>([]);
    React.useEffect(() => {
        let cancelled = false;
        void window.kuraToolkit.voice.library
            .getStatus()
            .then(status => {
                if (cancelled) return;
                const byId = new Map(status.items.map(item => [item.id, item]));
                setModels(
                    recommended.flatMap(model => {
                        const item = byId.get(`${SEPARATOR_MODEL_PREFIX}${model.filename}`);
                        return item?.status === 'installed' && item.separator
                            ? [
                                  {
                                      filename: model.filename,
                                      name: item.name ?? model.filename,
                                      arch: item.separator.arch,
                                      stems: item.separator.stems,
                                      sdr: item.separator.sdr,
                                  },
                              ]
                            : [];
                    })
                );
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [version, recommended]);
    return models;
}

// 取得済みのノイズ除去のおすすめのモデル
export function useNoiseRemovalModels(): FilterModel[] {
    return useRecommendedModels(NOISE_REMOVAL_MODELS);
}

// 取得済みの残響・エコーの除去のおすすめのモデル
export function useDereverbModels(): FilterModel[] {
    return useRecommendedModels(DEREVERB_MODELS);
}

// 使うモデルの欄 (1 つだけ選ぶ)。分離のモデルのタブと同じく、名前・説明・出力で絞り込め、一覧の各項目に名前と概要を示し
// (名前は前置きを除き、省略せずに折り返す。選んでいる項目は右端のチェックの印で示す)、欄の下に選んだモデルの概要を示す。
// 選んだものは、チップではなく折り返す文字で欄の中に示す
function FilterModelSelect({
    label,
    models,
    value,
    onChange,
    disabled,
}: {
    label: string;
    models: FilterModel[];
    value: FilterModel;
    onChange(filename: string): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    return (
        <Stack spacing={0.5}>
            <Autocomplete
                size='small'
                disableClearable
                disabled={disabled}
                options={models}
                value={value}
                // 消す操作 (入力が空のときの Backspace など) では選んだものを残す (使うモデルは必ず 1 つ選ぶため)
                onChange={(_event, next) => next && onChange(next.filename)}
                getOptionLabel={model => separatorDisplayName(model.name)}
                getOptionKey={model => model.filename}
                isOptionEqualToValue={(option, item) => option.filename === item.filename}
                filterOptions={(options, state) => filterSeparatorModels(t, options, state.inputValue)}
                noOptionsText={t('voice.separation.noMatch')}
                renderValue={model => (
                    <Typography
                        variant='body2'
                        sx={{ maxWidth: 'calc(100% - 48px)', py: 0.25, pl: 0.5, overflowWrap: 'anywhere' }}
                    >
                        {separatorDisplayName(model.name)}
                    </Typography>
                )}
                renderOption={({ key, ...props }, model, { selected }) => (
                    <li key={key} {...props}>
                        <Stack direction='row' spacing={1} sx={{ width: '100%', minWidth: 0 }}>
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                <Typography variant='body2'>{separatorDisplayName(model.name)}</Typography>
                                <SeparatorModelSummary
                                    filename={model.filename}
                                    arch={model.arch}
                                    stems={model.stems}
                                    sdr={model.sdr}
                                />
                            </Box>
                            {selected && <CheckIcon fontSize='small' color='primary' />}
                        </Stack>
                    </li>
                )}
                renderInput={params => (
                    <TextField
                        {...params}
                        label={label}
                        // Autocomplete が渡す設定 (一覧を開くボタンなど) に、名前を常に上に出す設定を足す
                        slotProps={{ ...params.slotProps, inputLabel: { shrink: true } }}
                    />
                )}
                slotProps={{ popper: { sx: { width: 'min(600px, calc(100vw - 48px)) !important' } } }}
            />
            <Box sx={{ minWidth: 0 }}>
                <SeparatorModelSummary
                    filename={value.filename}
                    arch={value.arch}
                    stems={value.stems}
                    sdr={value.sdr}
                />
            </Box>
        </Stack>
    );
}

// 残響・エコーの除去。方式はモデルだけで、チェックすると使うモデルの欄を出す。おすすめのモデルを 1 つも取得していなければ
// チェックできない状態にし、ツールチップでダウンロードすると使えることを示す
export function DereverbFields({
    value,
    onChange,
    disabled,
    models: availableModels,
}: {
    value: DereverbOption;
    onChange(value: DereverbOption): void;
    disabled?: boolean;
    // 選べるモデル (渡さなければ、ダウンロードの状況から求める)。処理を頼むときの判断と同じ一覧を渡す
    models?: FilterModel[];
}) {
    const { t } = useTranslation();
    const libraryModels = useDereverbModels();
    const models = availableModels ?? libraryModels;
    const available = models.length > 0;
    const model = models.find(item => item.filename === value.model) ?? models[0] ?? null;
    const block = (
        <OptionBlock
            label={t('voice.filters.removeReverb')}
            checked={value.enabled && available}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled || !available}
            onReset={() => onChange({ ...value, model: null })}
            isDefault={model === null || model.filename === models[0]?.filename}
        >
            {model && (
                <FilterModelSelect
                    label={t('voice.filters.dereverbModelSelect')}
                    models={models}
                    value={model}
                    onChange={filename => onChange({ ...value, model: filename })}
                    disabled={disabled}
                />
            )}
        </OptionBlock>
    );
    if (available) return block;
    return (
        <Tooltip title={t('voice.filters.dereverbModelMissing')}>
            <Box component='span' sx={{ alignSelf: 'flex-start' }}>
                {block}
            </Box>
        </Tooltip>
    );
}

export function NoiseRemovalFields({
    value,
    onChange,
    disabled,
    models: availableModels,
}: {
    value: NoiseRemovalOption;
    onChange(value: NoiseRemovalOption): void;
    disabled?: boolean;
    // 選べるモデル (渡さなければ、ダウンロードの状況から求める)。処理を頼むときの判断と同じ一覧を渡す
    models?: FilterModel[];
}) {
    const { t } = useTranslation();
    const libraryModels = useNoiseRemovalModels();
    const models = availableModels ?? libraryModels;
    const modelAvailable = models.length > 0;
    // モデルが無くなった場合は簡易的に除去する
    const method = value.method === 'model' && !modelAvailable ? 'simple' : value.method;
    const model = models.find(item => item.filename === value.model) ?? models[0] ?? null;
    return (
        <OptionBlock
            label={t('voice.filters.removeNoise')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, method: 'simple', ...NOISE_REMOVAL_DEFAULTS, model: null })}
            isDefault={
                value.method === 'simple' &&
                value.floorDb === NOISE_REMOVAL_DEFAULTS.floorDb &&
                value.reductionDb === NOISE_REMOVAL_DEFAULTS.reductionDb &&
                value.waveletNoiseDb === NOISE_REMOVAL_DEFAULTS.waveletNoiseDb &&
                value.waveletPercent === NOISE_REMOVAL_DEFAULTS.waveletPercent &&
                (model === null || model.filename === models[0]?.filename)
            }
        >
            <RadioGroup
                value={method}
                onChange={(_e, next) => onChange({ ...value, method: next as NoiseRemovalOption['method'] })}
            >
                <FormControlLabel
                    value='simple'
                    disabled={disabled}
                    control={<Radio size='small' />}
                    label={t('voice.filters.noiseSimple')}
                />
                <FormControlLabel
                    value='wavelet'
                    disabled={disabled}
                    control={<Radio size='small' />}
                    label={t('voice.filters.noiseWavelet')}
                />
                <Tooltip title={modelAvailable ? '' : t('voice.filters.noiseModelMissing')}>
                    <Box component='span' sx={{ alignSelf: 'flex-start' }}>
                        <FormControlLabel
                            value='model'
                            disabled={disabled || !modelAvailable}
                            control={<Radio size='small' />}
                            label={t('voice.filters.noiseModel')}
                        />
                    </Box>
                </Tooltip>
            </RadioGroup>
            {method === 'simple' && (
                <>
                    <SliderField
                        label={t('voice.filters.noiseFloor')}
                        defaultValue={NOISE_REMOVAL_DEFAULTS.floorDb}
                        value={value.floorDb}
                        min={NOISE_REMOVAL_RANGE.floorDb.min}
                        max={NOISE_REMOVAL_RANGE.floorDb.max}
                        step={1}
                        format={db}
                        disabled={disabled}
                        onChange={floorDb => onChange({ ...value, floorDb })}
                    />
                    <SliderField
                        label={t('voice.filters.noiseReduction')}
                        defaultValue={NOISE_REMOVAL_DEFAULTS.reductionDb}
                        value={value.reductionDb}
                        min={NOISE_REMOVAL_RANGE.reductionDb.min}
                        max={NOISE_REMOVAL_RANGE.reductionDb.max}
                        step={1}
                        format={db}
                        disabled={disabled}
                        onChange={reductionDb => onChange({ ...value, reductionDb })}
                    />
                </>
            )}
            {method === 'wavelet' && (
                <>
                    <SliderField
                        label={t('voice.filters.waveletNoise')}
                        defaultValue={NOISE_REMOVAL_DEFAULTS.waveletNoiseDb}
                        value={value.waveletNoiseDb}
                        min={NOISE_REMOVAL_RANGE.waveletNoiseDb.min}
                        max={NOISE_REMOVAL_RANGE.waveletNoiseDb.max}
                        step={1}
                        format={db}
                        disabled={disabled}
                        onChange={waveletNoiseDb => onChange({ ...value, waveletNoiseDb })}
                    />
                    <SliderField
                        label={t('voice.filters.waveletPercent')}
                        defaultValue={NOISE_REMOVAL_DEFAULTS.waveletPercent}
                        value={value.waveletPercent}
                        min={NOISE_REMOVAL_RANGE.waveletPercent.min}
                        max={NOISE_REMOVAL_RANGE.waveletPercent.max}
                        step={1}
                        format={value => `${value}%`}
                        disabled={disabled}
                        onChange={waveletPercent => onChange({ ...value, waveletPercent })}
                    />
                </>
            )}
            {method === 'model' && model && (
                <FilterModelSelect
                    label={t('voice.filters.noiseModelSelect')}
                    models={models}
                    value={model}
                    onChange={filename => onChange({ ...value, model: filename })}
                    disabled={disabled}
                />
            )}
        </OptionBlock>
    );
}

// 音量をそろえる (目標の初期値は使う所ごと。学習用の音のフィルターは LOUDNESS_DEFAULT_LUFS、分岐の「その他」は
// オーディオ正規化の初期値)
export function LoudnessFields({
    value,
    onChange,
    disabled,
    defaultLufs = LOUDNESS_DEFAULT_LUFS,
}: {
    value: LoudnessOption;
    onChange(value: LoudnessOption): void;
    disabled?: boolean;
    defaultLufs?: number;
}) {
    const { t } = useTranslation();
    return (
        <OptionBlock
            label={t('voice.filters.loudness')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, targetLufs: defaultLufs })}
            isDefault={value.targetLufs === defaultLufs}
        >
            <SliderField
                label={t('voice.filters.loudnessTarget')}
                defaultValue={defaultLufs}
                value={value.targetLufs}
                min={LOUDNESS_RANGE.min}
                max={LOUDNESS_RANGE.max}
                step={1}
                format={value => `${value} LUFS`}
                disabled={disabled}
                onChange={targetLufs => onChange({ ...value, targetLufs })}
            />
            <LufsGuide />
        </OptionBlock>
    );
}

// 処理を頼むときのノイズ除去の設定。モデルで除去する場合は、選んだモデル (取得済みでなければ、取得済みのおすすめの
// うち先頭) を入れる。おすすめのモデルが 1 つも無ければ、簡易的に除去する
export function resolvedNoiseOption(value: NoiseRemovalOption, models: { filename: string }[]): NoiseRemovalOption {
    if (value.method !== 'model') return value;
    const model = models.find(item => item.filename === value.model) ?? models[0];
    return model ? { ...value, model: model.filename } : { ...value, method: 'simple' };
}

// 処理を頼むときの残響・エコーの除去の設定。選んだモデル (取得済みでなければ、取得済みのおすすめのうち先頭) を入れる。
// おすすめのモデルが 1 つも無ければ、除去しない
export function resolvedDereverbOption(value: DereverbOption, models: { filename: string }[]): DereverbOption {
    if (!value.enabled) return value;
    const model = models.find(item => item.filename === value.model) ?? models[0];
    return model ? { ...value, model: model.filename } : { ...value, enabled: false };
}

// チェックした加工の説明 (変換の候補・分岐の結果・学習用の音のフィルターの結果に添える)。残響・エコーの除去 →
// ノイズ除去 → 無音の扱い → 音量をそろえるの順に並べる。モデルの名前は、渡された一覧 (models) の名前で示す
export function filterSummary(
    t: TFunction,
    options: {
        dereverb?: DereverbOption;
        muteSilence?: SilenceOption;
        removeSilence?: SilenceOption;
        noiseRemoval?: NoiseRemovalOption;
        loudness?: LoudnessOption;
    },
    models: { filename: string; name: string }[]
): string[] {
    const parts: string[] = [];
    const { dereverb, muteSilence, removeSilence, noiseRemoval, loudness } = options;
    const modelName = (filename: string | null) =>
        separatorDisplayName(models.find(item => item.filename === filename)?.name ?? filename ?? '');
    if (dereverb?.enabled) parts.push(t('voice.filters.summaryDereverb', { model: modelName(dereverb.model) }));
    if (noiseRemoval?.enabled) {
        parts.push(
            noiseRemoval.method === 'model'
                ? t('voice.filters.summaryNoiseModel', { model: modelName(noiseRemoval.model) })
                : noiseRemoval.method === 'wavelet'
                  ? t('voice.filters.summaryNoiseWavelet', {
                        noise: noiseRemoval.waveletNoiseDb,
                        percent: noiseRemoval.waveletPercent,
                    })
                  : t('voice.filters.summaryNoiseSimple', {
                        floor: noiseRemoval.floorDb,
                        reduction: noiseRemoval.reductionDb,
                    })
        );
    }
    for (const [option, key] of [
        [muteSilence, 'voice.filters.summaryMuteSilence'],
        [removeSilence, 'voice.filters.summaryRemoveSilence'],
    ] as const) {
        if (option?.enabled) {
            parts.push(t(key, { db: option.thresholdDb, seconds: option.minSeconds.toFixed(1) }));
        }
    }
    if (loudness?.enabled) parts.push(t('voice.filters.summaryLoudness', { lufs: loudness.targetLufs }));
    return parts;
}
