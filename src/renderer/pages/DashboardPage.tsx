import { Avatar, Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../components/common/PageContainer';
import SectionLabel from '../components/common/SectionLabel';
import { FEATURE_CATEGORIES, featuresByCategory } from '../navigation/features';

export default function DashboardPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    return (
        <PageContainer sx={{ maxWidth: 1400, mx: 'auto', width: '100%' }}>
            {/* カテゴリごとのセクションを横並びにし、幅が足りなければ折り返す */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                    gap: 2,
                    alignItems: 'start',
                }}
            >
                {FEATURE_CATEGORIES.map(category => (
                    <Box key={category}>
                        <SectionLabel>{t(`nav.${category}`)}</SectionLabel>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {featuresByCategory(category).map(feature => {
                                const Icon = feature.icon;
                                return (
                                    <ButtonBase
                                        key={feature.id}
                                        onClick={() => navigate(feature.route)}
                                        sx={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'stretch',
                                            gap: 1,
                                            p: 1.5,
                                            borderRadius: 2,
                                            border: 1,
                                            borderColor: 'divider',
                                            bgcolor: 'background.paper',
                                            textAlign: 'left',
                                            height: '100%',
                                            transition: 'background-color 0.15s, border-color 0.15s',
                                            '&:hover': { bgcolor: 'action.hover', borderColor: 'text.disabled' },
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                                            <Avatar
                                                variant='rounded'
                                                sx={{ bgcolor: feature.color, width: 32, height: 32 }}
                                            >
                                                <Icon sx={{ fontSize: 20 }} />
                                            </Avatar>
                                            <Typography
                                                sx={{
                                                    fontWeight: 600,
                                                    fontSize: '0.95rem',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {t(feature.titleKey)}
                                            </Typography>
                                        </Box>
                                        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                            {t(feature.descKey)}
                                        </Typography>
                                    </ButtonBase>
                                );
                            })}
                        </Box>
                    </Box>
                ))}
            </Box>
        </PageContainer>
    );
}
