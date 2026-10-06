import { Tooltip } from '@mui/material';
import ModelTrainingIcon from '@mui/icons-material/ModelTraining';
import { useTranslation } from 'react-i18next';
import type { VoiceModelInfo } from '@shared/voice/types';

const ICON_SIZE = 18;

type Props = {
    voice: VoiceModelInfo;
};

// ユーザーモデル (このアプリで学習して作ったモデル) にだけ付けるアイコン。既存モデルには何も付けない
export default function UserModelIcon({ voice }: Props) {
    const { t } = useTranslation();
    if (voice.origin !== 'user') return null;
    return (
        <Tooltip title={t('voice.models.userModel')}>
            <ModelTrainingIcon
                aria-label={t('voice.models.userModel')}
                color='primary'
                sx={{ fontSize: ICON_SIZE, verticalAlign: 'middle', flexShrink: 0 }}
            />
        </Tooltip>
    );
}
