import React from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';
import PageContainer from '../components/common/PageContainer';
import SectionLabel from '../components/common/SectionLabel';
import Panel from '../components/common/Panel';
import PathField from '../components/common/PathField';
import StorageSection from '../components/settings/StorageSection';
import { SEARCH_THREADS_MIN } from '@shared/search';
import type { AppLanguage, AppTheme, FfmpegDetectResult } from '@shared/types';

export default function SettingsPage() {
    const { t } = useTranslation();
    const { settings, update } = useSettingsStore();
    const [detected, setDetected] = React.useState<FfmpegDetectResult | null>(null);
    // 入力途中は文字列のまま保持し、確定時に範囲へ収めて保存する
    const savedThreads = settings?.search.threads;
    const [searchThreads, setSearchThreads] = React.useState('');
    React.useEffect(() => {
        if (savedThreads !== undefined) setSearchThreads(String(savedThreads));
    }, [savedThreads]);

    const commitSearchThreads = React.useCallback(() => {
        const parsed = Number.parseInt(searchThreads, 10);
        const threads = Number.isFinite(parsed)
            ? Math.max(SEARCH_THREADS_MIN, parsed)
            : (savedThreads ?? SEARCH_THREADS_MIN);
        setSearchThreads(String(threads));
        if (threads !== savedThreads) void update({ search: { threads } });
    }, [searchThreads, savedThreads, update]);

    // 現在の設定での検出結果を表示する
    React.useEffect(() => {
        let cancelled = false;
        window.kuraToolkit.ffmpeg.detect().then(result => {
            if (!cancelled) setDetected(result);
        });
        return () => {
            cancelled = true;
        };
    }, [settings?.ffmpeg.ffmpegPath, settings?.ffmpeg.ffprobePath]);

    if (!settings) return null;

    const executableFilters = [{ name: t('common.fileTypes.executable'), extensions: ['exe', '*'] }];

    return (
        <PageContainer sx={{ maxWidth: 760, mx: 'auto', width: '100%' }}>
            <Box>
                <SectionLabel>{t('settingsPage.appearance')}</SectionLabel>
                <Panel>
                    <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                        <FormControl size='small' sx={{ minWidth: 220 }}>
                            <InputLabel id='theme-label'>{t('settingsPage.theme')}</InputLabel>
                            <Select
                                labelId='theme-label'
                                label={t('settingsPage.theme')}
                                value={settings.app.theme}
                                onChange={event => {
                                    void update({ app: { theme: event.target.value as AppTheme } });
                                }}
                            >
                                <MenuItem value='system'>{t('settingsPage.themeSystem')}</MenuItem>
                                <MenuItem value='light'>{t('settingsPage.themeLight')}</MenuItem>
                                <MenuItem value='dark'>{t('settingsPage.themeDark')}</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl size='small' sx={{ minWidth: 220 }}>
                            <InputLabel id='language-label'>{t('settingsPage.language')}</InputLabel>
                            <Select
                                labelId='language-label'
                                label={t('settingsPage.language')}
                                value={settings.app.language}
                                onChange={event => {
                                    void update({ app: { language: event.target.value as AppLanguage } });
                                }}
                            >
                                <MenuItem value='ja'>日本語</MenuItem>
                                <MenuItem value='en'>English</MenuItem>
                            </Select>
                        </FormControl>
                    </Stack>
                </Panel>
            </Box>

            <Box>
                <SectionLabel>{t('settingsPage.searchSection')}</SectionLabel>
                <Panel>
                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2, lineHeight: 1.6 }}>
                        {t('settingsPage.searchThreadsHint')}
                    </Typography>
                    <TextField
                        size='small'
                        type='number'
                        label={t('settingsPage.searchThreads')}
                        sx={{ width: 220 }}
                        slotProps={{ htmlInput: { min: SEARCH_THREADS_MIN, step: 1 } }}
                        value={searchThreads}
                        onChange={event => setSearchThreads(event.target.value)}
                        onBlur={() => commitSearchThreads()}
                    />
                </Panel>
            </Box>

            <Box>
                <SectionLabel>{t('settingsPage.ffmpegSection')}</SectionLabel>
                <Panel>
                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2, lineHeight: 1.6 }}>
                        {t('settingsPage.autoDetectHint')}
                    </Typography>
                    <Stack spacing={2}>
                        <PathField
                            label={t('settingsPage.ffmpegPath')}
                            value={settings.ffmpeg.ffmpegPath}
                            helperText={
                                settings.ffmpeg.ffmpegPath
                                    ? undefined
                                    : detected?.ffmpegPath
                                      ? t('settingsPage.detectedPath', { path: detected.ffmpegPath })
                                      : t('settingsPage.notDetected')
                            }
                            onChange={value => {
                                void update({ ffmpeg: { ffmpegPath: value } });
                            }}
                            onBrowse={async () => {
                                const paths = await window.kuraToolkit.dialog.openFiles({ filters: executableFilters });
                                return paths[0] ?? null;
                            }}
                        />
                        <PathField
                            label={t('settingsPage.ffprobePath')}
                            value={settings.ffmpeg.ffprobePath}
                            helperText={
                                settings.ffmpeg.ffprobePath
                                    ? undefined
                                    : detected?.ffprobePath
                                      ? t('settingsPage.detectedPath', { path: detected.ffprobePath })
                                      : t('settingsPage.notDetected')
                            }
                            onChange={value => {
                                void update({ ffmpeg: { ffprobePath: value } });
                            }}
                            onBrowse={async () => {
                                const paths = await window.kuraToolkit.dialog.openFiles({ filters: executableFilters });
                                return paths[0] ?? null;
                            }}
                        />
                    </Stack>
                </Panel>
            </Box>

            <StorageSection />
        </PageContainer>
    );
}
