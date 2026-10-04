import { registerUpdaterIpcHandlers } from './updater';
import { registerSettingsIpcHandlers } from './settings';
import { registerDialogIpcHandlers } from './dialog';
import { registerFileIpcHandlers } from './files';
import { registerJobIpcHandlers } from './jobs';
import { registerAudioIpcHandlers } from './audio';
import { registerChapterIpcHandlers } from './chapter';
import { registerVectorizerIpcHandlers } from './vectorizer';
import { registerCleanupIpcHandlers } from './cleanup';
import { registerVoiceIpcHandlers } from './voice';
import { registerStorageIpcHandlers } from './storage';

/**
 * IPCハンドラを登録
 * アプリケーション固有のIPC通信はここに追加
 */
export function registerIpcHandlers() {
    // 自動アップデート関連の IPC ハンドラ
    registerUpdaterIpcHandlers();

    // 設定・ダイアログ・ジョブ制御
    registerSettingsIpcHandlers();
    registerStorageIpcHandlers();
    registerDialogIpcHandlers();
    registerFileIpcHandlers();
    registerJobIpcHandlers();

    // 機能別ハンドラ
    registerAudioIpcHandlers();
    registerChapterIpcHandlers();
    registerVectorizerIpcHandlers();
    registerCleanupIpcHandlers();
    // 音声分離・音声変換・読み上げ
    registerVoiceIpcHandlers();
}
