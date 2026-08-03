import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcApi } from '../shared/ipc';
import type { JobEvent, UpdateState } from '../shared/types';

// IPCチャンネル定義（ランタイムでsharedからインポートを避けるためローカルコピー）
const IPC_CHANNELS = {
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

const api: IpcApi = {
    async getAppInfo() {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO);
    },
    async setTheme(theme) {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_SET_THEME, theme);
    },
    async setLanguage(language) {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_SET_LANGUAGE, language);
    },
    async quitApp() {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_QUIT);
    },
    getPathForFile(file) {
        return webUtils.getPathForFile(file);
    },
    async minimize() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
    },
    async maximizeOrRestore() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE_OR_RESTORE);
    },
    async isMaximized() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED);
    },
    async close() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE);
    },
    settings: {
        async get() {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET);
        },
        async update(patch) {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, patch);
        },
    },
    ffmpeg: {
        async detect() {
            return ipcRenderer.invoke(IPC_CHANNELS.FFMPEG_DETECT);
        },
    },
    dialog: {
        async openFiles(options) {
            return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILES, options);
        },
        async openDirectory(options) {
            return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, options);
        },
        async saveFile(options) {
            return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options);
        },
    },
    files: {
        async collect(paths, extensions) {
            return ipcRenderer.invoke(IPC_CHANNELS.FILES_COLLECT, paths, extensions);
        },
    },
    jobs: {
        async cancel(jobId) {
            return ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, jobId);
        },
        onEvent(listener: (event: JobEvent) => void) {
            const handler = (_event: Electron.IpcRendererEvent, jobEvent: JobEvent) => listener(jobEvent);
            ipcRenderer.on(IPC_CHANNELS.JOB_EVENT, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.JOB_EVENT, handler);
            };
        },
    },
    audio: {
        async analyze(jobId, files) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_ANALYZE, jobId, files);
        },
        async normalize(jobId, files, options) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_NORMALIZE, jobId, files, options);
        },
        async checkOutputs(files, outputDir) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_CHECK_OUTPUTS, files, outputDir);
        },
    },
    chapter: {
        async probe(input) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_PROBE, input);
        },
        async cut(jobId, request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_CUT, jobId, request);
        },
        async split(jobId, request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_SPLIT, jobId, request);
        },
        async checkCut(request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_CHECK_CUT, request);
        },
        async checkSplit(request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_CHECK_SPLIT, request);
        },
    },
    vectorizer: {
        async loadImage(path) {
            return ipcRenderer.invoke(IPC_CHANNELS.VECTORIZER_LOAD_IMAGE, path);
        },
        async convert(path, params) {
            return ipcRenderer.invoke(IPC_CHANNELS.VECTORIZER_CONVERT, path, params);
        },
        async saveSvg(path, svg) {
            return ipcRenderer.invoke(IPC_CHANNELS.VECTORIZER_SAVE_SVG, path, svg);
        },
    },
    cleanup: {
        async getCapabilities() {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_GET_CAPABILITIES);
        },
        async openPermissionSettings() {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_OPEN_PERMISSION_SETTINGS);
        },
        async getRoots() {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_GET_ROOTS);
        },
        async scan(jobId, options) {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_SCAN, jobId, options);
        },
        async remove(jobId, items) {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_REMOVE, jobId, items);
        },
    },
    updater: {
        async getState() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_STATE);
        },
        async check() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK);
        },
        async download() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD);
        },
        async quitAndInstall() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL);
        },
        onStateChanged(listener: (state: UpdateState) => void) {
            const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
            ipcRenderer.on(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
            };
        },
    },
};

contextBridge.exposeInMainWorld('kuraToolkit', api);

// メインプロセスのコンソールメッセージを受信してDevToolsに転送
ipcRenderer.on(
    IPC_CHANNELS.MAIN_CONSOLE,
    (
        _event,
        data: {
            level: string;
            args: Array<{ type: string; value?: string; message?: string; stack?: string; name?: string }>;
        }
    ) => {
        const { level, args } = data;
        // DevTools出力用に引数をデシリアライズ
        const deserializedArgs = args.map(arg => {
            if (arg.type === 'error') {
                const error = new Error(arg.message || 'Unknown error');
                if (arg.stack) error.stack = arg.stack;
                if (arg.name) error.name = arg.name;
                return error;
            } else if (arg.type === 'object') {
                try {
                    return JSON.parse(arg.value || '{}');
                } catch {
                    return arg.value;
                }
            } else {
                return arg.value;
            }
        });

        // レンダラーコンソールに転送（DevToolsに表示される）
        switch (level) {
            case 'log':
                console.log('[Main]', ...deserializedArgs);
                break;
            case 'error':
                console.error('[Main]', ...deserializedArgs);
                break;
            case 'warn':
                console.warn('[Main]', ...deserializedArgs);
                break;
            case 'info':
                console.info('[Main]', ...deserializedArgs);
                break;
            case 'debug':
                console.debug('[Main]', ...deserializedArgs);
                break;
            default:
                console.log('[Main]', ...deserializedArgs);
        }
    }
);
