import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, Box, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import './i18n/config';
import TitleBar from './components/TitleBar';
import UpdateNotifier from './components/UpdateNotifier';
import type { AppInfo } from '@shared/types';

function App() {
    const { i18n } = useTranslation();
    const [info, setInfo] = React.useState<AppInfo | undefined>(undefined);

    // アプリ情報を初期化
    React.useEffect(() => {
        window.dfapp.getAppInfo().then(appInfo => {
            setInfo(appInfo);
            i18n.changeLanguage(appInfo.language);
        });
    }, [i18n]);

    const muiTheme = React.useMemo(
        () => createTheme({ palette: { mode: (info?.theme ?? 'light') as 'light' | 'dark' } }),
        [info?.theme]
    );

    return (
        <ThemeProvider theme={muiTheme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                <TitleBar info={info} />
                <Box
                    sx={{
                        flexGrow: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: 'background.default',
                    }}
                >
                    <Typography variant='h2' sx={{ fontWeight: 300, color: 'text.primary' }}>
                        Hello Electron
                    </Typography>
                </Box>
            </Box>
            <UpdateNotifier />
        </ThemeProvider>
    );
}

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
