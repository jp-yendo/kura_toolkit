import { ipcMain, nativeTheme } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getSettings, updateSettings } from '../services/settings';
import { detectTools } from '../services/ffmpeg/ffmpeg';
import type { AppSettings, DeepPartial } from '../../shared/types';

export function registerSettingsIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
        return getSettings();
    });

    ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_e, patch: DeepPartial<AppSettings>) => {
        const result = updateSettings(patch);
        // テーマ変更は即時に nativeTheme へ反映
        nativeTheme.themeSource = result.settings.app.theme;
        return result;
    });

    ipcMain.handle(IPC_CHANNELS.FFMPEG_DETECT, () => {
        return detectTools();
    });
}
