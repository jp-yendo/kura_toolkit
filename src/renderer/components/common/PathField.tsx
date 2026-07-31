import { IconButton, InputAdornment, TextField } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

type Props = {
    label: string;
    value: string;
    onChange(value: string): void;
    // 参照ボタン押下時。null を返すとキャンセル扱い
    onBrowse(): Promise<string | null>;
    helperText?: string;
    disabled?: boolean;
    size?: 'small' | 'medium';
};

// パス入力欄 + 参照ボタン
export default function PathField({ label, value, onChange, onBrowse, helperText, disabled, size = 'small' }: Props) {
    return (
        <TextField
            fullWidth
            size={size}
            label={label}
            value={value}
            helperText={helperText}
            disabled={disabled}
            onChange={event => onChange(event.target.value)}
            slotProps={{
                input: {
                    endAdornment: (
                        <InputAdornment position='end'>
                            <IconButton
                                edge='end'
                                disabled={disabled}
                                onClick={async () => {
                                    const selected = await onBrowse();
                                    if (selected) onChange(selected);
                                }}
                            >
                                <FolderOpenIcon />
                            </IconButton>
                        </InputAdornment>
                    ),
                },
            }}
        />
    );
}
