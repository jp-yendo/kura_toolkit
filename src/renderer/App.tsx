import React from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Box, CssBaseline, useMediaQuery } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from './theme';
import { useTranslation } from 'react-i18next';
import TitleBar from './components/TitleBar';
import NotificationArea from './components/common/NotificationArea';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AudioNormalizerPage from './pages/audio/AudioNormalizerPage';
import ChapterCutPage from './pages/video/ChapterCutPage';
import SvgConverterPage from './pages/image/SvgConverterPage';
import SvgAutoPage from './pages/image/SvgAutoPage';
import CleanupPage from './pages/tools/CleanupPage';
import SeparationPage from './pages/voice/SeparationPage';
import ConversionPage from './pages/voice/ConversionPage';
import TtsPage from './pages/voice/TtsPage';
import VoiceModelsPage from './pages/voice/VoiceModelsPage';
import RvcTrainingPage from './pages/voice/RvcTrainingPage';
import TtsTrainingPage from './pages/voice/TtsTrainingPage';
import VoiceUpdatePrompt from './components/voice/VoiceUpdatePrompt';
import VoiceLibraryDialog from './components/voice/VoiceLibraryDialog';
import SettingsLoadErrorDialog from './components/settings/SettingsLoadErrorDialog';
import UnsavedChangesDialog from './components/common/UnsavedChangesDialog';
import { useSettingsStore } from './stores/settingsStore';
import { showNotice } from './stores/noticeStore';
import { featureOf, leaveFeature } from './stores/featureWork';
import { handleCloseRequest } from './stores/navigationGuard';

// 別の機能へ移ったときに前の機能の作業を破棄し、機能に入ったときに要らなくなった一時ファイルを消す。
// 開いた機能を main へ知らせ、その機能で使わない Python の処理役を止めさせる
function FeatureWorkLifecycle() {
    const { pathname } = useLocation();
    const current = React.useRef<string | null>(null);
    React.useEffect(() => {
        const next = featureOf(pathname);
        if (current.current === next) return;
        if (current.current !== null) leaveFeature(current.current);
        current.current = next;
        void window.kuraToolkit.voice.setFeature(next);
        void window.kuraToolkit.storage.cleanupWork();
    }, [pathname]);
    return null;
}

export default function App() {
    const { t, i18n } = useTranslation();
    const { settings, appInfo, initialized, loadError, saveError, init, clearSaveError } = useSettingsStore();
    const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

    React.useEffect(() => {
        void init();
    }, [init]);

    // アプリを閉じる前の問い合わせに答える (保存していない入力があれば確認してから閉じる)
    React.useEffect(() => window.kuraToolkit.onCloseRequested(handleCloseRequest), []);

    // 設定の保存に失敗したら通知する (起動中の設定は反映されている)
    React.useEffect(() => {
        if (saveError === null) return;
        showNotice('error', t('settingsPage.saveFailed', { error: saveError }), 10000);
        clearSaveError();
    }, [saveError, clearSaveError, t]);

    // 言語設定を i18next に反映
    React.useEffect(() => {
        if (settings?.app.language && i18n.language !== settings.app.language) {
            void i18n.changeLanguage(settings.app.language);
        }
    }, [settings?.app.language, i18n]);

    const themeSetting = settings?.app.theme ?? 'system';
    const mode = themeSetting === 'system' ? (prefersDark ? 'dark' : 'light') : themeSetting;

    const muiTheme = React.useMemo(() => createAppTheme(mode), [mode]);

    if (!initialized) {
        // 設定読込前は描画しない (テーマ/言語のちらつき防止)
        return null;
    }

    if (loadError) {
        // 設定ファイルを読み込めなかった場合は、続け方を選ぶまでほかの画面を出さない
        // (既定の設定のまま各機能が動き出さないようにするため)
        return (
            <ThemeProvider theme={muiTheme}>
                <CssBaseline enableColorScheme />
                {/* タイトルバーは画面の切り替え (ルーター) を使うため、ルーターの中に置く */}
                <HashRouter>
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                        <TitleBar info={appInfo ?? undefined} />
                        <Box sx={{ flexGrow: 1, bgcolor: 'background.default' }} />
                    </Box>
                </HashRouter>
                <SettingsLoadErrorDialog error={loadError} />
            </ThemeProvider>
        );
    }

    return (
        <ThemeProvider theme={muiTheme}>
            {/* color-scheme をテーマに合わせ、ダークでも入力欄や一覧のスクロールバーを暗い配色にする */}
            <CssBaseline enableColorScheme />
            <HashRouter>
                <FeatureWorkLifecycle />
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                    <TitleBar info={appInfo ?? undefined} />
                    <Box sx={{ flexGrow: 1, overflow: 'auto', bgcolor: 'background.default' }}>
                        <Routes>
                            <Route path='/' element={<DashboardPage />} />
                            <Route path='/audio/normalizer' element={<AudioNormalizerPage />} />
                            <Route path='/video/chapter-cut' element={<ChapterCutPage />} />
                            <Route path='/image/svg-converter' element={<SvgConverterPage />} />
                            <Route path='/image/svg-auto' element={<SvgAutoPage />} />
                            <Route path='/tools/cleanup' element={<CleanupPage />} />
                            <Route path='/audio/separation' element={<SeparationPage />} />
                            <Route path='/audio/conversion' element={<ConversionPage />} />
                            <Route
                                path='/audio/conversion/models'
                                element={<VoiceModelsPage key='converter' feature='converter' />}
                            />
                            <Route path='/audio/conversion/training' element={<RvcTrainingPage />} />
                            <Route path='/audio/tts' element={<TtsPage />} />
                            <Route path='/audio/tts/models' element={<VoiceModelsPage key='tts' feature='tts' />} />
                            <Route path='/audio/tts/training' element={<TtsTrainingPage />} />
                            <Route path='/settings' element={<SettingsPage />} />
                        </Routes>
                    </Box>
                </Box>
                {/* 音声機能のダウンロード物の更新が必要な場合、アプリの更新後の初回起動時に確認する */}
                <VoiceUpdatePrompt />
                {/* 音声機能のダウンロード。必要な箇所から呼び出すダイアログ */}
                <VoiceLibraryDialog />
                {/* 保存していない入力がある機能から、別の機能へ移る前の確認 */}
                <UnsavedChangesDialog />
            </HashRouter>
            {/* アップデート通知と画面内の一時通知をまとめて右下に表示する */}
            <NotificationArea />
        </ThemeProvider>
    );
}
