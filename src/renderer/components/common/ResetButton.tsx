import { IconButton, Tooltip } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useTranslation } from 'react-i18next';

type Props = {
    onClick(): void;
    // すでに初期値のとき・操作できないときは押せない状態にする
    disabled?: boolean;
    // ツールチップと読み上げの名前 (省略時は「初期値に戻す」)
    title?: string;
};

// 初期値に戻すボタン (アイコンだけ。何をするかはツールチップと読み上げの名前で示す)
export default function ResetButton({ onClick, disabled, title }: Props) {
    const { t } = useTranslation();
    const label = title ?? t('common.resetToDefault');
    return (
        <Tooltip title={label}>
            <span>
                <IconButton size='small' aria-label={label} disabled={disabled} onClick={onClick} sx={{ p: 0.25 }}>
                    <RestartAltIcon sx={{ fontSize: 18 }} />
                </IconButton>
            </span>
        </Tooltip>
    );
}
