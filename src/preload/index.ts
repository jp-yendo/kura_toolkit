import { contextBridge, ipcRenderer } from 'electron';
import type { IpcApi } from '../shared/ipc';
import type { UpdateState } from '../shared/types';

// IPCチャンネル定義（ランタイムでsharedからインポートを避けるためローカルコピー）
const IPC_CHANNELS = {
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

contextBridge.exposeInMainWorld('dfapp', api);

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
