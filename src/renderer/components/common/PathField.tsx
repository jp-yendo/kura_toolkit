import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useTranslation } from 'react-i18next';

type Props = {
    label: string;
    value: string;
    onChange(value: string): void;
    // 参照ボタン押下時。null を返すとキャンセル扱い
    onBrowse(): Promise<string | null>;
    // 参照ボタンで選ぶもの (ツールチップと読み上げの名前を「フォルダ選択」「ファイル選択」にする)
    browse: 'folder' | 'file';
    helperText?: string;
    disabled?: boolean;
    size?: 'small' | 'medium';
};

// パス入力欄 + 参照ボタン
export default function PathField({
    label,
    value,
    onChange,
    onBrowse,
    browse,
    helperText,
    disabled,
    size = 'small',
}: Props) {
    const { t } = useTranslation();
    const browseLabel = t(browse === 'folder' ? 'common.selectFolder' : 'common.selectFile');
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
                            <Tooltip title={browseLabel}>
                                <span>
                                    <IconButton
                                        edge='end'
                                        aria-label={browseLabel}
                                        disabled={disabled}
                                        onClick={async () => {
                                            const selected = await onBrowse();
                                            if (selected) onChange(selected);
                                        }}
                                    >
                                        <FolderOpenIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </InputAdornment>
                    ),
                },
            }}
        />
    );
}
