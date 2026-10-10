import { Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { DEFAULT_VECTORIZE_OUTPUT, VECTORIZE_OUTPUT_RANGES } from '@shared/vectorizer';
import type { VectorizeOutput } from '@shared/types';
import { SliderRow, SwitchRow } from './SettingRows';

type Props = {
    value: VectorizeOutput;
    onChange(patch: Partial<VectorizeOutput>): void;
};

// SVG 変換の出力の設定 (パスを最適化する・座標の精度)。戻すボタンは既定値に戻す
export default function OutputFields({ value, onChange }: Props) {
    const { t } = useTranslation();
    return (
        <Stack spacing={2}>
            <SwitchRow
                label={t('svgPage.optimize')}
                checked={value.optimize}
                onChange={optimize => onChange({ optimize })}
            />
            <SliderRow
                label={t('svgPage.pathPrecision')}
                defaultValue={DEFAULT_VECTORIZE_OUTPUT.pathPrecision}
                value={value.pathPrecision}
                min={VECTORIZE_OUTPUT_RANGES.pathPrecision.min}
                max={VECTORIZE_OUTPUT_RANGES.pathPrecision.max}
                step={VECTORIZE_OUTPUT_RANGES.pathPrecision.step}
                onChange={pathPrecision => onChange({ pathPrecision })}
            />
        </Stack>
    );
}
