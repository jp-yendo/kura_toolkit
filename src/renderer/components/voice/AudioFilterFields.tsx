import React from 'react';
import {
    Box,
    Checkbox,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Radio,
    RadioGroup,
    Select,
    Stack,
    Tooltip,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import SliderField from './SliderField';
import { useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import { SEPARATOR_MODEL_PREFIX } from '@shared/voice/requirements';
import {
    LOUDNESS_RANGE,
    NOISE_REMOVAL_MODELS,
    NOISE_REMOVAL_RANGE,
    SILENCE_RANGE,
    type LoudnessOption,
    type NoiseRemovalOption,
    type SilenceOption,
} from '@shared/voice/audio-filters';

// 声の音の加工の設定欄 (無音の扱い・ノイズ除去・音量をそろえる)。変換のオプション・学習用の音のフィルター・分岐の
// 「その他」で同じものを使う。どれもチェックすると、その下にスライダーなどを出す

const db = (value: number) => `${value} dB`;

function OptionBlock({
    label,
    checked,
    onChecked,
    disabled,
    children,
}: {
    label: string;
    checked: boolean;
    onChecked(checked: boolean): void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    return (
        <Stack spacing={1}>
            <FormControlLabel
                disabled={disabled}
                control={<Checkbox size='small' checked={checked} onChange={(_e, value) => onChecked(value)} />}
                label={label}
            />
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
        >
            <SliderField
                label={t('voice.filters.silenceThreshold')}
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

// 取得済みのノイズ除去のおすすめのモデル (おすすめの順。名前はダウンロード画面の名前)
export function useNoiseRemovalModels(): { filename: string; name: string }[] {
    const version = useVoiceLibraryStore(state => state.version);
    const [models, setModels] = React.useState<{ filename: string; name: string }[]>([]);
    React.useEffect(() => {
        let cancelled = false;
        void window.kuraToolkit.voice.library
            .getStatus()
            .then(status => {
                if (cancelled) return;
                const byId = new Map(status.items.map(item => [item.id, item]));
                setModels(
                    NOISE_REMOVAL_MODELS.flatMap(model => {
                        const item = byId.get(`${SEPARATOR_MODEL_PREFIX}${model.filename}`);
                        return item?.status === 'installed'
                            ? [{ filename: model.filename, name: item.name ?? model.filename }]
                            : [];
                    })
                );
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [version]);
    return models;
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
    models?: { filename: string; name: string }[];
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
            {method === 'simple' ? (
                <>
                    <SliderField
                        label={t('voice.filters.noiseFloor')}
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
                        value={value.reductionDb}
                        min={NOISE_REMOVAL_RANGE.reductionDb.min}
                        max={NOISE_REMOVAL_RANGE.reductionDb.max}
                        step={1}
                        format={db}
                        disabled={disabled}
                        onChange={reductionDb => onChange({ ...value, reductionDb })}
                    />
                </>
            ) : (
                model && (
                    <FormControl size='small' disabled={disabled}>
                        <InputLabel id='noise-removal-model'>{t('voice.filters.noiseModelSelect')}</InputLabel>
                        <Select
                            labelId='noise-removal-model'
                            label={t('voice.filters.noiseModelSelect')}
                            value={model.filename}
                            onChange={event => onChange({ ...value, model: String(event.target.value) })}
                        >
                            {models.map(item => (
                                <MenuItem key={item.filename} value={item.filename}>
                                    {item.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )
            )}
        </OptionBlock>
    );
}

export function LoudnessFields({
    value,
    onChange,
    disabled,
}: {
    value: LoudnessOption;
    onChange(value: LoudnessOption): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    return (
        <OptionBlock
            label={t('voice.filters.loudness')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
        >
            <SliderField
                label={t('voice.filters.loudnessTarget')}
                value={value.targetLufs}
                min={LOUDNESS_RANGE.min}
                max={LOUDNESS_RANGE.max}
                step={1}
                format={value => `${value} LUFS`}
                disabled={disabled}
                onChange={targetLufs => onChange({ ...value, targetLufs })}
            />
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

// チェックした加工の説明 (変換の候補・分岐の結果・学習用の音のフィルターの結果に添える)。モデルの名前は、渡された
// 一覧 (models) の名前で示す
export function filterSummary(
    t: TFunction,
    options: {
        muteSilence?: SilenceOption;
        removeSilence?: SilenceOption;
        noiseRemoval?: NoiseRemovalOption;
        loudness?: LoudnessOption;
    },
    models: { filename: string; name: string }[]
): string[] {
    const parts: string[] = [];
    const { muteSilence, removeSilence, noiseRemoval, loudness } = options;
    for (const [option, key] of [
        [muteSilence, 'voice.filters.summaryMuteSilence'],
        [removeSilence, 'voice.filters.summaryRemoveSilence'],
    ] as const) {
        if (option?.enabled) {
            parts.push(t(key, { db: option.thresholdDb, seconds: option.minSeconds.toFixed(1) }));
        }
    }
    if (noiseRemoval?.enabled) {
        parts.push(
            noiseRemoval.method === 'model'
                ? t('voice.filters.summaryNoiseModel', {
                      model:
                          models.find(item => item.filename === noiseRemoval.model)?.name ?? noiseRemoval.model ?? '',
                  })
                : t('voice.filters.summaryNoiseSimple', {
                      floor: noiseRemoval.floorDb,
                      reduction: noiseRemoval.reductionDb,
                  })
        );
    }
    if (loudness?.enabled) parts.push(t('voice.filters.summaryLoudness', { lufs: loudness.targetLufs }));
    return parts;
}
