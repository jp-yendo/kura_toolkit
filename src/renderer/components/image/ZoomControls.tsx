import { Button, IconButton, Stack, Tooltip } from '@mui/material';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { useTranslation } from 'react-i18next';
import { clampScale, MAX_SCALE, MIN_SCALE } from '../common/ZoomableImage';

// ボタン 1 回あたりの拡大縮小の倍率
const ZOOM_STEP = 1.25;

type Props = {
    // 実際に表示している倍率
    scale: number;
    disabled?: boolean;
    // 新しい倍率 (null = 全体表示)
    onChange(scale: number | null): void;
};

// ズームの操作 (縮小・現在の倍率 (押すと実寸)・拡大・全体表示)。倍率が下限・上限に達したら縮小・拡大を無効にする。
// Tooltip は無効時も出すため span で包む
export default function ZoomControls({ scale, disabled, onChange }: Props) {
    const { t } = useTranslation();
    return (
        <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
            <Tooltip title={t('svgPage.zoomOut')}>
                <span>
                    <IconButton
                        size='small'
                        sx={{ p: 0.25 }}
                        disabled={disabled || scale <= MIN_SCALE}
                        onClick={() => onChange(clampScale(scale / ZOOM_STEP))}
                    >
                        <ZoomOutIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('svgPage.actualSize')}>
                <span>
                    <Button
                        size='small'
                        color='inherit'
                        disabled={disabled}
                        onClick={() => onChange(1)}
                        sx={{ minWidth: 52, py: 0 }}
                    >
                        {Math.round(scale * 100)}%
                    </Button>
                </span>
            </Tooltip>
            <Tooltip title={t('svgPage.zoomIn')}>
                <span>
                    <IconButton
                        size='small'
                        sx={{ p: 0.25 }}
                        disabled={disabled || scale >= MAX_SCALE}
                        onClick={() => onChange(clampScale(scale * ZOOM_STEP))}
                    >
                        <ZoomInIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('svgPage.fitToWindow')}>
                <span>
                    <IconButton size='small' sx={{ p: 0.25 }} disabled={disabled} onClick={() => onChange(null)}>
                        <FitScreenIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
        </Stack>
    );
}
