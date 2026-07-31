// import { ipcMain } from 'electron';
import { registerUpdaterIpcHandlers } from './updater';

/**
 * IPCハンドラを登録
 * アプリケーション固有のIPC通信はここに追加
 */
export function registerIpcHandlers() {
    // 自動アップデート関連の IPC ハンドラ
    registerUpdaterIpcHandlers();

    // 例: カスタムIPCハンドラ
    // ipcMain.handle('custom:action', async (_e, arg) => {
    //     return someService.doSomething(arg);
    // });
}
