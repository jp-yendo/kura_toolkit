import type {
    AppInfo,
    AppLanguage,
    AppSettings,
    AppTheme,
    AudioAnalyzeResult,
    AudioNormalizeResult,
    AudioNormalizerSettings,
    ChapterCutRequest,
    ChapterJobResult,
    ChapterProbeResult,
    ChapterSplitRequest,
    CleanupCapabilities,
    CleanupItem,
    CleanupRemoveResult,
    CleanupRoot,
    CleanupScanResult,
    CleanupTargetId,
    DeepPartial,
    FfmpegDetectResult,
    FileFilter,
    ImagePreview,
    JobEvent,
    SettingsUpdateResult,
    UpdateState,
    VectorizeParams,
} from './types';

// IPC APIの型定義
export type IpcApi = {
    // アプリ情報・設定
    getAppInfo(): Promise<AppInfo>;
    setTheme(theme: AppTheme): Promise<{ theme: AppTheme }>;
    setLanguage(language: AppLanguage): Promise<{ language: AppLanguage }>;
    quitApp(): Promise<void>;
    // ドラッグ&ドロップされた File オブジェクトから絶対パスを取得
    getPathForFile(file: File): string;
    // ウィンドウ制御
    minimize(): Promise<void>;
    maximizeOrRestore(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    close(): Promise<void>;
    // 永続設定
    settings: {
        get(): Promise<AppSettings>;
        // 保存に失敗しても起動中の設定は更新され、理由が saveError で返る
        update(patch: DeepPartial<AppSettings>): Promise<SettingsUpdateResult>;
    };
    // ffmpeg/ffprobe の自動検出
    ffmpeg: {
        detect(): Promise<FfmpegDetectResult>;
    };
    // ファイル/ディレクトリ選択ダイアログ
    dialog: {
        openFiles(options: { filters: FileFilter[]; multi?: boolean }): Promise<string[]>;
        openDirectory(options?: { defaultPath?: string }): Promise<string | null>;
        saveFile(options: { defaultPath?: string; filters: FileFilter[] }): Promise<string | null>;
    };
    // 長時間ジョブの制御
    jobs: {
        cancel(jobId: string): Promise<void>;
        // ジョブイベントの購読 (戻り値は購読解除関数)
        onEvent(listener: (event: JobEvent) => void): () => void;
    };
    // オーディオ正規化
    audio: {
        analyze(jobId: string, files: string[]): Promise<AudioAnalyzeResult>;
        normalize(jobId: string, files: string[], options: AudioNormalizerSettings): Promise<AudioNormalizeResult>;
    };
    // チャプターカット
    chapter: {
        probe(input: string): Promise<ChapterProbeResult>;
        cut(jobId: string, request: ChapterCutRequest): Promise<ChapterJobResult>;
        split(jobId: string, request: ChapterSplitRequest): Promise<ChapterJobResult>;
    };
    // 画像 SVG 変換
    vectorizer: {
        loadImage(path: string): Promise<ImagePreview>;
        convert(path: string, params: VectorizeParams): Promise<{ svg: string }>;
        saveSvg(path: string, svg: string): Promise<void>;
    };
    // クリーンアップ
    cleanup: {
        // 利用可能な対象と権限状態を取得
        getCapabilities(): Promise<CleanupCapabilities>;
        // macOS のフルディスクアクセス設定画面を開く
        openPermissionSettings(): Promise<void>;
        getRoots(): Promise<CleanupRoot[]>;
        scan(jobId: string, options: { roots: string[]; targets: CleanupTargetId[] }): Promise<CleanupScanResult>;
        remove(jobId: string, items: CleanupItem[]): Promise<CleanupRemoveResult>;
    };
    // 自動アップデート (electron-updater)
    updater: {
        // 起動時の状態を取得 (UI 初期化に利用)
        getState(): Promise<UpdateState>;
        // GitHub Releases に新しいバージョンがあるかチェック (ダウンロードはしない)
        check(): Promise<UpdateState>;
        // 利用可能なアップデートのダウンロードを開始
        download(): Promise<UpdateState>;
        // ダウンロード済みのアップデートを適用してアプリを再起動
        quitAndInstall(): Promise<void>;
        // アップデート状態の変化を購読 (戻り値は購読解除関数)
        onStateChanged(listener: (state: UpdateState) => void): () => void;
    };
};

declare global {
    interface Window {
        kuraToolkit: IpcApi;
    }
}
