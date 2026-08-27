import path from 'path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { setupConsoleBridge, setMainWindow } from './utils/console-bridge';
import { registerIpcHandlers } from './ipc/index';
import { initializeUpdater, scheduleStartupCheck, isInstallingUpdate } from './services/updater';
import { applySavedTheme, getSettings, initializeSearchThreads, updateSettings } from './services/settings';
import { cancelAllJobs, setJobWindow } from './services/job-manager';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
        },
        show: false,
    });

    // コンソールブリッジ用にメインウィンドウを設定
    setMainWindow(mainWindow);
    // ジョブイベント送信用にメインウィンドウを設定
    setJobWindow(mainWindow);

    if (isDev) {
        mainWindow.loadURL('http://localhost:3001');
        // 開発時はDevToolsを自動で開く
        try {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        } catch {
            // DevToolsのオープンに失敗した場合は無視
        }
        // メニューなしでDevToolsを切り替えるためのキーボードショートカット
        mainWindow.webContents.on('before-input-event', (event, input) => {
            const isToggleCombo =
                (input.key?.toLowerCase?.() === 'i' && (input.control || input.meta) && input.shift) ||
                input.key === 'F12';
            if (isToggleCombo) {
                event.preventDefault();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.toggleDevTools();
                }
            }
        });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('ready-to-show', () => mainWindow?.show());
    mainWindow.on('closed', () => {
        // 実行中のジョブ (外部プロセス) をすべて停止する
        cancelAllJobs();
        setMainWindow(null);
        setJobWindow(null);
        mainWindow = null;
    });

    // ウィンドウの読み込み完了 + 数秒後にバックグラウンドでアップデートを 1 回チェック
    // (起動が遅くてもウィンドウが表示されてから走るよう did-finish-load にフックする)
    scheduleStartupCheck(mainWindow);
}

app.whenReady().then(async () => {
    // コンソールブリッジをセットアップしてメインプロセスのログをDevToolsに送信
    setupConsoleBridge();

    // 保存済み設定のテーマを反映
    applySavedTheme();

    // 初回起動時だけ、探索のスレッド数の既定値を決めて保存する
    initializeSearchThreads();

    // electron-updater のイベントを登録 (本番ビルド時のみ動作)
    initializeUpdater();

    // アプリケーション固有のIPCハンドラを登録
    registerIpcHandlers();

    // アプリ情報取得とウィンドウ制御のIPC
    ipcMain.handle('app:getInfo', async () => {
        const settings = getSettings();
        return {
            name: app.getName() || 'Kura Toolkit',
            version: app.getVersion(),
            language: settings.app.language,
            theme: settings.app.theme,
            os: process.platform as 'win32' | 'darwin' | 'linux',
        };
    });

    ipcMain.handle('app:setTheme', (_e, theme: 'light' | 'dark' | 'system') => {
        updateSettings({ app: { theme } });
        applySavedTheme();
        return { theme };
    });

    ipcMain.handle('app:setLanguage', (_e, lang: 'ja' | 'en') => {
        updateSettings({ app: { language: lang } });
        return { language: lang };
    });

    ipcMain.handle('app:quit', () => {
        app.quit();
    });

    ipcMain.handle('window:minimize', () => {
        mainWindow?.minimize();
    });
    ipcMain.handle('window:maximizeOrRestore', () => {
        if (!mainWindow) return false;
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
            return false;
        }
        mainWindow.maximize();
        return true;
    });
    ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
    ipcMain.handle('window:close', () => {
        mainWindow?.close();
    });
    createWindow();
});

app.on('window-all-closed', () => {
    // 更新インストール中は終了・再起動を更新器に委ねるため、ここでの app.quit() を抑止する。
    // (先に app.quit() を走らせると macOS で更新器のステージング/再起動と競合し更新に失敗し得る)
    if (isInstallingUpdate()) return;
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
