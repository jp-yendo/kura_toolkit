import os from 'os';
import path from 'path';

// アプリケーションのディレクトリ名
export const APP_DIR_NAME = '.dfapp';

// ホームディレクトリを取得
export function getHomeDir(): string {
    return os.homedir();
}

// アプリルートディレクトリを取得
export function getAppRootDir(): string {
    return path.join(getHomeDir(), APP_DIR_NAME);
}

// IPCチャンネル定義
export const IPC_CHANNELS = {
    APP_GET_INFO: 'app:getInfo',
    APP_SET_THEME: 'app:setTheme',
    APP_SET_LANGUAGE: 'app:setLanguage',
    WINDOW_MINIMIZE: 'window:minimize',
    WINDOW_MAXIMIZE_OR_RESTORE: 'window:maximizeOrRestore',
    WINDOW_CLOSE: 'window:close',
    WINDOW_IS_MAXIMIZED: 'window:isMaximized',
    MAIN_CONSOLE: 'main:console',
    UPDATER_CHECK: 'updater:check',
    UPDATER_DOWNLOAD: 'updater:download',
    UPDATER_QUIT_AND_INSTALL: 'updater:quitAndInstall',
    UPDATER_GET_STATE: 'updater:getState',
    UPDATER_STATE_CHANGED: 'updater:stateChanged',
} as const;
