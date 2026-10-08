import { Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SliderField from './SliderField';
import { DEFAULT_MIX_PARAMS } from '../../stores/conversionStore';
import type { MixParams } from '@shared/voice/types';

type Props = {
    value: MixParams;
    onChange(value: MixParams): void;
    hasAccompaniment: boolean;
    disabled?: boolean;
};

const db = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;

// 合成のパラメーター (ボーカルと伴奏の音量バランス・全体の音量)。ボーカルのリバーブは、変換の段階で候補のフィルターの
// エフェクトとしてかける (変換後の声は元のボーカルの響きも含めて変換されているため、足りないときだけ前もってかける)
export default function MixForm({ value, onChange, hasAccompaniment, disabled }: Props) {
    const { t } = useTranslation();
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
