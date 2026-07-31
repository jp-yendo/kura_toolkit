// プラットフォーム識別子
export type PlatformId = 'win32' | 'darwin' | 'linux';

// アプリのテーマ設定
export type AppTheme = 'light' | 'dark' | 'system';

// アプリの言語設定
export type AppLanguage = 'ja' | 'en';

// アプリ情報
export type AppInfo = {
    name: string;
    version: string;
    language: AppLanguage;
    theme: AppTheme;
    os: PlatformId;
};

// 部分更新用のユーティリティ型 (配列は丸ごと置換)
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ファイル選択ダイアログのフィルタ
export type FileFilter = {
    name: string;
    extensions: string[];
};

// ffmpeg/ffprobe の検出結果
export type FfmpegDetectResult = {
    ffmpegPath: string | null;
    ffprobePath: string | null;
};

// ---------------------------------------------------------------------------
// ジョブ (長時間処理) 関連
// ---------------------------------------------------------------------------

// main から renderer へ push されるジョブイベント
export type JobEvent = {
    jobId: string;
    kind: 'progress' | 'log' | 'item';
    // 全体進捗 (0-100)。不定の場合は省略
    percent?: number;
    // 複数アイテム処理時の現在位置 (1 始まり) と総数
    current?: number;
    total?: number;
    // ログ行など (ユーザー可視文言ではなく生メッセージ)
    message?: string;
    // kind='item' の場合の発見アイテムなど
    payload?: unknown;
};

// ---------------------------------------------------------------------------
// オーディオ正規化
// ---------------------------------------------------------------------------

export type BitrateMode = 'cbr' | 'vbr';

export type AudioNormalizerSettings = {
    outputDir: string;
    targetLufs: number;
    sampleRate: number;
    bitrateMode: BitrateMode;
    bitrate: number;
};

export type AudioAnalyzeItem = {
    path: string;
    channels: number | null;
    lufs: number | null;
    error?: string;
};

export type AudioAnalyzeResult = {
    items: AudioAnalyzeItem[];
    cancelled: boolean;
};

export type AudioNormalizeItem = {
    path: string;
    outputPath?: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
};

export type AudioNormalizeResult = {
    items: AudioNormalizeItem[];
    cancelled: boolean;
};

// ---------------------------------------------------------------------------
// チャプターカット
// ---------------------------------------------------------------------------

export type ChapterCutSettings = {
    outputDir: string;
    accurate: boolean;
};

export type ChapterInfo = {
    // ffprobe が返すチャプター id (文字列化)
    id: string;
    // チャプター配列内の添字
    index: number;
    // 秒
    start: number;
    end: number;
    title: string;
};

export type ChapterProbeResult = {
    chapters: ChapterInfo[];
    formatName: string;
    durationSec: number | null;
    hasVideo: boolean;
};

export type ChapterCutRequest = {
    input: string;
    // チャプター配列の添字で指定
    fromIndex: number;
    // null = 最終チャプターまで
    toIndex: number | null;
    accurate: boolean;
    // null = 入力と同じディレクトリ
    outputDir: string | null;
    // 出力ファイルパスの明示指定 (null = チャプター名から自動生成)
    outputPath: string | null;
};

export type ChapterSplitRequest = {
    input: string;
    // このチャプター添字の直前で分割する
    boundaryIndexes: number[];
    accurate: boolean;
    outputDir: string | null;
};

export type ChapterJobResult = {
    outputs: string[];
    cancelled: boolean;
};

// ---------------------------------------------------------------------------
// 画像 SVG 変換 (vtracer)
// ---------------------------------------------------------------------------

export type VectorizerColorMode = 'color' | 'binary';
export type VectorizerHierarchical = 'stacked' | 'cutout';
export type VectorizerPathMode = 'spline' | 'polygon' | 'none';

export type VectorizeParams = {
    colorMode: VectorizerColorMode;
    hierarchical: VectorizerHierarchical;
    filterSpeckle: number;
    colorPrecision: number;
    layerDifference: number;
    mode: VectorizerPathMode;
    cornerThreshold: number;
    lengthThreshold: number;
    spliceThreshold: number;
};

export type ImagePreview = {
    dataUrl: string;
    fileName: string;
};

// ---------------------------------------------------------------------------
// クリーンアップ
// ---------------------------------------------------------------------------

export type CleanupSettings = {
    // ユーザーが追加した検索対象ディレクトリ
    customDirs: string[];
    // 前回検索したときの条件 (次回起動時に復元する)
    selectedTargets: CleanupTargetId[];
    selectedRoots: string[];
};

export type CleanupTargetId =
    | 'zoneIdentifier'
    | 'thumbsDb'
    | 'dsStore'
    | 'dotUnderscore'
    | 'appleDouble'
    | 'fseventsd'
    | 'spotlight'
    | 'appleDb'
    | 'appleDesktop'
    | 'temporaryItems'
    | 'networkTrash';

export type CleanupRoot = {
    id: string;
    kind: 'home' | 'drive' | 'custom';
    path: string;
    // ドライブの総容量 (GB)。取得できない場合は null
    sizeGb?: number | null;
    removable?: boolean;
    network?: boolean;
};

export type CleanupItem = {
    path: string;
    targetId: CleanupTargetId;
    kind: 'file' | 'dir' | 'ads';
};

export type CleanupScanResult = {
    items: CleanupItem[];
    cancelled: boolean;
    errors: string[];
};

export type CleanupRemoveResult = {
    deleted: number;
    failed: { path: string; error: string }[];
};

// このプラットフォームで利用できるクリーンアップ機能と権限の状態
export type CleanupCapabilities = {
    // 検出可能な対象 (Zone.Identifier は Windows のみ)
    availableTargets: CleanupTargetId[];
    // フルディスクアクセス権限が必要なプラットフォームか (macOS のみ true)
    requiresFullDiskAccess: boolean;
    // 権限が付与されているか (不要なプラットフォームでは常に true)
    hasFullDiskAccess: boolean;
};

// ---------------------------------------------------------------------------
// アプリ設定 (~/.kura_toolkit/settings.json)
// ---------------------------------------------------------------------------

export type FfmpegSettings = {
    // 空文字 = PATH から自動検出
    ffmpegPath: string;
    ffprobePath: string;
};

// 設定更新の結果。保存に失敗しても起動中の設定 (settings) は更新される
export type SettingsUpdateResult = {
    settings: AppSettings;
    // 保存に失敗した場合の理由 (成功時は null)
    saveError: string | null;
};

export type AppSettings = {
    version: number;
    app: {
        theme: AppTheme;
        language: AppLanguage;
    };
    ffmpeg: FfmpegSettings;
    audioNormalizer: AudioNormalizerSettings;
    chapterCut: ChapterCutSettings;
    vectorizer: VectorizeParams;
    cleanup: CleanupSettings;
};

// 自動アップデートの状態
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

// 自動アップデートの状態ペイロード
export type UpdateState = {
    status: UpdateStatus;
    // リモート上で公開されている最新バージョン (取得済みの場合)
    version?: string;
    // ダウンロード進捗 (0-100)
    progress?: number;
    // 直近のエラーメッセージ (status='error' 時のみ)
    error?: string;
};
