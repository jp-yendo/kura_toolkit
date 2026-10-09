import type { AudioExportSettings, VoiceModelFeature } from './voice/types';
import type { SymbolReading, VoiceLanguage } from './voice/languages';
import type { AudioEncodeSettings, AudioFormat } from './audio-format';

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
    kind: 'progress' | 'log' | 'item' | 'scan' | 'wait';
    // 全体進捗 (0-100)。不定の場合は省略。null は、進み具合が分からない状態に戻す (手順が変わったときなど)
    percent?: number | null;
    // 複数アイテム処理時の現在位置 (1 始まり) と総数
    current?: number;
    total?: number;
    // ログ行など (ユーザー可視文言ではなく生メッセージ)
    message?: string;
    // kind='item' の場合の発見アイテムなど
    payload?: unknown;
    // kind='scan' (ディレクトリ走査) の進捗。総数が事前に分からないため percent は持たない。
    // 一定間隔でまとめて送る
    scan?: ScanProgress;
    // kind='wait': 他の処理が GPU を使い終わるのを待っているか (音声機能)
    waiting?: boolean;
    // 今の段階 (画面に「〜しています」と示し、段階の中の進み具合から残り時間を見積もる)
    phase?: JobPhase;
};

// 処理の段階。id は画面の文言の名前 (jobPhases.<id>。回数で数える段階は jobPhasesCounted.<id>)
export type JobPhase = {
    id: string;
    // 段階の中の進み具合 (0-1)。分からない段階では省略し、残り時間を示さない
    fraction?: number;
    // 回数で数えられる段階 (学習の回数など) の現在の回数と総数
    current?: number;
    total?: number;
    // 手順で進む処理 (学習など) の何番目の手順か (1 から) と手順の数
    step?: number;
    steps?: number;
};

// ディレクトリ走査の進捗。走査スレッドごとの現在位置を含む
export type ScanProgress = {
    // 走査済みディレクトリ数 (累計)
    visitedDirs: number;
    // 発見件数 (累計)
    foundCount: number;
    // 走査スレッドごとに今見ているディレクトリ。走査を終えたスレッドは null
    workers: (string | null)[];
};

// ---------------------------------------------------------------------------
// オーディオ正規化
// ---------------------------------------------------------------------------

// 正規化の出力形式 (keep: 元のファイルと同じ形式・同じ設定で書き出す)
export type AudioOutputFormat = AudioFormat | 'keep';

// 出力先・目標のラウドネス・出力形式と、形式ごとの設定 (audio-format.ts)
export type AudioNormalizerSettings = AudioEncodeSettings & {
    outputDir: string;
    targetLufs: number;
    outputFormat: AudioOutputFormat;
};

// 目標のラウドネスの初期値 (LUFS。分岐の「その他」の音量をそろえるの初期値もこれに合わせる)
export const AUDIO_NORMALIZER_DEFAULT_LUFS = -13;

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
    // 曲全体の実測値。ラウドネス (LUFS) と True Peak (dBTP)。測れなかったもの (無音など) は null
    lufs: number | null;
    truePeak: number | null;
    error?: string;
};

// 正規化するファイル。実測値は解析で求めたもの (解析していないものは null。正規化の中で測る)
export type AudioNormalizeInput = {
    path: string;
    durationSec: number | null;
    lufs: number | null;
    truePeak: number | null;
};

// 一覧に加えたときに調べる、ファイルの長さとチャンネル数 (調べられなかったものは null)
export type AudioProbeItem = {
    path: string;
    durationSec: number | null;
    channels: number | null;
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
    // 正規化の中で測った実測値 (解析していなかったファイル。一覧に反映する)
    lufs?: number | null;
    truePeak?: number | null;
    // ピークの上限のため目標まで上げられなかった場合の、仕上がりのラウドネス (LUFS)
    limitedLufs?: number;
    // 出力が入力のファイルを置き換えた (入力の実測値は使えなくなる)
    inputReplaced?: boolean;
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
    // 表示用の URL (kura-media://)
    url: string;
    fileName: string;
};

// SVG の変換結果 (main が作業ディレクトリに置いたファイル)
export type SvgResult = {
    // 保存のときに渡す識別子
    id: string;
    // 表示用の URL (kura-media://)
    url: string;
};

// ---------------------------------------------------------------------------
// プリセット (SVG 変換・音声機能で共通)
// ---------------------------------------------------------------------------

export type PresetRecord<T> = {
    id: string;
    name: string;
    // 初期のプリセットの表示名 (翻訳キー)。利用者が名前を変えるまでは name の代わりに使う
    nameKey?: string;
    // アプリが用意した初期のプリセット (上書き・名前変更・削除はできない)
    builtin: boolean;
    params: T;
};

// プリセットの保存の要求。id があればそのプリセットに上書きし、無ければ新しく作る。
// 上書きで name が空のときは名前を変えない
export type PresetSaveRequest<T> = {
    id?: string;
    name: string;
    params: T;
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

// ファイル探索 (ディレクトリ走査) の共通設定。
// クリーンアップの検索など、ディレクトリを走査する処理はこのスレッド数を上限とする
export type SearchSettings = {
    // 走査に使うスレッド数。0 は「未決定」を表す番兵で、初回起動時に実数値へ置き換わる
    threads: number;
};

// 保存場所
type StorageSettings = {
    // ライブラリディレクトリ (外部のライブラリ。中はライブラリごとのディレクトリ)。空文字 = 既定 (~/.kura_toolkit/libraries)
    libraryDir: string;
    // モデルディレクトリ (ダウンロードしたモデルと、学習・取り込みしたモデル。中は分類ごとの階層)。
    // 空文字 = 既定 (~/.kura_toolkit/models)
    modelDir: string;
    // 作業ディレクトリ (全機能の一時ファイル)。空文字 = 既定 (OS の一時ディレクトリの中の kura_toolkit)
    workDir: string;
    // キャッシュディレクトリ (消しても作り直せるもの。中はライブラリごとのディレクトリ)。
    // 空文字 = 既定 (~/.kura_toolkit/cache)
    cacheDir: string;
    // キャッシュの保持期間 (日)。これより長く使われていないもの・作り直されていないものを起動時に消す
    cacheRetentionDays: number;
};

// 音声分離・音声変換・読み上げの設定
type VoiceSettings = {
    // 音声の書き出しの設定 (3 機能で共有する)
    export: AudioExportSettings;
    // 記号の読みの定義 (読み上げ機能、言語ごと)。null = 言語定義の初期値を使う
    symbolReadings: Record<VoiceLanguage, SymbolReading[] | null>;
    // 音声機能の更新の確認を表示したアプリのバージョン (同じバージョンでは起動のたびに確認しない)
    updatePromptVersion: string;
    // 録音に使うマイク (deviceId)。空文字 = OS の既定のマイク (設定画面では「OS の既定のマイク」と示す)
    microphoneId: string;
    // 録音の入力ゲイン (アプリの中で音を大きく・小さくする量。dB、MIC_INPUT_GAIN_DB の範囲)
    inputGainDb: number;
};

// 録音の入力ゲイン (dB)。0 はマイクの入力のまま、正で大きく、負で小さくする
export const MIC_INPUT_GAIN_DB = { default: 0, min: -30, max: 30 };

// 保存場所の種類 (ライブラリ・モデル・キャッシュ・作業ディレクトリ)
export type StorageKind = 'library' | 'model' | 'cache' | 'work';

// 中身を移動する保存場所 (作業ディレクトリは一時ファイルの置き場のため移動しない)
export type MovableStorageKind = Exclude<StorageKind, 'work'>;

// 保存場所の状態 (設定画面の表示用)
export type StorageInfo = {
    // 実際に使う場所 (設定が空なら既定の場所)
    dirs: Record<StorageKind, string>;
    // 既定の場所
    defaults: Record<StorageKind, string>;
    // Windows でパスに ASCII 以外の文字が含まれる (一部のライブラリが扱えない)
    nonAscii: Record<StorageKind, boolean>;
};

// 保存場所の移動で比べる、まとまり (単位) の中身。ファイル数・合計サイズ・最終更新日時 (中のファイルで最も新しいもの)
export type StorageUnitStats = {
    fileCount: number;
    sizeBytes: number;
    modifiedAt: number | null;
};

// 移動元と移動先の両方にあるまとまり (上書きするかを利用者が選ぶもの)
export type StorageUnitConflict = {
    key: string;
    // download: ダウンロードしたモデル / componentFiles: パッケージ一式に付属するモデル設定 / voice: 声のモデル /
    // trainingSet: 学習セット / python: Python 本体 / library: ライブラリ (仮想環境の単位)
    kind: 'download' | 'componentFiles' | 'voice' | 'trainingSet' | 'python' | 'library';
    // ダウンロード項目の ID (表示名に使う。ダウンロードしたもの・ライブラリ)
    itemIds?: string[];
    // 利用者が付けた名前 (声のモデル・学習セット)。移動先のものは名前が変わっていることがある
    name?: string;
    targetName?: string;
    feature?: VoiceModelFeature;
    source: StorageUnitStats;
    target: StorageUnitStats;
};

export type StorageMovePlan = {
    conflicts: StorageUnitConflict[];
    // 移動元にだけあり、そのまま移すまとまりの数と合計サイズ (どのまとまりにも属さず移すファイルも大きさに含む)
    transferCount: number;
    transferBytes: number;
};

// 両方にあるまとまりごとの選択 (overwrite: 移動先を削除してから移す / keep: 移動先を使い、移動元は削除する)
export type StorageMoveDecisions = Record<string, 'overwrite' | 'keep'>;

export type StorageMoveResult = {
    cancelled: boolean;
    // 移動後の動作確認に失敗し、作り直し (パッケージの再ダウンロード) が必要になった項目
    rebuildRequired: string[];
    // 移動は終わったが消せなかった元の場所 (消せた場合は null)
    remainingPath: string | null;
};

// 設定更新の結果。保存に失敗しても起動中の設定 (settings) は更新される
export type SettingsUpdateResult = {
    settings: AppSettings;
    // 保存に失敗した場合の理由 (成功時は null)
    saveError: string | null;
};

// 設定ファイルを読み込めなかった場合の内容
export type SettingsLoadError = {
    path: string;
    message: string;
};

export type AppSettings = {
    version: number;
    app: {
        theme: AppTheme;
        language: AppLanguage;
    };
    ffmpeg: FfmpegSettings;
    // ファイル探索処理で共有する設定
    search: SearchSettings;
    // ライブラリ・モデル・作業ディレクトリ
    storage: StorageSettings;
    audioNormalizer: AudioNormalizerSettings;
    // チャプターカットと画像 SVG 変換のパラメータは永続化しない (毎回既定値から始める)
    cleanup: CleanupSettings;
    // 音声分離・音声変換・読み上げ
    voice: VoiceSettings;
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
