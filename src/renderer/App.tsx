import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Box, CssBaseline, useMediaQuery } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import TitleBar from './components/TitleBar';
import UpdateNotifier from './components/UpdateNotifier';
import NoticeSnackbar from './components/common/NoticeSnackbar';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AudioNormalizerPage from './pages/audio/AudioNormalizerPage';
import ChapterCutPage from './pages/video/ChapterCutPage';
import SvgConverterPage from './pages/image/SvgConverterPage';
import CleanupPage from './pages/tools/CleanupPage';
import { useSettingsStore } from './stores/settingsStore';

export default function App() {
    const { t, i18n } = useTranslation();
    const { settings, appInfo, initialized, saveError, init, clearSaveError } = useSettingsStore();
    const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

    React.useEffect(() => {
        void init();
    }, [init]);

    // 言語設定を i18next に反映
    React.useEffect(() => {
        if (settings?.app.language && i18n.language !== settings.app.language) {
            void i18n.changeLanguage(settings.app.language);
        }
    }, [settings?.app.language, i18n]);

    const themeSetting = settings?.app.theme ?? 'system';
    const mode = themeSetting === 'system' ? (prefersDark ? 'dark' : 'light') : themeSetting;

    const muiTheme = React.useMemo(
        () =>
            createTheme({
                palette: {
                    mode,
                    ...(mode === 'dark'
                        ? {
                              background: { default: '#0a0a0a', paper: '#141414' },
                          }
                        : {}),
                },
            }),
        [mode]
    );

    if (!initialized) {
        // 設定読込前は描画しない (テーマ/言語のちらつき防止)
        return null;
    }

    return (
        <ThemeProvider theme={muiTheme}>
            <CssBaseline />
            <HashRouter>
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                    <TitleBar info={appInfo ?? undefined} />
                    <Box sx={{ flexGrow: 1, overflow: 'auto', bgcolor: 'background.default' }}>
                        <Routes>
                            <Route path='/' element={<DashboardPage />} />
                            <Route path='/audio/normalizer' element={<AudioNormalizerPage />} />
                            <Route path='/video/chapter-cut' element={<ChapterCutPage />} />
                            <Route path='/image/svg-converter' element={<SvgConverterPage />} />
                            <Route path='/tools/cleanup' element={<CleanupPage />} />
                            <Route path='/settings' element={<SettingsPage />} />
                        </Routes>
                    </Box>
                </Box>
            </HashRouter>
            <UpdateNotifier />
            {/* 設定ファイルへの保存に失敗した場合の通知 (起動中の設定は反映されている) */}
            <NoticeSnackbar
                message={saveError === null ? null : t('settingsPage.saveFailed', { error: saveError })}
                severity='error'
                autoHideDuration={10000}
                onClose={clearSaveError}
            />
        </ThemeProvider>
    );
}
