import React from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';
import PageContainer from '../components/common/PageContainer';
import SectionLabel from '../components/common/SectionLabel';
import Panel from '../components/common/Panel';
import PathField from '../components/common/PathField';
import StorageSection from '../components/settings/StorageSection';
import {
    DEFAULT_MICROPHONE,
    inputGainDbOf,
    resolveMicrophone,
    useMicrophones,
    useMicrophoneTest,
} from '../components/voice/microphones';
import LevelMeter from '../components/voice/LevelMeter';
import SliderField from '../components/voice/SliderField';
import { voiceErrorMessage } from '../components/voice/voiceErrors';
import { showNotice } from '../stores/noticeStore';
import { MIC_INPUT_GAIN_DB } from '@shared/types';
import { SEARCH_THREADS_MIN } from '@shared/search';
import type { AppLanguage, AppTheme, FfmpegDetectResult } from '@shared/types';

// マイクの欄での「OS の既定のマイク」の値。設定の値 (空文字) のままでは、選択欄が何も選んでいない表示になるため、
// 欄の中だけ別の値で表す (マイクの deviceId は長いハッシュのため、この値と重ならない)
const MICROPHONE_SELECT_DEFAULT = 'os-default';

export default function SettingsPage() {
    const { t } = useTranslation();
    const { settings, update } = useSettingsStore();
    const [detected, setDetected] = React.useState<FfmpegDetectResult | null>(null);
    const microphones = useMicrophones();
    // 入力ゲイン。動かしている間は画面の中だけで持ち、止まってから保存する (動かすたびに設定ファイルを書かないため)
    const savedGainDb = inputGainDbOf(settings?.voice.inputGainDb);
    const [gainDb, setGainDb] = React.useState(savedGainDb);
    React.useEffect(() => setGainDb(savedGainDb), [savedGainDb]);
    React.useEffect(() => {
        if (gainDb === savedGainDb) return;
        const timer = window.setTimeout(() => void update({ voice: { inputGainDb: gainDb } }), 500);
        return () => window.clearTimeout(timer);
    }, [gainDb, savedGainDb, update]);
    const [micTesting, setMicTesting] = React.useState(false);
    const micTest = useMicrophoneTest(micTesting, settings?.voice.microphoneId ?? DEFAULT_MICROPHONE, gainDb);
    React.useEffect(() => {
        if (!micTest.error) return;
        setMicTesting(false);
        showNotice(
            'error',
            micTest.error instanceof Error && micTest.error.message === 'MICROPHONE_DENIED'
                ? t('voice.recorder.denied')
                : voiceErrorMessage(t, micTest.error),
            10000
        );
    }, [micTest.error, t]);
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
                            browse='file'
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
                            browse='file'
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

            <Box>
                <SectionLabel>{t('settingsPage.recordingSection')}</SectionLabel>
                <Panel>
                    <Stack spacing={2}>
                        {/* つながっていないマイクが設定されている場合は、OS の既定のマイクとして示す (録音と同じ読み替え) */}
                        <FormControl size='small' fullWidth disabled={microphones === null}>
                            <InputLabel id='microphone-label'>{t('settingsPage.microphone')}</InputLabel>
                            <Select
                                labelId='microphone-label'
                                label={t('settingsPage.microphone')}
                                value={
                                    resolveMicrophone(settings.voice.microphoneId, microphones ?? []) ||
                                    MICROPHONE_SELECT_DEFAULT
                                }
                                onChange={event => {
                                    const value = String(event.target.value);
                                    void update({
                                        voice: {
                                            microphoneId:
                                                value === MICROPHONE_SELECT_DEFAULT ? DEFAULT_MICROPHONE : value,
                                        },
                                    });
                                }}
                            >
                                <MenuItem value={MICROPHONE_SELECT_DEFAULT}>
                                    {t('settingsPage.microphoneDefault')}
                                </MenuItem>
                                {(microphones ?? []).map((item, index) => (
                                    <MenuItem key={item.deviceId} value={item.deviceId} sx={{ whiteSpace: 'normal' }}>
                                        {item.label || t('settingsPage.microphoneUnnamed', { index: index + 1 })}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <SliderField
                            label={t('settingsPage.inputGain')}
                            value={gainDb}
                            min={MIC_INPUT_GAIN_DB.min}
                            max={MIC_INPUT_GAIN_DB.max}
                            step={1}
                            defaultValue={MIC_INPUT_GAIN_DB.default}
                            format={value => `${value > 0 ? '+' : ''}${value} dB`}
                            onChange={setGainDb}
                        />
                        {/* マイクテスト: 押している間、設定のマイクの入力レベル (入力ゲインをかけた後) を示す。録音はしない */}
                        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                            <Button
                                variant={micTesting ? 'contained' : 'outlined'}
                                startIcon={micTesting ? <StopIcon /> : <MicIcon />}
                                onClick={() => setMicTesting(value => !value)}
                            >
                                {micTesting ? t('settingsPage.micTestStop') : t('settingsPage.micTest')}
                            </Button>
                            {micTesting && (
                                <LevelMeter
                                    level={micTest.level}
                                    showValue
                                    clippingLabel={t('voice.recorder.clipping')}
                                />
                            )}
                        </Stack>
                    </Stack>
                </Panel>
            </Box>

            <StorageSection />
        </PageContainer>
    );
}
