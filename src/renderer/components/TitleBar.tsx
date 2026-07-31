import React from 'react';
import { Box, Typography, IconButton, Button, Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppInfo } from '@shared/types';
import MinimizeIcon from '@mui/icons-material/Minimize';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuIcon from '@mui/icons-material/Menu';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import {
    FEATURE_CATEGORIES,
    FEATURES,
    featuresByCategory,
    titleKeyForRoute,
    type FeatureCategory,
} from '../navigation/features';

type Props = {
    info: AppInfo | undefined;
};

export default function TitleBar({ info }: Props) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const isMac = info?.os === 'darwin';
    const pageTitle = t(titleKeyForRoute(location.pathname));

    // カテゴリドロップダウンの開閉状態
    const [categoryAnchor, setCategoryAnchor] = React.useState<{
        category: FeatureCategory;
        element: HTMLElement;
    } | null>(null);
    // ハンバーガーメニューの開閉状態
    const [mainMenuAnchor, setMainMenuAnchor] = React.useState<HTMLElement | null>(null);

    const closeMenus = () => {
        setCategoryAnchor(null);
        setMainMenuAnchor(null);
    };

    const goTo = (route: string) => {
        closeMenus();
        navigate(route);
    };

    return (
        <Box
            sx={{
                WebkitAppRegion: 'drag',
                display: 'flex',
                alignItems: 'center',
                pl: 2,
                height: 48,
                bgcolor: 'background.paper',
                borderBottom: 1,
                borderColor: 'divider',
                userSelect: 'none',
                flexShrink: 0,
            }}
        >
            <Box sx={{ ml: isMac ? 10 : 0, display: 'flex', alignItems: 'baseline', gap: 1, mr: 2, minWidth: 0 }}>
                <Typography variant='body1' sx={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                    {t('appTitle')}
                </Typography>
                {info?.version && (
                    <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                        v{info.version}
                    </Typography>
                )}
                {/* 現在の画面名。各ページ側には見出しを置かずここに集約する */}
                <Typography variant='body2' sx={{ color: 'text.secondary' }}>
                    /
                </Typography>
                <Typography
                    variant='body1'
                    sx={{
                        fontWeight: 600,
                        fontSize: '0.95rem',
                        color: 'text.primary',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {pageTitle}
                </Typography>
            </Box>

            <Box sx={{ flexGrow: 1 }} />

            {/* ナビゲーション */}
            <Box sx={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag', gap: 0.5 }}>
                <IconButton size='small' onClick={() => navigate('/')} sx={{ color: 'text.primary' }}>
                    <DashboardIcon fontSize='small' />
                </IconButton>
                {FEATURE_CATEGORIES.map(category => (
                    <Button
                        key={category}
                        size='small'
                        color='inherit'
                        endIcon={<ArrowDropDownIcon />}
                        onClick={event => setCategoryAnchor({ category, element: event.currentTarget })}
                        sx={{ textTransform: 'none', whiteSpace: 'nowrap', minWidth: 0 }}
                    >
                        {t(`nav.${category}`)}
                    </Button>
                ))}
                <IconButton size='small' onClick={() => navigate('/settings')} sx={{ color: 'text.primary' }}>
                    <SettingsIcon fontSize='small' />
                </IconButton>
                <IconButton
                    size='small'
                    onClick={event => setMainMenuAnchor(event.currentTarget)}
                    sx={{ color: 'text.primary' }}
                >
                    <MenuIcon fontSize='small' />
                </IconButton>
            </Box>

            {/* カテゴリドロップダウン */}
            <Menu
                anchorEl={categoryAnchor?.element ?? null}
                open={categoryAnchor !== null}
                onClose={closeMenus}
            >
                {(categoryAnchor ? featuresByCategory(categoryAnchor.category) : []).map(feature => {
                    const Icon = feature.icon;
                    return (
                        <MenuItem key={feature.id} onClick={() => goTo(feature.route)}>
                            <ListItemIcon>
                                <Icon fontSize='small' />
                            </ListItemIcon>
                            <ListItemText>{t(feature.titleKey)}</ListItemText>
                        </MenuItem>
                    );
                })}
            </Menu>

            {/* ハンバーガーメニュー */}
            <Menu anchorEl={mainMenuAnchor} open={mainMenuAnchor !== null} onClose={closeMenus}>
                <MenuItem onClick={() => goTo('/')}>
                    <ListItemIcon>
                        <DashboardIcon fontSize='small' />
                    </ListItemIcon>
                    <ListItemText>{t('nav.dashboard')}</ListItemText>
                </MenuItem>
                {FEATURES.map(feature => {
                    const Icon = feature.icon;
                    return (
                        <MenuItem key={feature.id} onClick={() => goTo(feature.route)}>
                            <ListItemIcon>
                                <Icon fontSize='small' />
                            </ListItemIcon>
                            <ListItemText>{t(feature.titleKey)}</ListItemText>
                        </MenuItem>
                    );
                })}
                <Divider />
                <MenuItem onClick={() => goTo('/settings')}>
                    <ListItemIcon>
                        <SettingsIcon fontSize='small' />
                    </ListItemIcon>
                    <ListItemText>{t('nav.settings')}</ListItemText>
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        closeMenus();
                        void window.kuraToolkit.quitApp();
                    }}
                >
                    <ListItemIcon>
                        <PowerSettingsNewIcon fontSize='small' />
                    </ListItemIcon>
                    <ListItemText>{t('nav.quit')}</ListItemText>
                </MenuItem>
            </Menu>

            {/* ウィンドウ制御ボタン - macOSでは非表示 */}
            <Box sx={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag', ml: 1 }}>
                {!isMac && (
                    <>
                        <IconButton
                            size='medium'
                            onClick={() => window.kuraToolkit.minimize()}
                            sx={{
                                borderRadius: 0,
                                width: 48,
                                height: 48,
                                color: 'text.primary',
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <MinimizeIcon />
                        </IconButton>
                        <IconButton
                            size='medium'
                            onClick={async () => {
                                await window.kuraToolkit.maximizeOrRestore();
                            }}
                            sx={{
                                borderRadius: 0,
                                width: 48,
                                height: 48,
                                color: 'text.primary',
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <CropSquareIcon />
                        </IconButton>
                        <IconButton
                            size='medium'
                            onClick={() => window.kuraToolkit.close()}
                            sx={{
                                borderRadius: 0,
                                width: 48,
                                height: 48,
                                color: 'text.primary',
                                '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' },
                            }}
                        >
                            <CloseIcon />
                        </IconButton>
                    </>
                )}
            </Box>
        </Box>
    );
}
