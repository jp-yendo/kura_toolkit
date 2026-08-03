import os from 'os';
import path from 'path';

// アプリケーションのディレクトリ名
export const APP_DIR_NAME = '.kura_toolkit';

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
    APP_QUIT: 'app:quit',
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
    SETTINGS_GET: 'settings:get',
    SETTINGS_UPDATE: 'settings:update',
    FFMPEG_DETECT: 'ffmpeg:detect',
    DIALOG_OPEN_FILES: 'dialog:openFiles',
    DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
    DIALOG_SAVE_FILE: 'dialog:saveFile',
    FILES_COLLECT: 'files:collect',
    JOB_CANCEL: 'job:cancel',
    JOB_EVENT: 'job:event',
    AUDIO_ANALYZE: 'audio:analyze',
    AUDIO_NORMALIZE: 'audio:normalize',
    AUDIO_CHECK_OUTPUTS: 'audio:checkOutputs',
    CHAPTER_PROBE: 'chapter:probe',
    CHAPTER_CUT: 'chapter:cut',
    CHAPTER_SPLIT: 'chapter:split',
    CHAPTER_CHECK_CUT: 'chapter:checkCut',
    CHAPTER_CHECK_SPLIT: 'chapter:checkSplit',
    VECTORIZER_LOAD_IMAGE: 'vectorizer:loadImage',
    VECTORIZER_CONVERT: 'vectorizer:convert',
    VECTORIZER_SAVE_SVG: 'vectorizer:saveSvg',
    CLEANUP_GET_ROOTS: 'cleanup:getRoots',
    CLEANUP_GET_CAPABILITIES: 'cleanup:getCapabilities',
    CLEANUP_OPEN_PERMISSION_SETTINGS: 'cleanup:openPermissionSettings',
    CLEANUP_SCAN: 'cleanup:scan',
    CLEANUP_REMOVE: 'cleanup:remove',
} as const;
