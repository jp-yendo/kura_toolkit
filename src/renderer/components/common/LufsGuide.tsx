import { Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

// LUFS の値の目安 (LUFS の値を入れる欄に共通して添える)。値の大小と音量の関係が直感に反するため、代表的な値を示す
export default function LufsGuide() {
    const { t } = useTranslation();
    return (
        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
            {t('common.lufsGuide')}
        </Typography>
    );
}
