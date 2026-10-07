import { Box, Slider, Stack, Typography } from '@mui/material';
import ResetButton from '../common/ResetButton';

type Props = {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange(value: number): void;
    format?(value: number): string;
    disabled?: boolean;
    helperText?: string;
    // 初期値。指定すると、値の右に初期値に戻すボタンを置く
    defaultValue?: number;
};

// 範囲のある数値をスライダーで調整する入力欄 (現在の値を右に表示する。初期値があれば、その右に初期値に戻すボタンを置く)
export default function SliderField({
    label,
    value,
    min,
    max,
    step,
    onChange,
    format,
    disabled,
    helperText,
    defaultValue,
}: Props) {
    return (
        <Box>
            <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
                <Typography variant='body2' color={disabled ? 'text.disabled' : 'text.primary'} sx={{ flexGrow: 1 }}>
                    {label}
                </Typography>
                <Typography variant='body2' color='text.secondary' sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {format ? format(value) : value}
                </Typography>
                {defaultValue !== undefined && (
                    <ResetButton onClick={() => onChange(defaultValue)} disabled={disabled || value === defaultValue} />
                )}
            </Stack>
            <Slider
                size='small'
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={(_event, next) => onChange(next as number)}
                aria-label={label}
            />
            {helperText && (
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{ display: 'block', lineHeight: 1.5, mt: -0.5 }}
                >
                    {helperText}
                </Typography>
            )}
        </Box>
    );
}
