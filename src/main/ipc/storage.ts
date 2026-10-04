import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { hasActiveJobs } from '../services/job-manager';
import { getStorageInfo } from '../services/storage';
import { changeWorkDir, checkWorkDirChange, checkWorkDirIdle } from '../services/work-dir';
import { checkStorageMove, moveStorage } from '../services/voice/library';
import { stopAllWorkersAndWait } from '../services/voice/python-worker';

// 保存場所 (ライブラリ・モデル・作業ディレクトリ) の IPC。保存場所はアプリ全体で共有する。
// ライブラリ・モデルディレクトリの移動は、中身 (仮想環境に記録された Python 本体の場所など) を扱う
// ライブラリ管理に任せる (現在のライブラリとモデルは音声機能のもの)
export function registerStorageIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.STORAGE_GET_INFO, () => getStorageInfo());
    ipcMain.handle(IPC_CHANNELS.STORAGE_CHECK_MOVE, (_e, kind: unknown, targetDir: string | null) => {
        if (kind !== 'library' && kind !== 'model') throw new Error(`invalid storage kind: ${String(kind)}`);
        checkStorageMove(kind, targetDir);
    });
    ipcMain.handle(IPC_CHANNELS.STORAGE_MOVE, (_e, jobId: string, kind: unknown, targetDir: string | null) => {
        if (kind !== 'library' && kind !== 'model') throw new Error(`invalid storage kind: ${String(kind)}`);
        return moveStorage(jobId, kind, targetDir);
    });
    ipcMain.handle(IPC_CHANNELS.STORAGE_SET_WORK_DIR, async (_e, dir: string) => {
        const target = checkWorkDirChange(dir);
        if (target !== null) {
            // 処理中は、その処理が今の作業ディレクトリを使っているため変えない
            if (hasActiveJobs()) throw new Error('WORK_DIR_IN_USE');
            checkWorkDirIdle();
            // 待機中の補助プロセスは、今の作業ディレクトリに一時ファイルの置き場を持ち続けるため止める
            // (次に使うときに新しい場所で起動する)
            await stopAllWorkersAndWait();
            await changeWorkDir(target);
        }
        return getStorageInfo();
    });
}
