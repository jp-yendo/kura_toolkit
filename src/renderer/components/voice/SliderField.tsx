import { Box, Slider, Stack, Typography } from '@mui/material';

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
};

// 範囲のある数値をスライダーで調整する入力欄 (現在の値を右に表示する)
export default function SliderField({ label, value, min, max, step, onChange, format, disabled, helperText }: Props) {
    return (
        <Box>
            <Stack direction='row' sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Typography variant='body2' color={disabled ? 'text.disabled' : 'text.primary'}>
                    {label}
                </Typography>
                <Typography variant='body2' color='text.secondary' sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {format ? format(value) : value}
                </Typography>
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
