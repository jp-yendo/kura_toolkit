import { FormControlLabel, Stack, Switch } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SliderField from './SliderField';
import ResetButton from '../common/ResetButton';
import { DEFAULT_MIX_PARAMS } from '../../stores/conversionStore';
import type { MixParams, ReverbParams } from '@shared/voice/types';

type Props = {
    value: MixParams;
    onChange(value: MixParams): void;
    hasAccompaniment: boolean;
    disabled?: boolean;
};

const db = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
const ratio = (value: number) => value.toFixed(2);
const DEFAULT_REVERB = DEFAULT_MIX_PARAMS.reverb;

// 合成のパラメーター (ボーカルと伴奏の音量バランス・ボーカルのリバーブ・全体の音量)
export default function MixForm({ value, onChange, hasAccompaniment, disabled }: Props) {
    const { t } = useTranslation();
    const reverb = value.reverb;
    const patchReverb = (patch: Partial<ReverbParams>) => onChange({ ...value, reverb: { ...reverb, ...patch } });
    return (
        <Stack spacing={1.5}>
            <SliderField
                label={t('voice.mix.vocalGain')}
                defaultValue={DEFAULT_MIX_PARAMS.vocalGainDb}
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
                defaultValue={DEFAULT_MIX_PARAMS.accompanimentGainDb}
                value={value.accompanimentGainDb}
                min={-24}
                max={12}
                step={0.5}
                format={db}
                disabled={disabled || !hasAccompaniment}
                onChange={accompanimentGainDb => onChange({ ...value, accompanimentGainDb })}
            />
            {/* リバーブを入れているときだけ、行の右端にリバーブの中身をまとめて初期値に戻すボタンを出す (オン・オフは変えない) */}
            <Stack direction='row' sx={{ alignItems: 'center' }}>
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
                    sx={{ flexGrow: 1, mr: 0 }}
                />
                {reverb.enabled && (
                    <ResetButton
                        onClick={() => patchReverb({ ...DEFAULT_REVERB, enabled: true })}
                        disabled={
                            disabled ||
                            (reverb.roomSize === DEFAULT_REVERB.roomSize &&
                                reverb.damping === DEFAULT_REVERB.damping &&
                                reverb.wetLevel === DEFAULT_REVERB.wetLevel &&
                                reverb.dryLevel === DEFAULT_REVERB.dryLevel &&
                                reverb.width === DEFAULT_REVERB.width)
                        }
                    />
                )}
            </Stack>
            {reverb.enabled && (
                <Stack spacing={1} sx={{ pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                    <SliderField
                        label={t('voice.mix.roomSize')}
                        defaultValue={DEFAULT_REVERB.roomSize}
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
                        defaultValue={DEFAULT_REVERB.damping}
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
                        defaultValue={DEFAULT_REVERB.wetLevel}
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
                        defaultValue={DEFAULT_REVERB.dryLevel}
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
                        defaultValue={DEFAULT_REVERB.width}
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
                defaultValue={DEFAULT_MIX_PARAMS.masterGainDb}
                value={value.masterGainDb}
                min={-24}
                max={12}
                step={0.5}
                format={db}
                disabled={disabled}
                onChange={masterGainDb => onChange({ ...value, masterGainDb })}
            />
        </Stack>
    );
}
