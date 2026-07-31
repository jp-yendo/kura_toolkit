import { BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { IPC_CHANNELS } from '../../shared/constants';
import type { UpdateState } from '../../shared/types';

// electron-updater は dev 実行ではアップデート情報を取得しないので、本番ビルドのみで動作させる
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
// portable 版実行時は electron-updater 経由で NSIS インストーラを取得・実行してしまうのを防ぐため
// 自動更新関連の処理を一切行わない。electron-builder の portable ターゲットは起動時に
// PORTABLE_EXECUTABLE_FILE を設定するため、これで判定できる。
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;
// updater を停止すべき実行モードかどうか (dev または portable)
const isUpdaterDisabled = isDev || isPortable;

let currentState: UpdateState = { status: 'idle' };
let initialized = false;
// ユーザーが「アップデートする」を承諾した場合に true。downloaded 後に自動でインストールする
let autoInstallOnDownloaded = false;
// 起動時の自動チェックは 1 度だけ
let startupCheckScheduled = false;
// ユーザーが明示的にダウンロードを開始したかどうか。
// autoUpdater.on('error') はグローバルで起動時チェック失敗もダウンロード失敗も同じハンドラに来るため、
// このフラグが true のとき (= ユーザー操作によるダウンロード中) だけ UI にエラーを表示する。
// 起動時/バックグラウンドのチェック失敗 (オフライン等) は静かに idle へ戻す。
let downloadRequested = false;
// quitAndInstall を呼んでインストール (更新器による終了・再起動) に入ったかどうか。
// true の間は window-all-closed の app.quit() を抑止し、終了処理が更新器と競合しないようにする。
let installingUpdate = false;

function broadcastState(next: UpdateState) {
    currentState = next;
    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        win.webContents.send(IPC_CHANNELS.UPDATER_STATE_CHANGED, currentState);
    }
}

export function getUpdateState(): UpdateState {
    return currentState;
}

export function initializeUpdater() {
    if (initialized) return;
    initialized = true;

    if (isUpdaterDisabled) {
        // 開発時または portable 実行時は何もしない (state は idle のまま)
        return;
    }

    // ダウンロードはユーザーが明示的に承認したタイミングで開始する
    autoUpdater.autoDownload = false;
    // macOS の既知不具合対策: autoInstallOnAppQuit を true にしておくと、ダウンロード完了直後に
    // ネイティブ更新器 (Squirrel.Mac) へのステージングが実行される。false のままだと
    // quitAndInstall 時に初めてステージングを開始する非同期処理となり、アプリの終了処理と競合して
    // プロセスが先に終了し「ダウンロードは成功するのに更新されない」状態に陥る。
    // autoDownload=false のためダウンロードはユーザー承諾時のみ。承諾済みの更新を通常終了で
    // インストールするのは許容される挙動。
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = console;

    autoUpdater.on('checking-for-update', () => {
        // 内部状態のみ更新 (UI 通知不要)
        currentState = { status: 'checking' };
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
        // ユーザーへ確認を出す状態 (UI に通知)
        broadcastState({ status: 'available', version: info.version });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
        // 要件: アップデートが不要な場合は何もしない (UI に通知しない)
        currentState = { status: 'not-available', version: info.version };
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        broadcastState({
            status: 'downloading',
            version: currentState.version,
            progress: Math.round(progress.percent),
        });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
        // ダウンロード成功。以降に来る error はダウンロード起因ではないので扱いを戻す
        downloadRequested = false;
        broadcastState({ status: 'downloaded', version: info.version, progress: 100 });
        if (autoInstallOnDownloaded) {
            // 既にユーザーが「アップデートする」と承諾済み — 短い余白後にインストールを実行
            setTimeout(() => {
                quitAndInstall();
            }, 1500);
        }
    });

    autoUpdater.on('error', (err: Error) => {
        const message = err?.message ?? String(err);
        console.error('[updater] error:', message);
        autoInstallOnDownloaded = false;
        if (downloadRequested) {
            // ユーザーがダウンロードを開始した後の失敗だけ UI にエラーを表示する
            downloadRequested = false;
            broadcastState({ status: 'error', version: currentState.version, error: message });
        } else {
            // 起動時/バックグラウンドのチェック失敗 (オフライン等) は UI に出さず静かに idle へ戻す
            broadcastState({ status: 'idle' });
        }
    });
}

export async function checkForUpdates(): Promise<UpdateState> {
    if (isUpdaterDisabled) {
        return currentState;
    }
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        // ここでも UI には出さずコンソールにのみ
        console.error('[updater] checkForUpdates failed:', err instanceof Error ? err.message : err);
    }
    return currentState;
}

export async function downloadUpdate(): Promise<UpdateState> {
    if (isUpdaterDisabled) return currentState;
    // ユーザーが承諾したのでダウンロード完了後に自動でインストールする
    autoInstallOnDownloaded = true;
    // ユーザー操作によるダウンロード開始を記録 (error ハンドラがこのフラグで UI 表示可否を判定する)
    downloadRequested = true;
    // download-progress まで間が空くことがあるため、操作直後に進行中フィードバックを出す
    broadcastState({ status: 'downloading', version: currentState.version, progress: 0 });
    try {
        await autoUpdater.downloadUpdate();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[updater] downloadUpdate failed:', message);
        autoInstallOnDownloaded = false;
        // 'error' ハンドラが未発火でも必ずフィードバックを出す (二重発火しても冪等)
        if (downloadRequested) {
            downloadRequested = false;
            broadcastState({ status: 'error', version: currentState.version, error: message });
        }
    }
    return currentState;
}

export function isInstallingUpdate(): boolean {
    return installingUpdate;
}

export function quitAndInstall(): void {
    if (isUpdaterDisabled) return;
    // インストール中は window-all-closed の app.quit() を抑止し、終了・再起動を更新器へ委ねる。
    // (自前でウィンドウを閉じると終了ハンドラが更新器の終了・再起動より先に走り競合し得る)
    installingUpdate = true;
    setImmediate(() => {
        // ウィンドウは自前で閉じない。isSilent=false, isForceRunAfter=true でインストール後に再起動する。
        // ステージングは autoInstallOnAppQuit=true により既に完了しているため、ここは同期的に進む。
        autoUpdater.quitAndInstall(false, true);
    });
}

/**
 * メインウィンドウの読み込み完了 + 指定遅延後にバックグラウンドで 1 度だけ更新確認を行う。
 * 起動が遅くてもウィンドウ表示後に走るよう did-finish-load にフックする。
 */
export function scheduleStartupCheck(window: BrowserWindow, delayMs = 3000): void {
    if (startupCheckScheduled) return;
    startupCheckScheduled = true;
    if (isUpdaterDisabled) return;

    const trigger = () => {
        setTimeout(() => {
            void checkForUpdates();
        }, delayMs);
    };

    if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', trigger);
    } else {
        // 既に読み込み済みなら遅延だけ挟んで起動
        trigger();
    }
}
