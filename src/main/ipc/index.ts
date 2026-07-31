import { registerUpdaterIpcHandlers } from './updater';
import { registerSettingsIpcHandlers } from './settings';
import { registerDialogIpcHandlers } from './dialog';
import { registerJobIpcHandlers } from './jobs';
import { registerAudioIpcHandlers } from './audio';
import { registerChapterIpcHandlers } from './chapter';
import { registerVectorizerIpcHandlers } from './vectorizer';
import { registerCleanupIpcHandlers } from './cleanup';

/**
 * IPCハンドラを登録
 * アプリケーション固有のIPC通信はここに追加
 */
export function registerIpcHandlers() {
    // 自動アップデート関連の IPC ハンドラ
    registerUpdaterIpcHandlers();

    // 設定・ダイアログ・ジョブ制御
    registerSettingsIpcHandlers();
    registerDialogIpcHandlers();
    registerJobIpcHandlers();

    // 機能別ハンドラ
    registerAudioIpcHandlers();
    registerChapterIpcHandlers();
    registerVectorizerIpcHandlers();
    registerCleanupIpcHandlers();
}
