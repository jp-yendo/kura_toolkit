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
// 動画分割・結合
// ---------------------------------------------------------------------------

export type ChapterInfo = {
    // チャプター配列内の添字 (利用者に示す番号は index + 1)
    index: number;
    // 秒
    start: number;
    end: number;
    title: string;
    // チャプターのタグ (タイトル・言語など。title も含む)
    tags: Record<string, string>;
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
    // 以下は結合で、そのままつなげられるか・引き継ぎ方を決めるために使う (分からないものは null)
    profile: string | null;
    // 色の規格 (色域・伝達特性・行列・範囲)
    colorPrimaries: string | null;
    colorTransfer: string | null;
    colorSpace: string | null;
    colorRange: string | null;
    // 画素の縦横比 (例: "32:27")
    sampleAspectRatio: string | null;
    // インターレース ("progressive" / "tt" / "bb" / "tb" / "bt")
    fieldOrder: string | null;
    // 回転の角度 (0・90・180・270)
    rotation: number;
    // 音声の 1 標本のビット数と標本の形式
    bitsPerSample: number | null;
    sampleFormat: string | null;
    // コーデックの初期化データの CRC32 (添付ファイルでは中身の CRC32)
    extradataHash: string | null;
    // 添付ファイルのファイル名
    fileName: string | null;
    // タイムコード (映像・タイムコード用のトラックのタグ)
    timecode: string | null;
};

export type VideoProbeResult = {
    // チャプターが無いファイルでは空
    chapters: ChapterInfo[];
    formatName: string;
    durationSec: number | null;
    hasVideo: boolean;
    streams: MediaStreamInfo[];
    // ファイル全体のメタ情報 (タイトル・作者など)
    formatTags: Record<string, string>;
};

// 切り出し・分割の方法。lossless = 再エンコードしない (始まりは直前のキーフレーム)、smart = キーフレームで切れない部分だけを
// 再エンコードして指定の位置で切る、reencode = 映像・音声を再エンコードして指定の位置で切る
export type VideoCutMethod = 'lossless' | 'smart' | 'reencode';

// チャプターの境界の決め方。scene = 境界の近くで場面がはっきり切り替わるフレームを境界にする (見つからなければ earlier)。
// ほかは境界をまたぐフレーム (境界より前に表示が始まり、後ろで終わるもの) を入れる範囲: earlier = 前の範囲、
// later = 後ろの範囲、longer = 境界の前後で長く表示される側の範囲
export type VideoCutBoundary = 'scene' | 'earlier' | 'later' | 'longer';

export type VideoCutRequest = {
    input: string;
    // チャプター配列の添字で指定
    fromIndex: number;
    // null = 最終チャプターまで
    toIndex: number | null;
    method: VideoCutMethod;
    boundary: VideoCutBoundary;
    // null = 入力と同じディレクトリ
    outputDir: string | null;
    // 出力ファイル名の明示指定 (null = チャプター名から自動生成)。
    // ディレクトリは含まず、outputDir の下に作られる
    outputName: string | null;
};

export type VideoSplitRequest = {
    input: string;
    // このチャプター添字の直前で分割する
    boundaryIndexes: number[];
    method: VideoCutMethod;
    boundary: VideoCutBoundary;
    outputDir: string | null;
};

// 実行前の出力先チェック結果
export type VideoOutputCheck = {
    // 生成される出力パスの一覧
    outputs: string[];
    // そのうち既に存在するもの (実行すると上書きになるため確認が必要)
    existing: string[];
    // 字幕の形式の都合で出力コンテナを変える場合の変更内容 (拡張子。変えない場合は null)
    containerChange: { from: string; to: string } | null;
    // 実行前に知らせること (出力に含められないもの・形式を変えて書くもの)
    notices: VideoSplitNotice[];
};

// 切り出し・分割で実行前に知らせること
export type VideoSplitNotice =
    | { kind: 'data'; codec: string }
    | { kind: 'coverArt' }
    // 再エンコードで、同じ形式で書けない音声を別の形式で書く
    | { kind: 'audioConverted'; codec: string; to: string };

// 結合する 1 ファイル
export type VideoMergeItem = {
    input: string;
    // ファイルの始まりに付けるチャプターの名前 (addChapters のときのみ使う。空 = ファイル名)
    chapterTitle: string;
};

export type VideoMergeRequest = {
    // 並べた順に結合する
    items: VideoMergeItem[];
    // 各ファイルの始まり (結合部) にチャプターを付ける
    addChapters: boolean;
    // 形式がそろっていても再エンコードする
    reencode: boolean;
    // 再エンコードで使う映像・音声のエンコーダ (null = 元のコーデックから決める)
    videoEncoder: string | null;
    audioEncoder: string | null;
    // 出力ファイルの絶対パス
    output: string;
};

// 使っている ffmpeg にあるエンコーダとフィルタ (調べられない場合は null)
export type VideoMergeCapabilities = {
    encoders: string[] | null;
    filters: string[] | null;
};

// 結合の出力先の確認
export type VideoMergeOutputCheck = {
    // 出力先のフォルダがある
    directoryExists: boolean;
    // 同じ名前のファイルが既にある (上書きになる)
    exists: boolean;
};

export type VideoJobResult = {
    outputs: string[];
    cancelled: boolean;
};

// 動画トラック・タグ管理

// 解析結果の 1 項目 (ffprobe の項目名と、表示用に文字にした値)
export type ProbeField = { key: string; value: string };

// 編集の対象にするトラックの種類
export type TrackKind = 'video' | 'audio' | 'subtitle';

// ファイルの中の 1 ストリーム
export type TrackStreamInfo = {
    // ファイルの中のストリームの番号
    index: number;
    // ffprobe の codec_type (video / audio / subtitle / data / attachment)
    codecType: string;
    // 編集の対象にするトラックの種類 (カバーアート・データ・添付ファイル・mp4 のチャプター用のトラックは null)
    kind: TrackKind | null;
    codec: string;
    language: string;
    title: string;
    isDefault: boolean;
    // コーデックのタグ (mp4 の hvc1・mp4a など。持たない形式は空)
    codecTag: string;
    // 一覧に添える要約の行 (長さとビットレート (字幕は長さだけ)、映像は解像度とフレームレート・音声はチャンネル数と
    // サンプルレート・画像の字幕は解像度)
    summary: string[];
    // ffprobe のすべての項目 (タグと指定 (disposition) を除く)
    fields: ProbeField[];
    tags: Record<string, string>;
    // 立っている指定 (default・forced など)
    dispositions: string[];
};

export type TrackTagChapter = {
    title: string;
    start: number;
    end: number;
    // title 以外のチャプターのタグ (書き出すときに引き継ぐ)
    tags: Record<string, string>;
};

export type TrackTagFile = {
    path: string;
    // 拡張子 (小文字、ドット付き)
    extension: string;
    sizeBytes: number;
    durationSec: number | null;
    // ffprobe のファイル全体の項目 (タグを除く)
    formatFields: ProbeField[];
    formatTags: Record<string, string>;
    streams: TrackStreamInfo[];
    chapters: TrackTagChapter[];
};

// 本編の映像のフレームの表示の時刻 (昇順) と、キーフレームの表示の時刻 (昇順)
export type TrackTagFrames = { times: number[]; keyframes: number[] };

// 音声のトラックの波形: channels はチャンネルごと (モノラルは 1 つ、ステレオ以上は左・右の 2 つ。3 チャンネル以上は
// ステレオにまとめる) の区間の最大の並び。channels[c][i] は時刻 i * step から step 秒の区間の音の大きさの最大
// (0 から 1。時刻はファイルの始まりを 0 とする)
export type TrackTagWaveform = { step: number; channels: number[][] };

// プレビューで再生する URL (proxy = 元の動画を再生できないため作ったプレビュー用の動画)
export type TrackTagPreview = { url: string; proxy: boolean };

// 出力するトラック (出力の順)
export type TrackTagEditTrack = {
    // トラックを持つファイル (元の動画か、追加したファイル)
    source: string;
    streamIndex: number;
    kind: TrackKind;
    codec: string;
    // 言語 (ISO 639-2 の 3 文字。空 = 指定なし)
    language: string;
    // トラックの名前 (空 = 名前なし)
    title: string;
    isDefault: boolean;
    // 既定以外のフラグ (ffmpeg の disposition の名前。強制・聴覚障害者向けなど)
    flags: string[];
};

export type TrackTagSaveRequest = {
    input: string;
    output: string;
    // ファイル全体のタグ (書く順)
    formatTags: Array<{ key: string; value: string }>;
    tracks: TrackTagEditTrack[];
    chapters: TrackTagChapter[];
};

// 出力の前に調べること
export type TrackTagSaveCheck = {
    // 再エンコードしなければ出力形式へ入れられないトラック (出力できない。trackNumber は出力のトラックの 1 からの番号)
    unsupported: Array<{ trackNumber: number; kind: TrackKind; codec: string }>;
    // 形式を変えて入れる字幕 (書式などが失われうる)
    converted: Array<{ trackNumber: number; codec: string; to: string }>;
    // 出力形式に書けないファイル全体のタグ
    lostTags: string[];
    // 出力形式に書けないトラックのタグ (言語・独自のタグなど) の名前
    lostTrackTags: string[];
    // 出力形式にチャプターを書けない
    chaptersLost: boolean;
    // 出力形式に書けないチャプターのタグ (名前以外) の名前
    lostChapterTags: string[];
    // 出力形式に書けないトラックのフラグ (disposition の名前)
    lostFlags: string[];
    // 既定にしないトラックが既定として書かれる (種類ごとに最初のトラックを既定にする形式)
    defaultForced: boolean;
    // 書けるかを確かめられなかった (この形式の試しのファイルを書けない)
    probeFailed: boolean;
    // 出力形式に入れられない、元のファイルのそのほかのもの
    droppedExtras: Array<'attachment' | 'coverArt' | 'data'>;
};

export type TrackTagExportRequest = { input: string; streamIndex: number; output: string };

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

// 元画像が画像の長辺のサイズより小さいときの拡大の方法 (縮小は常に lanczos3)
export type VectorizerUpscale = 'nearest' | 'bilinear';

// 変換の前処理 (プリセットに含めず、パラメータと同じくストアにだけ持つ)
export type VectorizePreprocess = {
    // 変換の前に、比率を保って長辺をこの大きさ (px) にそろえる (縮小も拡大もする)
    longSide: number;
    upscale: VectorizerUpscale;
    // 縁からつながる、縁の色に近い領域を透明にする
    removeBackground: boolean;
    // 背景の色との色差 (Lab) がこれ未満の画素を背景とみなす (0 は背景の色と一致する画素だけ)
    backgroundTolerance: number;
    // 背景を除いた後に残る、面積 (px) がこれ未満の不透明な点を透明にする (0 は除かない)
    speckArea: number;
    // 明るさのしきい値ごとに白黒で変換し、灰色で重ねる
    grayscale: boolean;
    // グレースケールで変換した形ごとに、元画像の色を付け直す
    recolor: boolean;
};

// 変換した SVG の出力 (プリセットに含めず、パラメータと同じくストアにだけ持つ)
export type VectorizeOutput = {
    // 変換した SVG を最適化する
    optimize: boolean;
    // 座標の小数点以下の桁数
    pathPrecision: number;
};

// 変換の要求 (パラメータ・前処理・出力)
export type VectorizeRequest = {
    params: VectorizeParams;
    preprocess: VectorizePreprocess;
    output: VectorizeOutput;
};

// 変換の結果。取り消したときは svg が null で cancelled が true
export type VectorizeJobResult = {
    svg: SvgResult | null;
    cancelled: boolean;
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
    // SVG の path 要素の数と、ファイルの大きさ (バイト)
    pathCount: number;
    bytes: number;
};

// ---------------------------------------------------------------------------
// SVG 自動変換
// ---------------------------------------------------------------------------

// 自動変換の要求。前処理と出力は SVG 変換と同じ。trials は変換を試す回数の上限
export type SvgAutoRequest = {
    preprocess: VectorizePreprocess;
    output: VectorizeOutput;
    trials: number;
};

// 補正の調整 (recolor: 色の付け直し、smallShapes: 小さな形の除去、mergeColors: 近い色の統合、simplify: 点の削減)
export type SvgAutoAdjustment = 'recolor' | 'smallShapes' | 'mergeColors' | 'simplify';

// 版の出どころ。trial は試行の候補 (再現度の順位 rank (1 から)。グレースケールで変換したときは段階の数 grayLevels)、
// refine は最良の候補に補正の調整を順に採ったもの (adjustments は採った調整。採った順)
export type SvgAutoVersionSource =
    { kind: 'trial'; rank: number; grayLevels: number | null } | { kind: 'refine'; adjustments: SvgAutoAdjustment[] };

// 自動変換の版 (main が作業ディレクトリに置いた SVG ファイル)
export type SvgAutoVersion = {
    // 保存のときに渡す識別子
    id: string;
    // 表示用の URL (kura-media://)
    url: string;
    source: SvgAutoVersionSource;
    // 再現度 (0-1)
    fidelity: number;
    // SVG の path 要素の数と、ファイルの大きさ (バイト)
    pathCount: number;
    bytes: number;
    // 設定が標準のプリセットの値のままのときは、そのプリセットの名前の翻訳キー (探索で値を変えたときは null)
    presetNameKey: string | null;
};

// 自動変換の結果。版は試行の候補 (再現度の高い順) の後に補正の版 (採った順) が並ぶ
export type SvgAutoResult = {
    versions: SvgAutoVersion[];
    // 最も再現度の高い版 (同じならファイルの小さいもの)
    bestId: string;
    // 変換を試した回数と、そのうち変換できなかった回数
    trials: number;
    failures: number;
    // 処理が途中で終わり (メモリ不足など)、それまでに得た版だけを返したか
    incomplete: boolean;
};

// 自動変換のジョブの結果。取り消したときは result が null で cancelled が true
export type SvgAutoJobResult = {
    result: SvgAutoResult | null;
    cancelled: boolean;
};

// 自動変換の進み具合の知らせに添える値 (JobEvent.payload)
export type SvgAutoProgressPayload = {
    // これまでに得た最も高い再現度 (まだ無いときは null)
    bestFidelity: number | null;
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
    // 動画分割・結合と画像 SVG 変換のパラメータは永続化しない (毎回既定値から始める)
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
