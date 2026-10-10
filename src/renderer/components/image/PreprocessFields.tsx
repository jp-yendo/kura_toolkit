import { FormControl, InputLabel, MenuItem, Select, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { DEFAULT_VECTORIZE_PREPROCESS, VECTORIZE_PREPROCESS_RANGES } from '@shared/vectorizer';
import type { VectorizePreprocess, VectorizerUpscale } from '@shared/types';
import { SliderRow, SwitchRow } from './SettingRows';

type Props = {
    value: VectorizePreprocess;
    onChange(patch: Partial<VectorizePreprocess>): void;
};

// SVG 変換の前処理の設定 (画像の長辺のサイズ・拡大の方法・背景を除く・許容範囲・小さな点を除く・グレースケールで変換する・
// ベクター化後に色を再現する)。戻すボタンは既定値に戻す。
// 「許容範囲」「小さな点を除く」は「背景を除く」がオンのときだけ、「ベクター化後に色を再現する」は
// 「グレースケールで変換する」がオンのときだけ表示する
export default function PreprocessFields({ value, onChange }: Props) {
    const { t } = useTranslation();
    return (
        <Stack spacing={2}>
            <SliderRow
                label={t('svgPage.longSide')}
                unit='px'
                defaultValue={DEFAULT_VECTORIZE_PREPROCESS.longSide}
                value={value.longSide}
                min={VECTORIZE_PREPROCESS_RANGES.longSide.min}
                max={VECTORIZE_PREPROCESS_RANGES.longSide.max}
                onChange={longSide => onChange({ longSide })}
            />
            <FormControl size='small' fullWidth>
                <InputLabel id='upscale-label'>{t('svgPage.upscale')}</InputLabel>
                <Select
                    labelId='upscale-label'
                    label={t('svgPage.upscale')}
                    value={value.upscale}
                    onChange={event => onChange({ upscale: event.target.value as VectorizerUpscale })}
                >
                    <MenuItem value='nearest'>{t('svgPage.upscaleNearest')}</MenuItem>
                    <MenuItem value='bilinear'>{t('svgPage.upscaleBilinear')}</MenuItem>
                </Select>
            </FormControl>
            <SwitchRow
                label={t('svgPage.removeBackground')}
                checked={value.removeBackground}
                onChange={removeBackground => onChange({ removeBackground })}
            />
            {value.removeBackground && (
                <>
                    <SliderRow
                        label={t('svgPage.backgroundTolerance')}
                        defaultValue={DEFAULT_VECTORIZE_PREPROCESS.backgroundTolerance}
                        value={value.backgroundTolerance}
                        min={VECTORIZE_PREPROCESS_RANGES.backgroundTolerance.min}
                        max={VECTORIZE_PREPROCESS_RANGES.backgroundTolerance.max}
                        onChange={backgroundTolerance => onChange({ backgroundTolerance })}
                    />
                    <SliderRow
                        label={t('svgPage.speckArea')}
                        unit='px'
                        defaultValue={DEFAULT_VECTORIZE_PREPROCESS.speckArea}
                        value={value.speckArea}
                        min={VECTORIZE_PREPROCESS_RANGES.speckArea.min}
                        max={VECTORIZE_PREPROCESS_RANGES.speckArea.max}
                        onChange={speckArea => onChange({ speckArea })}
                    />
                </>
            )}
            <SwitchRow
                label={t('svgPage.grayscale')}
                checked={value.grayscale}
                onChange={grayscale => onChange({ grayscale })}
            />
            {value.grayscale && (
                <SwitchRow
                    label={t('svgPage.recolor')}
                    checked={value.recolor}
                    onChange={recolor => onChange({ recolor })}
                />
            )}
        </Stack>
    );
}
