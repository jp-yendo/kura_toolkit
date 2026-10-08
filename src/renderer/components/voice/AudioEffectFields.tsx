import {
    Box,
    FormControl,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Slider,
    Stack,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import SliderField from './SliderField';
import { OptionBlock } from './AudioFilterFields';
import {
    EFFECT_DEFAULTS,
    EFFECT_RANGE,
    EQ_BANDS_HZ,
    EQ_GAIN_RANGE,
    EQ_LOW_CUT_CHOICES,
    EQ_PRESETS,
    REVERB_PRESETS,
    type ChorusOption,
    type CompressorOption,
    type DeesserOption,
    type DelayOption,
    type EffectsOptions,
    type EqOption,
    type EqPresetGroup,
    type ReverbOption,
} from '@shared/voice/audio-effects';

// 効果を付けるエフェクトの設定欄 (EQ・コンプレッサー・ディエッサー・コーラス・ディレイ・リバーブ)。分岐の「エフェクト」と
// 音声変換の候補のフィルターで同じものを使う。どれもチェックすると、その下に設定の欄を出す (かける順に並べる)

const db = (value: number) => `${value} dB`;
const fixed2 = (value: number) => value.toFixed(2);
const hz = (value: number) => (value >= 1000 ? `${value / 1000}k` : String(value));

// プリセットの欄で、今の値がどのプリセットとも違うときの値 (一覧には出さない隠れた選択肢として持つ。欄の値を空にすると、
// 欄の名前が中の文字に重なって示されるため)
const CUSTOM_PRESET = 'custom';

// 中身がすべて初期値か (初期値に戻すボタンを押せない状態にする)
function sameValues(value: Record<string, unknown>, defaults: Record<string, unknown>): boolean {
    return Object.keys(defaults).every(key => JSON.stringify(value[key]) === JSON.stringify(defaults[key]));
}

// 今の値に一致するプリセット (無ければ空。「カスタム」と示す)
function matchingEqPreset(value: EqOption): string {
    return (
        EQ_PRESETS.find(
            preset =>
                preset.lowCutHz === value.lowCutHz &&
                preset.gainsDb.every((gain, index) => gain === value.gainsDb[index])
        )?.id ?? ''
    );
}

function matchingReverbPreset(value: ReverbOption): string {
    return REVERB_PRESETS.find(preset => sameValues(value, preset.values))?.id ?? '';
}

// EQ: プリセット・ローカットと、10 本の縦のスライダー (グラフィック EQ)
function EqFields({
    value,
    onChange,
    disabled,
}: {
    value: EqOption;
    onChange(value: EqOption): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const preset = matchingEqPreset(value);
    const groups: EqPresetGroup[] = ['voice', 'music'];
    return (
        <OptionBlock
            label={t('voice.effects.eq')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...EFFECT_DEFAULTS.eq, gainsDb: [...EFFECT_DEFAULTS.eq.gainsDb] })}
            isDefault={sameValues(value, EFFECT_DEFAULTS.eq)}
        >
            <Stack direction='row' spacing={1.5} sx={{ pt: 0.5 }}>
                <FormControl size='small' sx={{ flexGrow: 1, minWidth: 0 }} disabled={disabled}>
                    <InputLabel id='effects-eq-preset'>{t('voice.effects.preset')}</InputLabel>
                    <Select
                        labelId='effects-eq-preset'
                        label={t('voice.effects.preset')}
                        value={preset || CUSTOM_PRESET}
                        onChange={event => {
                            const next = EQ_PRESETS.find(item => item.id === event.target.value);
                            if (next) onChange({ ...value, lowCutHz: next.lowCutHz, gainsDb: [...next.gainsDb] });
                        }}
                        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420 } } } }}
                    >
                        <MenuItem value={CUSTOM_PRESET} sx={{ display: 'none' }}>
                            {t('voice.effects.custom')}
                        </MenuItem>
                        {groups.flatMap(group => [
                            <ListSubheader key={`group-${group}`}>
                                {t(`voice.effects.eqGroups.${group}`)}
                            </ListSubheader>,
                            ...EQ_PRESETS.filter(item => item.group === group).map(item => (
                                <MenuItem key={item.id} value={item.id}>
                                    {t(`voice.effects.eqPresets.${item.id}`)}
                                </MenuItem>
                            )),
                        ])}
                    </Select>
                </FormControl>
                <FormControl size='small' sx={{ width: 150, flexShrink: 0 }} disabled={disabled}>
                    <InputLabel id='effects-eq-low-cut'>{t('voice.effects.lowCut')}</InputLabel>
                    <Select
                        labelId='effects-eq-low-cut'
                        label={t('voice.effects.lowCut')}
                        value={value.lowCutHz}
                        onChange={event => onChange({ ...value, lowCutHz: Number(event.target.value) })}
                    >
                        {EQ_LOW_CUT_CHOICES.map(choice => (
                            <MenuItem key={choice} value={choice}>
                                {choice === 0 ? t('voice.effects.lowCutOff') : `${choice} Hz`}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Stack>
            {/* 真ん中が 0 dB、上下が ±12 dB。各スライダーの上に今の値、下に周波数を示す */}
            <Box
                sx={{ display: 'grid', gridTemplateColumns: `repeat(${EQ_BANDS_HZ.length}, minmax(0, 1fr))`, pt: 0.5 }}
            >
                {EQ_BANDS_HZ.map((band, index) => (
                    <Stack key={band} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography
                            variant='caption'
                            color='text.secondary'
                            sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.6 }}
                        >
                            {value.gainsDb[index] > 0 ? `+${value.gainsDb[index]}` : value.gainsDb[index]}
                        </Typography>
                        <Slider
                            orientation='vertical'
                            size='small'
                            value={value.gainsDb[index]}
                            min={EQ_GAIN_RANGE.min}
                            max={EQ_GAIN_RANGE.max}
                            step={0.5}
                            marks={[{ value: 0 }]}
                            track={false}
                            disabled={disabled}
                            aria-label={t('voice.effects.eqBand', { band: `${hz(band)} Hz` })}
                            onChange={(_event, next) =>
                                onChange({
                                    ...value,
                                    gainsDb: value.gainsDb.map((gain, position) =>
                                        position === index ? (next as number) : gain
                                    ),
                                })
                            }
                            sx={{ height: 120, my: 1 }}
                        />
                        <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                            {hz(band)}
                        </Typography>
                    </Stack>
                ))}
            </Box>
        </OptionBlock>
    );
}

function CompressorFields({
    value,
    onChange,
    disabled,
}: {
    value: CompressorOption;
    onChange(value: CompressorOption): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const defaults = EFFECT_DEFAULTS.compressor;
    const range = EFFECT_RANGE.compressor;
    return (
        <OptionBlock
            label={t('voice.effects.compressor')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...defaults })}
            isDefault={sameValues(value, defaults)}
        >
            <SliderField
                label={t('voice.effects.threshold')}
                defaultValue={defaults.thresholdDb}
                value={value.thresholdDb}
                {...range.thresholdDb}
                step={1}
                format={db}
                disabled={disabled}
                helperText={t('voice.effects.thresholdHint')}
                onChange={thresholdDb => onChange({ ...value, thresholdDb })}
            />
            <SliderField
                label={t('voice.effects.ratio')}
                defaultValue={defaults.ratio}
                value={value.ratio}
                {...range.ratio}
                step={0.5}
                format={ratio => `${ratio} : 1`}
                disabled={disabled}
                onChange={ratio => onChange({ ...value, ratio })}
            />
            <SliderField
                label={t('voice.effects.attack')}
                defaultValue={defaults.attackMs}
                value={value.attackMs}
                {...range.attackMs}
                step={0.1}
                format={ms => `${ms} ms`}
                disabled={disabled}
                onChange={attackMs => onChange({ ...value, attackMs })}
            />
            <SliderField
                label={t('voice.effects.release')}
                defaultValue={defaults.releaseMs}
                value={value.releaseMs}
                {...range.releaseMs}
                step={10}
                format={ms => `${ms} ms`}
                disabled={disabled}
                onChange={releaseMs => onChange({ ...value, releaseMs })}
            />
        </OptionBlock>
    );
}

function DeesserFields({
    value,
    onChange,
    disabled,
}: {
    value: DeesserOption;
    onChange(value: DeesserOption): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const defaults = EFFECT_DEFAULTS.deesser;
    const range = EFFECT_RANGE.deesser;
    return (
        <OptionBlock
            label={t('voice.effects.deesser')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...defaults })}
            isDefault={sameValues(value, defaults)}
        >
            <SliderField
                label={t('voice.effects.deesserIntensity')}
                defaultValue={defaults.intensity}
                value={value.intensity}
                {...range.intensity}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={intensity => onChange({ ...value, intensity })}
            />
            <SliderField
                label={t('voice.effects.deesserMax')}
                defaultValue={defaults.max}
                value={value.max}
                {...range.max}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={max => onChange({ ...value, max })}
            />
            <SliderField
                label={t('voice.effects.deesserFrequency')}
                defaultValue={defaults.frequency}
                value={value.frequency}
                {...range.frequency}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                helperText={t('voice.effects.deesserFrequencyHint')}
                onChange={frequency => onChange({ ...value, frequency })}
            />
        </OptionBlock>
    );
}

function ChorusFields({
    value,
    onChange,
    disabled,
}: {
    value: ChorusOption;
    onChange(value: ChorusOption): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const defaults = EFFECT_DEFAULTS.chorus;
    const range = EFFECT_RANGE.chorus;
    return (
        <OptionBlock
            label={t('voice.effects.chorus')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...defaults })}
            isDefault={sameValues(value, defaults)}
        >
            <SliderField
                label={t('voice.effects.chorusRate')}
                defaultValue={defaults.rateHz}
                value={value.rateHz}
                {...range.rateHz}
                step={0.1}
                format={rate => `${rate.toFixed(1)} Hz`}
                disabled={disabled}
                onChange={rateHz => onChange({ ...value, rateHz })}
            />
            <SliderField
                label={t('voice.effects.chorusDepth')}
                defaultValue={defaults.depth}
                value={value.depth}
                {...range.depth}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={depth => onChange({ ...value, depth })}
            />
            <SliderField
                label={t('voice.effects.chorusCentreDelay')}
                defaultValue={defaults.centreDelayMs}
                value={value.centreDelayMs}
                {...range.centreDelayMs}
                step={0.5}
                format={ms => `${ms} ms`}
                disabled={disabled}
                onChange={centreDelayMs => onChange({ ...value, centreDelayMs })}
            />
            <SliderField
                label={t('voice.effects.feedback')}
                defaultValue={defaults.feedback}
                value={value.feedback}
                {...range.feedback}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={feedback => onChange({ ...value, feedback })}
            />
            <SliderField
                label={t('voice.effects.mix')}
                defaultValue={defaults.mix}
                value={value.mix}
                {...range.mix}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={mix => onChange({ ...value, mix })}
            />
        </OptionBlock>
    );
}

function DelayFields({
    value,
    onChange,
    disabled,
}: {
    value: DelayOption;
    onChange(value: DelayOption): void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const defaults = EFFECT_DEFAULTS.delay;
    const range = EFFECT_RANGE.delay;
    return (
        <OptionBlock
            label={t('voice.effects.delay')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...defaults })}
            isDefault={sameValues(value, defaults)}
        >
            <SliderField
                label={t('voice.effects.delayTime')}
                defaultValue={defaults.delaySeconds}
                value={value.delaySeconds}
                {...range.delaySeconds}
                step={0.01}
                format={seconds => t('voice.filters.secondsValue', { value: seconds.toFixed(2) })}
                disabled={disabled}
                onChange={delaySeconds => onChange({ ...value, delaySeconds })}
            />
            <SliderField
                label={t('voice.effects.feedback')}
                defaultValue={defaults.feedback}
                value={value.feedback}
                {...range.feedback}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={feedback => onChange({ ...value, feedback })}
            />
            <SliderField
                label={t('voice.effects.mix')}
                defaultValue={defaults.mix}
                value={value.mix}
                {...range.mix}
                step={0.01}
                format={fixed2}
                disabled={disabled}
                onChange={mix => onChange({ ...value, mix })}
            />
        </OptionBlock>
    );
}

// リバーブ: プリセットと 5 つのパラメーター。ステレオの広がりはステレオの音で効く (stereo が false のときは添え書きで示す)
function ReverbFields({
    value,
    onChange,
    disabled,
    stereo,
}: {
    value: ReverbOption;
    onChange(value: ReverbOption): void;
    disabled?: boolean;
    stereo: boolean;
}) {
    const { t } = useTranslation();
    const defaults = EFFECT_DEFAULTS.reverb;
    const range = EFFECT_RANGE.reverb;
    const preset = matchingReverbPreset(value);
    const slider = (key: keyof typeof range, helperText?: string) => (
        <SliderField
            label={t(`voice.effects.${key}`)}
            defaultValue={defaults[key]}
            value={value[key]}
            {...range[key]}
            step={0.01}
            format={fixed2}
            disabled={disabled}
            helperText={helperText}
            onChange={next => onChange({ ...value, [key]: next })}
        />
    );
    return (
        <OptionBlock
            label={t('voice.effects.reverb')}
            checked={value.enabled}
            onChecked={enabled => onChange({ ...value, enabled })}
            disabled={disabled}
            onReset={() => onChange({ ...value, ...defaults })}
            isDefault={sameValues(value, defaults)}
        >
            <FormControl size='small' disabled={disabled} sx={{ mt: 0.5 }}>
                <InputLabel id='effects-reverb-preset'>{t('voice.effects.preset')}</InputLabel>
                <Select
                    labelId='effects-reverb-preset'
                    label={t('voice.effects.preset')}
                    value={preset || CUSTOM_PRESET}
                    onChange={event => {
                        const next = REVERB_PRESETS.find(item => item.id === event.target.value);
                        if (next) onChange({ ...value, ...next.values });
                    }}
                >
                    <MenuItem value={CUSTOM_PRESET} sx={{ display: 'none' }}>
                        {t('voice.effects.custom')}
                    </MenuItem>
                    {REVERB_PRESETS.map(item => (
                        <MenuItem key={item.id} value={item.id}>
                            {t(`voice.effects.reverbPresets.${item.id}`)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
            {slider('roomSize')}
            {slider('damping')}
            {slider('wetLevel')}
            {slider('dryLevel', t('voice.effects.dryLevelHint'))}
            {slider('width', stereo ? undefined : t('voice.effects.widthMonoHint'))}
        </OptionBlock>
    );
}

// エフェクトの欄 (かける順に並べる)。stereo は、出力がステレオになるか (リバーブのステレオの広がりの添え書きに使う)
export function EffectFields({
    value,
    onChange,
    disabled,
    stereo,
}: {
    value: EffectsOptions;
    onChange(value: EffectsOptions): void;
    disabled?: boolean;
    stereo: boolean;
}) {
    return (
        <Stack spacing={1}>
            <EqFields value={value.eq} disabled={disabled} onChange={eq => onChange({ ...value, eq })} />
            <CompressorFields
                value={value.compressor}
                disabled={disabled}
                onChange={compressor => onChange({ ...value, compressor })}
            />
            <DeesserFields
                value={value.deesser}
                disabled={disabled}
                onChange={deesser => onChange({ ...value, deesser })}
            />
            <ChorusFields
                value={value.chorus}
                disabled={disabled}
                onChange={chorus => onChange({ ...value, chorus })}
            />
            <DelayFields value={value.delay} disabled={disabled} onChange={delay => onChange({ ...value, delay })} />
            <ReverbFields
                value={value.reverb}
                disabled={disabled}
                stereo={stereo}
                onChange={reverb => onChange({ ...value, reverb })}
            />
        </Stack>
    );
}

// 保存したプリセットなどに無い項目 (後から増えた項目) を初期値で補う
export function completeEffects(value: Partial<EffectsOptions> | undefined, defaults: EffectsOptions): EffectsOptions {
    return {
        eq: { ...defaults.eq, ...value?.eq },
        compressor: { ...defaults.compressor, ...value?.compressor },
        deesser: { ...defaults.deesser, ...value?.deesser },
        chorus: { ...defaults.chorus, ...value?.chorus },
        delay: { ...defaults.delay, ...value?.delay },
        reverb: { ...defaults.reverb, ...value?.reverb },
    };
}

// チェックしたエフェクトの説明 (分岐の結果・変換の候補に添える)。かける順に並べ、プリセットと一致するものはその名前で示す
export function effectsSummary(t: TFunction, effects: EffectsOptions): string[] {
    const parts: string[] = [];
    if (effects.eq.enabled) {
        const preset = matchingEqPreset(effects.eq);
        parts.push(
            t('voice.effects.summaryEq', {
                preset: preset ? t(`voice.effects.eqPresets.${preset}`) : t('voice.effects.custom'),
            })
        );
    }
    if (effects.compressor.enabled) {
        parts.push(
            t('voice.effects.summaryCompressor', {
                threshold: effects.compressor.thresholdDb,
                ratio: effects.compressor.ratio,
            })
        );
    }
    if (effects.deesser.enabled) {
        parts.push(t('voice.effects.summaryDeesser', { intensity: effects.deesser.intensity.toFixed(2) }));
    }
    if (effects.chorus.enabled) parts.push(t('voice.effects.summaryChorus', { mix: effects.chorus.mix.toFixed(2) }));
    if (effects.delay.enabled) {
        parts.push(
            t('voice.effects.summaryDelay', {
                seconds: effects.delay.delaySeconds.toFixed(2),
                mix: effects.delay.mix.toFixed(2),
            })
        );
    }
    if (effects.reverb.enabled) {
        const preset = matchingReverbPreset(effects.reverb);
        parts.push(
            t('voice.effects.summaryReverb', {
                preset: preset ? t(`voice.effects.reverbPresets.${preset}`) : t('voice.effects.custom'),
            })
        );
    }
    return parts;
}
