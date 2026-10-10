import React from 'react';
import { Box, FormControlLabel, InputAdornment, Slider, Stack, Switch, TextField, Typography } from '@mui/material';
import ResetButton from '../common/ResetButton';

// 画像の機能の設定の行 (スライダーと数値の入力欄・スイッチ)

// 入力欄で受け付ける数値の範囲と小数の桁数 (桁数を省略したときは整数だけ)
type NumberFormat = { min: number; max: number; decimals?: number };

function formatNumber(value: number, decimals?: number): string {
    return decimals ? value.toFixed(decimals) : String(value);
}

// 入力欄の文字を数値にする (範囲外・形の違う文字は null)
function parseNumber(text: string, { min, max, decimals }: NumberFormat): number | null {
    const trimmed = text.trim();
    const pattern = decimals ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
    if (!pattern.test(trimmed)) return null;
    const value = Number(trimmed);
    return value >= min && value <= max ? value : null;
}

// 数値の入力欄の文字。入力中の文字は手元に持ち、範囲内の数値になったときだけ値を変える。
// 値が外から変わったとき (スライダー・戻すボタン・プリセットなど) は、入力欄の文字をその値にする
function useNumberText(value: number, format: NumberFormat, onChange: (value: number) => void) {
    const { decimals } = format;
    const [text, setText] = React.useState(formatNumber(value, decimals));
    React.useEffect(() => {
        setText(current => (Number(current.trim()) === value ? current : formatNumber(value, decimals)));
    }, [value, decimals]);
    const parsed = parseNumber(text, format);
    return {
        text,
        parsed,
        change(next: string) {
            setText(next);
            const number = parseNumber(next, format);
            if (number !== null) onChange(number);
        },
        set(next: number) {
            setText(formatNumber(next, decimals));
            onChange(next);
        },
        // 範囲外のまま離れたときは、今の値に戻す
        revertIfInvalid() {
            if (parsed === null) setText(formatNumber(value, decimals));
        },
    };
}

type SliderRowProps = {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    // 小数の桁数 (省略時は整数)
    decimals?: number;
    // 戻す先の値 (見出しの右に、この値に戻すボタンを置く)
    defaultValue: number;
    // 戻すボタンのツールチップ (省略時は「初期値に戻す」)
    resetTitle?: string;
    // 入力欄の後ろに付ける単位 (px など)
    unit?: string;
    onChange(value: number): void;
};

// 見出しと戻すボタン、スライダーと数値の入力欄の行。
// 入力欄では上下の矢印キーで 1 刻み (step) ずつ変えられる
export function SliderRow({
    label,
    value,
    min,
    max,
    step = 1,
    decimals,
    defaultValue,
    resetTitle,
    unit,
    onChange,
}: SliderRowProps) {
    const input = useNumberText(value, { min, max, decimals }, onChange);
    const stepBy = (direction: 1 | -1) => {
        const next = Math.min(max, Math.max(min, (input.parsed ?? value) + direction * step));
        input.set(Number(next.toFixed(decimals ?? 0)));
    };
    return (
        <Box>
            <Stack direction='row' sx={{ alignItems: 'center', mb: 0.5 }}>
                <Typography variant='body2' color='text.secondary' sx={{ flexGrow: 1 }}>
                    {label}
                </Typography>
                <ResetButton
                    onClick={() => input.set(defaultValue)}
                    disabled={value === defaultValue}
                    title={resetTitle}
                />
            </Stack>
            <Stack direction='row' spacing={2} sx={{ alignItems: 'center' }}>
                <Slider
                    size='small'
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    aria-label={label}
                    onChange={(_event, newValue) => onChange(newValue as number)}
                    sx={{ flexGrow: 1 }}
                />
                <TextField
                    size='small'
                    value={input.text}
                    error={input.parsed === null}
                    onChange={event => input.change(event.target.value)}
                    onBlur={input.revertIfInvalid}
                    onKeyDown={event => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                        event.preventDefault();
                        stepBy(event.key === 'ArrowUp' ? 1 : -1);
                    }}
                    slotProps={{
                        htmlInput: {
                            inputMode: decimals ? 'decimal' : 'numeric',
                            'aria-label': label,
                            style: { textAlign: 'right' },
                        },
                        input: unit
                            ? { endAdornment: <InputAdornment position='end'>{unit}</InputAdornment> }
                            : undefined,
                    }}
                    sx={{ width: unit ? 104 : 72, flexShrink: 0 }}
                />
            </Stack>
        </Box>
    );
}

type SwitchRowProps = {
    label: string;
    checked: boolean;
    onChange(checked: boolean): void;
};

// スイッチの行
export function SwitchRow({ label, checked, onChange }: SwitchRowProps) {
    return (
        <FormControlLabel
            sx={{ mr: 0 }}
            control={<Switch size='small' checked={checked} onChange={(_event, value) => onChange(value)} />}
            label={label}
            slotProps={{ typography: { variant: 'body2' } }}
        />
    );
}
