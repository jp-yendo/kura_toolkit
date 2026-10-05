import type React from 'react';
import { Box, Button, Stack, Tab, Tabs } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import DownloadIcon from '@mui/icons-material/Download';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import SchoolIcon from '@mui/icons-material/School';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { openVoiceLibrary } from '../../stores/voiceLibraryStore';
import type { VoiceFeatureId } from '@shared/voice/types';

type VoiceFeatureKey = 'separation' | 'conversion' | 'tts';

type Section = { route: string; labelKey: string; icon: React.ReactElement };

// 音声変換と読み上げは、作業の画面・声のモデルの管理・モデルの学習を切り替えて使う。
// 変換する音声や読み上げる文章が無くても、声のモデルの管理と学習はいつでも開ける
const SECTIONS: Partial<Record<VoiceFeatureKey, Section[]>> = {
    conversion: [
        { route: '/audio/conversion', labelKey: 'voice.sections.convert', icon: <RecordVoiceOverIcon /> },
        { route: '/audio/conversion/models', labelKey: 'voice.sections.models', icon: <LibraryMusicIcon /> },
        { route: '/audio/conversion/training', labelKey: 'voice.sections.training', icon: <SchoolIcon /> },
    ],
    tts: [
        { route: '/audio/tts', labelKey: 'voice.sections.read', icon: <CampaignIcon /> },
        { route: '/audio/tts/models', labelKey: 'voice.sections.models', icon: <LibraryMusicIcon /> },
        { route: '/audio/tts/training', labelKey: 'voice.sections.training', icon: <SchoolIcon /> },
    ],
};

// ダウンロードを開いたときに表示する機能 (学習の画面では学習の機能)
const LIBRARY_FEATURES: Record<VoiceFeatureKey, { feature: VoiceFeatureId; training?: VoiceFeatureId }> = {
    separation: { feature: 'separation' },
    conversion: { feature: 'conversion', training: 'conversionTraining' },
    tts: { feature: 'tts', training: 'ttsTraining' },
};

type Props = {
    feature: VoiceFeatureKey;
};

// 音声機能の画面の上端。画面の切り替え (変換・読み上げ) と、ダウンロードの呼び出しを置く
export default function VoiceFeatureHeader({ feature }: Props) {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const sections = SECTIONS[feature];
    const current = sections?.find(section => section.route === location.pathname)?.route ?? false;
    const libraryFeature =
        (current && current.endsWith('/training') ? LIBRARY_FEATURES[feature].training : undefined) ??
        LIBRARY_FEATURES[feature].feature;

    return (
        <Stack
            direction='row'
            spacing={1}
            sx={{
                alignItems: 'center',
                minHeight: 44,
                borderBottom: sections ? 1 : 0,
                borderColor: 'divider',
            }}
        >
            {sections ? (
                <Tabs
                    value={current}
                    onChange={(_event, route: string) => navigate(route)}
                    variant='scrollable'
                    sx={{
                        flexGrow: 1,
                        minHeight: 44,
                        '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontWeight: 600 },
                    }}
                >
                    {sections.map(section => (
                        <Tab
                            key={section.route}
                            value={section.route}
                            label={t(section.labelKey)}
                            icon={section.icon}
                            iconPosition='start'
                        />
                    ))}
                </Tabs>
            ) : (
                <Box sx={{ flexGrow: 1 }} />
            )}
            <Button
                size='small'
                startIcon={<DownloadIcon />}
                onClick={() => openVoiceLibrary({ focus: libraryFeature })}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
                {t('voice.library.open')}
            </Button>
        </Stack>
    );
}
