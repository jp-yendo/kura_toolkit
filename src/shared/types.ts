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

// 正規化を実行する前の出力先チェック結果
export type AudioOutputCheck = {
    // 既に存在する出力パス (実行すると上書きになるため確認が必要)
    existing: string[];
    // 複数の入力が同じ出力パスになる場合のパス (必ず互いを上書きするため実行させない)
    duplicated: string[];
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

export type MediaStreamKind = 'video' | 'audio' | 'subtitle' | 'other';

// 入力ファイルのストリーム情報 (画面表示用。不明な項目は null)
export type MediaStreamInfo = {
    index: number;
    kind: MediaStreamKind;
    // ffprobe が返した codec_type をそのまま持つ (kind='other' の内訳を表示するため)
    codecType: string;
    codec: string;
    // コンテナ上のタグと用途名 (mp4 の 'text' / 'SubtitleHandler' など)。
    // ffmpeg がコーデックを判別できない字幕トラックの識別に使う
    codecTag: string | null;
    handlerName: string | null;
    // 収録フレーム数 (分かる場合のみ)。mp4 のチャプター用トラック判定に使う
    frameCount: number | null;
    // 映像のみ
    width: number | null;
    height: number | null;
    pixelFormat: string | null;
    // カバーアート (本編ではない映像ストリーム)
    attachedPic: boolean;
    // 再生時に既定で選ばれるか / 強制表示か
    isDefault: boolean;
    isForced: boolean;
    // 音声のみ
    channels: number | null;
    sampleRate: number | null;
    bitrateKbps: number | null;
    language: string | null;
    title: string | null;
};

export type ChapterProbeResult = {
    chapters: ChapterInfo[];
    formatName: string;
    durationSec: number | null;
    hasVideo: boolean;
    streams: MediaStreamInfo[];
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
    // 出力ファイル名の明示指定 (null = チャプター名から自動生成)。
    // ディレクトリは含まず、outputDir の下に作られる
    outputName: string | null;
};

export type ChapterSplitRequest = {
    input: string;
    // このチャプター添字の直前で分割する
    boundaryIndexes: number[];
    accurate: boolean;
    outputDir: string | null;
};

// 実行前の出力先チェック結果
export type ChapterOutputCheck = {
    // 生成される出力パスの一覧
    outputs: string[];
    // そのうち既に存在するもの (実行すると上書きになるため確認が必要)
    existing: string[];
    // 字幕の形式の都合で出力コンテナを変える場合の変更内容 (拡張子。変えない場合は null)
    containerChange: { from: string; to: string } | null;
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
    // チャプターカットと画像 SVG 変換のパラメータは永続化しない (毎回既定値から始める)
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
