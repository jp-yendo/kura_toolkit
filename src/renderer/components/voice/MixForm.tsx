import { FormControlLabel, Stack, Switch } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SliderField from './SliderField';
import type { MixParams, ReverbParams } from '@shared/voice/types';

type Props = {
    value: MixParams;
    onChange(value: MixParams): void;
    hasAccompaniment: boolean;
    disabled?: boolean;
};

const db = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
const ratio = (value: number) => value.toFixed(2);

// 合成のパラメーター (ボーカルと伴奏の音量バランス・ボーカルのリバーブ・全体の音量)
export default function MixForm({ value, onChange, hasAccompaniment, disabled }: Props) {
    const { t } = useTranslation();
    const reverb = value.reverb;
    const patchReverb = (patch: Partial<ReverbParams>) => onChange({ ...value, reverb: { ...reverb, ...patch } });
    return (
        <Stack spacing={1.5}>
            <SliderField
                label={t('voice.mix.vocalGain')}
                value={value.vocalGainDb}
                min={-24}
                max={12}
                step={0.5}
                format={db}
                disabled={disabled}
                helperText={t('voice.mix.vocalGainHint')}
                onChange={vocalGainDb => onChange({ ...value, vocalGainDb })}
            />
            <SliderField
                label={t('voice.mix.accompanimentGain')}
                value={value.accompanimentGainDb}
                min={-24}
                max={12}
                step={0.5}
                format={db}
                disabled={disabled || !hasAccompaniment}
                onChange={accompanimentGainDb => onChange({ ...value, accompanimentGainDb })}
            />
            <FormControlLabel
                disabled={disabled}
                control={
                    <Switch
                        size='small'
                        checked={reverb.enabled}
                        onChange={(_e, enabled) => patchReverb({ enabled })}
                    />
                }
                label={t('voice.mix.reverb')}
            />
            {reverb.enabled && (
                <Stack spacing={1} sx={{ pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                    <SliderField
                        label={t('voice.mix.roomSize')}
                        value={reverb.roomSize}
                        min={0}
                        max={1}
                        step={0.01}
                        format={ratio}
                        disabled={disabled}
                        onChange={roomSize => patchReverb({ roomSize })}
                    />
                    <SliderField
                        label={t('voice.mix.damping')}
                        value={reverb.damping}
                        min={0}
                        max={1}
                        step={0.01}
                        format={ratio}
                        disabled={disabled}
                        onChange={damping => patchReverb({ damping })}
                    />
                    <SliderField
                        label={t('voice.mix.wetLevel')}
                        value={reverb.wetLevel}
                        min={0}
                        max={1}
                        step={0.01}
                        format={ratio}
                        disabled={disabled}
                        onChange={wetLevel => patchReverb({ wetLevel })}
                    />
                    <SliderField
                        label={t('voice.mix.dryLevel')}
                        value={reverb.dryLevel}
                        min={0}
                        max={1}
                        step={0.01}
                        format={ratio}
                        disabled={disabled}
                        onChange={dryLevel => patchReverb({ dryLevel })}
                    />
                    <SliderField
                        label={t('voice.mix.width')}
                        value={reverb.width}
                        min={0}
                        max={1}
                        step={0.01}
                        format={ratio}
                        disabled={disabled}
                        onChange={width => patchReverb({ width })}
                    />
                </Stack>
            )}
            <SliderField
                label={t('voice.mix.masterGain')}
                value={value.masterGainDb}
                min={-24}
                max={12}
                step={0.5}
                format={db}
                disabled={disabled}
                onChange={masterGainDb => onChange({ ...value, masterGainDb })}
            />
            <FormControlLabel
                disabled={disabled}
                control={
                    <Switch
                        size='small'
                        checked={value.limiter}
                        onChange={(_e, limiter) => onChange({ ...value, limiter })}
                    />
                }
                label={t('voice.mix.limiter')}
            />
        </Stack>
    );
}
