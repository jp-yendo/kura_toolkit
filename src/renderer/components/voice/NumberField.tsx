import React from 'react';
import { TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

// 空欄を許す項目は null (モデルの既定などを表す) を含む値、許さない項目は常に数値を扱う
type FieldValue<AllowEmpty extends boolean> = AllowEmpty extends true ? number | null : number;

type Props<AllowEmpty extends boolean> = {
    label: string;
    value: FieldValue<AllowEmpty>;
    onChange(value: FieldValue<AllowEmpty>): void;
    min: number;
    max: number;
    step?: number;
    // 整数だけを受け付ける
    integer?: boolean;
    // 空欄を許す
    allowEmpty?: AllowEmpty;
    emptyLabel?: string;
    helperText?: string;
    disabled?: boolean;
    sx?: SxProps<Theme>;
};

// 数値の入力欄。入力途中は文字列のまま持ち、確定時 (フォーカスを外したとき) に範囲へ収めて反映する。
// 空欄を許さない項目を空欄や数値でない内容で確定した場合は、確定前の値に戻す
export default function NumberField<AllowEmpty extends boolean = false>({
    label,
    value,
    onChange,
    min,
    max,
    step,
    integer,
    allowEmpty,
    emptyLabel,
    helperText,
    disabled,
    sx,
}: Props<AllowEmpty>) {
    const shown = (current: number | null) => (current === null ? '' : String(current));
    const [text, setText] = React.useState(shown(value));
    React.useEffect(() => {
        setText(shown(value));
    }, [value]);

    const commit = () => {
        const trimmed = text.trim();
        if (trimmed === '' && allowEmpty) {
            (onChange as (next: number | null) => void)(null);
            return;
        }
        const parsed = Number(trimmed);
        if (trimmed === '' || !Number.isFinite(parsed)) {
            setText(shown(value));
            return;
        }
        const clamped = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed));
        setText(String(clamped));
        if (clamped !== value) (onChange as (next: number) => void)(clamped);
    };

    return (
        <TextField
            size='small'
            label={label}
            value={text}
            placeholder={allowEmpty ? emptyLabel : undefined}
            helperText={helperText}
            disabled={disabled}
            onChange={event => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === 'Enter') commit();
            }}
            slotProps={{ htmlInput: { inputMode: 'decimal', min, max, step } }}
            sx={sx}
        />
    );
}
