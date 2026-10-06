import { Box, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch } from '@mui/material';
import { useTranslation } from 'react-i18next';
import NumberField from './NumberField';
import type { SeparationArch, SeparationParams } from '@shared/voice/types';

type Props = {
    arch: SeparationArch;
    params: SeparationParams;
    onChange(params: SeparationParams): void;
    disabled?: boolean;
};

const GRID_SX = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 } as const;
// スイッチは説明が長いため 1 行を使う (2 列の 1 列に押し込むと説明が折り返されるため)
const FULL_ROW_SX = { gridColumn: '1 / -1' } as const;

// 選んだモデルのアーキテクチャに応じて、調整できるパラメーターの入力欄を切り替える
export default function SeparationParamsForm({ arch, params, onChange, disabled }: Props) {
    const { t } = useTranslation();
    const label = (key: string) => t(`voice.separation.params.${key}`);

    if (arch === 'MDX') {
        const value = params.mdx;
        const patch = (next: Partial<typeof value>) => onChange({ ...params, mdx: { ...value, ...next } });
        return (
            <Box sx={GRID_SX}>
                <FormControl size='small' disabled={disabled}>
                    <InputLabel id='mdx-segment'>{label('segmentSize')}</InputLabel>
                    <Select
                        labelId='mdx-segment'
                        label={label('segmentSize')}
                        value={value.segmentSize}
                        onChange={event => patch({ segmentSize: Number(event.target.value) })}
                    >
                        {[128, 256, 512, 1024].map(size => (
                            <MenuItem key={size} value={size}>
                                {size}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <NumberField
                    label={label('overlap')}
                    value={value.overlap}
                    min={0.001}
                    max={0.999}
                    step={0.05}
                    onChange={v => patch({ overlap: v })}
                    disabled={disabled}
                />
                <NumberField
                    label={label('batchSize')}
                    value={value.batchSize}
                    min={1}
                    max={16}
                    integer
                    onChange={v => patch({ batchSize: v })}
                    disabled={disabled}
                />
                <FormControl size='small' disabled={disabled}>
                    <InputLabel id='mdx-hop'>{label('hopLength')}</InputLabel>
                    <Select
                        labelId='mdx-hop'
                        label={label('hopLength')}
                        value={value.hopLength}
                        onChange={event => patch({ hopLength: Number(event.target.value) })}
                    >
                        {[512, 1024].map(size => (
                            <MenuItem key={size} value={size}>
                                {size}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControlLabel
                    sx={FULL_ROW_SX}
                    disabled={disabled}
                    control={
                        <Switch
                            size='small'
                            checked={value.enableDenoise}
                            onChange={(_e, v) => patch({ enableDenoise: v })}
                        />
                    }
                    label={label('enableDenoise')}
                />
            </Box>
        );
    }

    if (arch === 'VR') {
        const value = params.vr;
        const patch = (next: Partial<typeof value>) => onChange({ ...params, vr: { ...value, ...next } });
        return (
            <Box sx={GRID_SX}>
                <FormControl size='small' disabled={disabled}>
                    <InputLabel id='vr-window'>{label('windowSize')}</InputLabel>
                    <Select
                        labelId='vr-window'
                        label={label('windowSize')}
                        value={value.windowSize}
                        onChange={event => patch({ windowSize: Number(event.target.value) })}
                    >
                        {[320, 512, 1024].map(size => (
                            <MenuItem key={size} value={size}>
                                {size}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <NumberField
                    label={label('aggression')}
                    value={value.aggression}
                    min={-100}
                    max={100}
                    integer
                    onChange={v => patch({ aggression: v })}
                    disabled={disabled}
                />
                <NumberField
                    label={label('batchSize')}
                    value={value.batchSize}
                    min={1}
                    max={16}
                    integer
                    onChange={v => patch({ batchSize: v })}
                    disabled={disabled}
                />
                <FormControlLabel
                    sx={FULL_ROW_SX}
                    disabled={disabled}
                    control={
                        <Switch size='small' checked={value.enableTta} onChange={(_e, v) => patch({ enableTta: v })} />
                    }
                    label={label('enableTta')}
                />
                <FormControlLabel
                    sx={FULL_ROW_SX}
                    disabled={disabled}
                    control={
                        <Switch
                            size='small'
                            checked={value.highEndProcess}
                            onChange={(_e, v) => patch({ highEndProcess: v })}
                        />
                    }
                    label={label('highEndProcess')}
                />
                {/* しきい値は、それを使う後処理のスイッチの直後に置く */}
                <FormControlLabel
                    sx={FULL_ROW_SX}
                    disabled={disabled}
                    control={
                        <Switch
                            size='small'
                            checked={value.enablePostProcess}
                            onChange={(_e, v) => patch({ enablePostProcess: v })}
                        />
                    }
                    label={label('enablePostProcess')}
                />
                <NumberField
                    label={label('postProcessThreshold')}
                    value={value.postProcessThreshold}
                    min={0.1}
                    max={0.3}
                    step={0.05}
                    onChange={v => patch({ postProcessThreshold: v })}
                    disabled={disabled || !value.enablePostProcess}
                />
            </Box>
        );
    }

    if (arch === 'Demucs') {
        const value = params.demucs;
        const patch = (next: Partial<typeof value>) => onChange({ ...params, demucs: { ...value, ...next } });
        return (
            <Box sx={GRID_SX}>
                <NumberField
                    label={label('segmentSize')}
                    value={value.segmentSize}
                    min={1}
                    max={100}
                    integer
                    allowEmpty
                    emptyLabel={t('voice.separation.params.modelDefault')}
                    onChange={v => patch({ segmentSize: v })}
                    disabled={disabled}
                />
                <NumberField
                    label={label('shifts')}
                    value={value.shifts}
                    min={0}
                    max={20}
                    integer
                    onChange={v => patch({ shifts: v })}
                    disabled={disabled}
                />
                <NumberField
                    label={label('overlap')}
                    value={value.overlap}
                    min={0.001}
                    max={0.999}
                    step={0.05}
                    onChange={v => patch({ overlap: v })}
                    disabled={disabled}
                />
                <FormControlLabel
                    sx={FULL_ROW_SX}
                    disabled={disabled}
                    control={
                        <Switch
                            size='small'
                            checked={value.segmentsEnabled}
                            onChange={(_e, v) => patch({ segmentsEnabled: v })}
                        />
                    }
                    label={label('segmentsEnabled')}
                />
            </Box>
        );
    }

    const value = params.mdxc;
    const patch = (next: Partial<typeof value>) => onChange({ ...params, mdxc: { ...value, ...next } });
    return (
        <Box sx={GRID_SX}>
            {/* 上書きのスイッチは、それで入力できるようになるセグメントサイズの直前に置く */}
            <FormControlLabel
                sx={FULL_ROW_SX}
                disabled={disabled}
                control={
                    <Switch
                        size='small'
                        checked={value.overrideModelSegmentSize}
                        onChange={(_e, v) => patch({ overrideModelSegmentSize: v })}
                    />
                }
                label={label('overrideModelSegmentSize')}
            />
            <NumberField
                label={label('segmentSize')}
                value={value.segmentSize}
                min={32}
                max={4096}
                integer
                onChange={v => patch({ segmentSize: v })}
                disabled={disabled || !value.overrideModelSegmentSize}
            />
            <NumberField
                label={label('overlapCount')}
                value={value.overlap}
                min={2}
                max={50}
                integer
                allowEmpty
                emptyLabel={t('voice.separation.params.modelDefault')}
                onChange={v => patch({ overlap: v })}
                disabled={disabled}
            />
            <NumberField
                label={label('batchSize')}
                value={value.batchSize}
                min={1}
                max={16}
                integer
                allowEmpty
                emptyLabel={t('voice.separation.params.modelDefault')}
                onChange={v => patch({ batchSize: v })}
                disabled={disabled}
            />
            <NumberField
                label={label('pitchShift')}
                value={value.pitchShift}
                min={-12}
                max={12}
                integer
                onChange={v => patch({ pitchShift: v })}
                disabled={disabled}
            />
        </Box>
    );
}
