// 音声分離・音声変換・読み上げの共有型 (main / preload / renderer)。
// Node / DOM に依存させない。

import type { SymbolReading, TtsModelType, VoiceLanguage } from './languages';
import type { TagFix, TagIssue } from './control-tags';
import type { DereverbOption, LoudnessOption, NoiseRemovalOption, SilenceOption } from './audio-filters';
import type { AudioEncodeSettings, AudioFormat } from '../audio-format';

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

// Python の仮想環境を分ける単位 (PyTorch の要求バージョンが異なるため)
export type VoiceComponentId = 'separator' | 'converter' | 'tts';

// 声のモデルを持つ機能
export type VoiceModelFeature = 'converter' | 'tts';

// ダウンロード物が必要になる機能 (削除時の警告と、未取得時の案内に使う)
export type VoiceFeatureId = 'separation' | 'conversion' | 'conversionTraining' | 'tts' | 'ttsTraining';

// 書き出しの設定 (形式と、形式ごとの設定。audio-format.ts)
export type AudioExportSettings = AudioEncodeSettings & { format: AudioFormat };

// プレビューの波形の区間の数 (チャンネルごと)
export const WAVEFORM_BUCKETS = 4096;

// プレビューの波形 (チャンネルは 1 か 2。3ch 以上の音声はステレオにまとめる)
export type WaveformData = {
    channels: number;
    durationSec: number;
    // チャンネルごとに、区間 (WAVEFORM_BUCKETS 個) の [最小値, 最大値] を順に並べたもの
    peaks: Float32Array[];
};

// プレビュー再生できる音声ファイル
export type MediaRef = {
    path: string;
    // renderer の audio 要素で再生する URL (main が公開したもの)
    url: string;
    durationSec: number;
    channels: number;
    sampleRate: number;
};

// 読み込んだ入力の音声 (内部処理用の WAV にしたもの)
export type PreparedInput = {
    media: MediaRef;
    // 元の音源のチャンネル数 (3ch 以上は 2ch として扱う)
    channels: number;
    sourcePath: string;
};

export type ExportItem = {
    // 作業ディレクトリ内の結果
    source: string;
    dest: string;
};

export type ExportResult = {
    outputs: string[];
    failed: { dest: string; error: string }[];
    cancelled: boolean;
};

// ---------------------------------------------------------------------------
// 実行環境とライブラリ (ダウンロード・削除)
// ---------------------------------------------------------------------------

export type VoicePlatformKey = 'win32-x64' | 'darwin-arm64' | 'linux-x64' | 'unsupported';

// PyTorch の CUDA 版の種類 (GPU の世代とドライバーで決める)
export type CudaFlavor = 'cu130' | 'cu128' | 'cu126';

export type GpuInfo = {
    kind: 'cuda' | 'mps' | 'none';
    name?: string;
    memoryMb?: number;
    cudaFlavor?: CudaFlavor | null;
    // NVIDIA GPU はあるがドライバーが古く CUDA 版を使えない
    driverUpdateRequired?: boolean;
};

export type VoicePlatformInfo = {
    platform: VoicePlatformKey;
    supported: boolean;
    // 非対応の理由 (supported = false の場合)
    unsupportedReason?: 'os' | 'arch' | 'macosVersion';
    gpu: GpuInfo;
    // Windows で Microsoft Visual C++ 再頒布可能パッケージが見つからない
    vcRuntimeMissing: boolean;
    // 読み上げのモデルの学習ができる環境か (NVIDIA GPU を使える Windows と Linux のみ)
    ttsTrainingAvailable: boolean;
    libraryDir: string;
    modelDir: string;
    // Windows でライブラリ・モデル・キャッシュ・作業ディレクトリのいずれかのパスに ASCII 以外の文字が含まれる
    // (一部のライブラリが扱えない)
    storageNonAscii: boolean;
};

type LibraryItemKind = 'python' | 'component' | 'model';
export type LibraryItemGroup = 'runtime' | 'separator' | 'converter' | 'tts';
// missing: 未取得 / installed: 取得済み / outdated: アプリの更新で取得し直しが必要 / broken: 不完全 (再取得が必要)
export type LibraryItemStatus = 'missing' | 'installed' | 'outdated' | 'broken';

export type SeparationCategory = 'vocals' | 'multi' | 'karaoke' | 'denoise' | 'dereverb' | 'other';
export type SeparationArch = 'MDX' | 'VR' | 'Demucs' | 'MDXC';

export type LibraryItem = {
    id: string;
    kind: LibraryItemKind;
    group: LibraryItemGroup;
    // 表示名 (翻訳キーまたはそのままの名前)
    nameKey?: string;
    name?: string;
    descriptionKey?: string;
    // 単体ファイルは配布元から得た大きさ、パッケージ一式は固定の目安
    sizeBytes: number | null;
    sizeEstimated: boolean;
    status: LibraryItemStatus;
    // 前提となる項目 (仮想環境は Python 本体を前提とするなど)
    requires: string[];
    // この項目を使う機能
    usedBy: VoiceFeatureId[];
    license?: { name: string; url?: string };
    source?: { name: string; url: string };
    // 表記が求められているクレジット
    credit?: string;
    // この環境で取得できるか
    available: boolean;
    unavailableReasonKey?: string;
    // すぐに使えるモデル (読み上げ) が読める言語
    readsLanguages?: VoiceLanguage[];
    separator?: {
        category: SeparationCategory;
        arch: SeparationArch;
        stems: string[];
        // 出力ごとの分離性能 (SDR)。分からない場合は空
        sdr: Record<string, number | null>;
    };
};

// 分離モデルの検証済みの組み合わせ (アンサンブル)。ダウンロードの画面で用途別のおすすめとして示す
export type SeparatorEnsembleInfo = {
    id: string;
    name: string;
    category: SeparationCategory;
    // 組み合わせるモデルの項目 ID
    models: string[];
};

export type LibraryStatus = {
    platform: VoicePlatformInfo;
    items: LibraryItem[];
    // 分離モデルの一覧があるか (分離のパッケージ一式の導入後に作る)
    separatorModelsListed: boolean;
    separatorEnsembles: SeparatorEnsembleInfo[];
};

type LibraryProgressState = 'waiting' | 'downloading' | 'installing' | 'done' | 'failed' | 'cancelled';

// ダウンロードの進捗 (JobEvent.payload で送る)
export type LibraryProgress = {
    itemId: string;
    state: LibraryProgressState;
    receivedBytes: number;
    totalBytes: number | null;
    // 処理中の内容 (ファイル名など。翻訳しない生の文字列)
    detail?: string;
};

export type LibraryItemResult = {
    id: string;
    ok: boolean;
    cancelled?: boolean;
    error?: string;
};

export type LibraryDownloadResult = {
    results: LibraryItemResult[];
    cancelled: boolean;
};

export type LibraryRemoveResult = {
    removed: string[];
    failed: { id: string; error: string }[];
};

// 機能を使う前の準備状況
export type FeatureReadiness = {
    ready: boolean;
    // 足りない項目 (ダウンロード画面で選択状態にして開く)
    missing: string[];
    platform: VoicePlatformInfo;
};

// ---------------------------------------------------------------------------
// 音声分離
// ---------------------------------------------------------------------------

export type SeparationModel = {
    // ライブラリの項目 ID
    itemId: string;
    filename: string;
    name: string;
    arch: SeparationArch;
    category: SeparationCategory;
    stems: string[];
    targetStem: string | null;
    // 出力ごとの分離性能 (SDR)。分からない場合は空
    sdr: Record<string, number | null>;
    installed: boolean;
};

export type VerifiedEnsemble = {
    itemId: string;
    id: string;
    name: string;
    models: string[];
    algorithm: string;
    category: SeparationCategory;
    installed: boolean;
};

export const ENSEMBLE_ALGORITHMS = [
    'avg_wave',
    'median_wave',
    'min_wave',
    'max_wave',
    'avg_fft',
    'median_fft',
    'min_fft',
    'max_fft',
    'uvr_max_spec',
    'uvr_min_spec',
] as const;
export type EnsembleAlgorithm = (typeof ENSEMBLE_ALGORITHMS)[number];

export type SeparationModelList = {
    models: SeparationModel[];
    ensembles: VerifiedEnsemble[];
};

type MdxParams = {
    segmentSize: number;
    overlap: number;
    batchSize: number;
    hopLength: number;
    enableDenoise: boolean;
};

type VrParams = {
    windowSize: number;
    aggression: number;
    enableTta: boolean;
    enablePostProcess: boolean;
    postProcessThreshold: number;
    highEndProcess: boolean;
    batchSize: number;
};

type DemucsParams = {
    // null = モデルの既定
    segmentSize: number | null;
    shifts: number;
    overlap: number;
    segmentsEnabled: boolean;
};

type MdxcParams = {
    segmentSize: number;
    overrideModelSegmentSize: boolean;
    // null = モデルの既定
    batchSize: number | null;
    // 重ねる窓の数 (整数)。null = モデルの既定
    overlap: number | null;
    pitchShift: number;
};

// アーキテクチャごとのパラメーター。選んだモデルのアーキテクチャの分だけ使う
export type SeparationParams = {
    mdx: MdxParams;
    vr: VrParams;
    demucs: DemucsParams;
    mdxc: MdxcParams;
};

export type SeparationMethod =
    | { kind: 'model'; filename: string }
    | { kind: 'verifiedEnsemble'; ensembleId: string }
    | { kind: 'ensemble'; filenames: string[]; algorithm: EnsembleAlgorithm }
    // 分岐の「その他」: 分離はせず、音を加工した 1 つの出力を作る (長さは変わらない。処理の順は、残響・エコーの除去 →
    // ノイズ除去 → 無音部分の雑音を消す → 音量をそろえる)
    | {
          kind: 'process';
          dereverb: DereverbOption;
          noiseRemoval: NoiseRemovalOption;
          muteSilence: SilenceOption;
          loudness: LoudnessOption;
      };

// 分岐の「その他」で指定する加工
export type SeparationOtherChoice = {
    dereverb: DereverbOption;
    noiseRemoval: NoiseRemovalOption;
    muteSilence: SilenceOption;
    loudness: LoudnessOption;
};

export type SeparationStem = {
    // モデルが出力した名前 (Vocals / Instrumental / drums など)
    name: string;
    media: MediaRef;
};

export type SeparationCandidate = {
    id: string;
    method: SeparationMethod;
    // 表示用の方式名 (モデル名など)
    methodLabel: string;
    // 実行時のパラメーター (使ったアーキテクチャの分だけ)
    params: Partial<SeparationParams>;
    // 出力。名前と順はモデルが返したまま
    stems: SeparationStem[];
    createdAt: number;
};

export type SeparationRunRequest = {
    // 作業の識別子 (中間ファイルの置き場所を分ける)
    workKey: string;
    input: string;
    // 元の音源のチャンネル数 (分離結果をこの構成に戻す)
    channels: number;
    method: SeparationMethod;
    params: SeparationParams;
};

// ---------------------------------------------------------------------------
// 音声変換
// ---------------------------------------------------------------------------

export type F0Method = 'rmvpe' | 'fcpe' | 'crepe' | 'crepe-tiny';
export const F0_METHODS: F0Method[] = ['rmvpe', 'fcpe', 'crepe', 'crepe-tiny'];

// 音声変換 (RVC) の学習回数 (エポック数)。初期値は Applio の初期値と同じ
export const RVC_TRAINING_EPOCHS = { default: 200, min: 100, max: 1000 };

export function isValidRvcEpochs(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= RVC_TRAINING_EPOCHS.min &&
        value <= RVC_TRAINING_EPOCHS.max
    );
}

export type ConversionParams = {
    // キーの変更量 (半音)
    pitch: number;
    f0Method: F0Method;
    // インデックスの効き具合 (0-1)
    indexRate: number;
    // 音量エンベロープの混合率 (0-1)
    volumeEnvelope: number;
    // 子音の保護の強さ (0-0.5)
    protect: number;
    // 変換前のボーカルの残響・エコーの除去 (変換後の声には残響がほぼ残らないため、変換の前に除く)
    dereverb: DereverbOption;
    // 無音部分の雑音を消す (変換前のボーカルが無音の部分で、変換後の音量を 0 にする。長さは変わらない)
    muteSilence: SilenceOption;
    // 変換後の声のノイズ除去
    noiseRemoval: NoiseRemovalOption;
};

export type ConversionCandidate = {
    id: string;
    voiceId: string;
    voiceName: string;
    params: ConversionParams;
    // 変換後のボーカル (モデルのサンプリング周波数のモノラル)
    vocals: MediaRef;
    // 合成で出力するチャンネル数 (元の音源がステレオなら 2。ボーカルは左右に同じ音を置いた中央定位にする)
    channels: number;
    // 変換後のボーカルと伴奏をそのまま重ねた試聴用の音。変換の段階で求められたときに作る (まだ無ければ null)
    withAccompaniment: MediaRef | null;
    createdAt: number;
};

export type ConversionRunRequest = {
    workKey: string;
    vocals: string;
    accompaniment: string | null;
    voiceId: string;
    params: ConversionParams;
};

export type ReverbParams = {
    enabled: boolean;
    // 部屋の大きさ (0-1)
    roomSize: number;
    // 高域の減衰 (0-1)
    damping: number;
    // 残響音の量 (0-1。音量の倍率)
    wetLevel: number;
    // 原音の量 (0-1。音量の倍率で、1 で元の大きさのまま)
    dryLevel: number;
    // ステレオの広がり (0-1)
    width: number;
};

export type MixParams = {
    vocalGainDb: number;
    accompanimentGainDb: number;
    masterGainDb: number;
    reverb: ReverbParams;
};

export type MixRenderRequest = {
    workKey: string;
    vocals: string;
    accompaniment: string | null;
    // 出力するチャンネル数 (候補の channels。伴奏がステレオなら伴奏に合わせて 2 にする)
    channels: number;
    // キーの変更量。オクターブ単位以外なら伴奏を同じだけ移調する
    pitch: number;
    // null は変換の段階の試聴用 (音量を変えず、リバーブなしでそのまま重ねる)
    params: MixParams | null;
};

// ---------------------------------------------------------------------------
// プリセット (分離のパラメーター・合成のパラメーター)
// ---------------------------------------------------------------------------

export type PresetKind = 'separation' | 'mix';

export type PresetRecord<T> = {
    id: string;
    name: string;
    // 初期のプリセットの表示名 (翻訳キー)。利用者が名前を変えるまでは name の代わりに使う
    nameKey?: string;
    // アプリが用意した初期のプリセット
    builtin: boolean;
    params: T;
};

// 分離の方式の選び方 (画面の選択の状態)。おすすめから 1 つを選ぶか、モデル (複数可) を選ぶ
export type SeparationMethodChoice = {
    // 選び方 (おすすめ / モデル / その他。null は、選べる選び方のうち先頭)
    mode: 'recommended' | 'model' | 'other' | null;
    // おすすめから選んだもの (`verified:<組み合わせの ID>` または `model:<ファイル名>`)
    recommended: string;
    // モデルの一覧から選んだもの (`model:<ファイル名>`)
    keys: string[];
    // 2 つ以上のモデルを選んだときの結果の決め方
    algorithm: EnsembleAlgorithm;
    // 「その他」で指定した加工 (無い場合は初期値)
    other?: SeparationOtherChoice;
};

// 分離のプリセット。方式の選び方 (おすすめ・組み合わせるモデル・組み合わせ方) と詳細な設定 (全アーキテクチャの
// パラメーター) を、1 つの条件としてまとめて保存する
export type SeparationPresetParams = {
    method: SeparationMethodChoice;
    params: SeparationParams;
};

// ---------------------------------------------------------------------------
// 声のモデル
// ---------------------------------------------------------------------------

// 声のモデルの区分。ユーザーモデル (user: 利用者がこのアプリで学習して作ったモデル) と、
// 既存モデル (existing: それ以外。ダウンロードしたもの・取り込んだもの) の 2 つだけを区別する
export type VoiceModelOrigin = 'user' | 'existing';

export type RvcModelMeta = {
    version: string;
    sampleRate: number;
    f0: boolean;
    vocoder: string;
    embedder: string;
    speakers: number;
    hasIndex: boolean;
};

export type TtsModelMeta = {
    modelType: TtsModelType;
    languages: VoiceLanguage[];
    styles: string[];
    speakers: string[];
    // モデルの形式のバージョン (config.json の version)
    version: string;
};

export type VoiceModelInfo = {
    id: string;
    feature: VoiceModelFeature;
    name: string;
    origin: VoiceModelOrigin;
    createdAt: number;
    // ダウンロードして使うモデル (すぐに使えるモデル) の元になったダウンロード項目と、配布時の名前
    // (name が空の間はこれから表示名を作る)。区分ではなく、保存のされ方 (ダウンロードの記録で管理する) の違いを表す
    readyItemId?: string;
    distributedName?: string;
    rvc?: RvcModelMeta;
    tts?: TtsModelMeta;
};

// 取り込みの候補になったファイル
export type ImportCandidate = {
    path: string;
    // 表示名 (選んだフォルダ・zip の中での位置)
    label: string;
};

// 外部で入手したモデルの取り込みで、モデルを構成するファイルの候補と、選んでいるもの。
// 候補が複数ある場合は確認画面で選ぶ
export type ImportChoices = {
    // モデルのファイル (変換: .pth、読み上げ: .safetensors)
    models: ImportCandidate[];
    model: string;
    // 変換のインデックス (.index)。候補が無い場合は空で、選んでいるものは null
    indexes: ImportCandidate[];
    index: string | null;
};

// 取り込み前の検査結果
export type ImportInspection = {
    // 確定 (commitImport) に渡す識別子
    token: string;
    // kura: 本アプリで書き出したファイル / external: 外部で入手したモデル
    source: 'kura' | 'external';
    suggestedName: string;
    origin: VoiceModelOrigin;
    // 安全な方式で読み込めたか。false の場合は利用者の許可が必要
    safe: boolean;
    unsafeDetail?: string;
    rvc?: RvcModelMeta;
    tts?: TtsModelMeta;
    // 外部で入手したモデルのファイルの候補と、選んでいるもの (本アプリで書き出したファイルには無い)
    choices?: ImportChoices;
};

// ---------------------------------------------------------------------------
// 読み上げ
// ---------------------------------------------------------------------------

export type TtsParams = {
    style: string;
    styleWeight: number;
    // 話速 (1 = 標準。大きいほど速い)
    speed: number;
    // 音の高さの倍率 (1 = 標準)
    pitchScale: number;
    // 抑揚の倍率 (1 = 標準)
    intonationScale: number;
    sdpRatio: number;
    noise: number;
    noiseW: number;
    speakerId: number;
    // 改行 (段落) の間の無音 (秒)
    paragraphPause: number;
};

// 合成音声が字幕の区間に収まらない場合の扱い
export type TimelineOverflowMode = 'speedup' | 'overlap' | 'shift' | 'warn';

// 読み上げの入力方法。normal: 制御タグを含む文章 / timed: 行ごとに開始時間・終了時間・テキストを指定する表 (タイミング指定)
export type TtsInputMode = 'normal' | 'timed';

// タイミング指定の 1 行 (時間は秒)。テキストは複数行でもよく、制御タグを含められる
export type TimedLine = {
    start: number;
    end: number;
    text: string;
};

export type TtsRunRequest = {
    workKey: string;
    modelType: TtsModelType;
    language: VoiceLanguage;
    voiceId: string;
    params: TtsParams;
    readSymbols: boolean;
    symbolReadings: SymbolReading[];
    inputMode: TtsInputMode;
    // 通常の入力の文章 (inputMode = normal)
    text: string;
    // タイミング指定の行 (inputMode = timed)
    lines: TimedLine[];
    // 行の時間内に収まらない場合の扱い (全体。行ごとには、その行の fit タグで変える)
    overflowMode: TimelineOverflowMode;
    // 話速の閾値を超える区間の確認を済ませた場合の確認 ID
    confirmationToken?: string;
};

// 閾値 (1.3 倍) を超えて話速を上げる区間の確認
export type SpeedupConfirmation = {
    token: string;
    items: { index: number; start: number; end: number; text: string; factor: number }[];
};

// 読み上げで作成した音声 (作成し直すと置き換える)
export type TtsAudio = {
    id: string;
    voiceId: string;
    voiceName: string;
    modelType: TtsModelType;
    language: VoiceLanguage;
    params: TtsParams;
    media: MediaRef;
    // 話速を調整した区間 (タイムライン)
    adjusted: { index: number; factor: number }[];
    // 区間に収まらなかった区間 (警告のみの場合。「重ねる」は置き方が同じで知らせない)
    overflows: { index: number; overflowSec: number }[];
    createdAt: number;
};

export type TtsRunResult =
    | { status: 'done'; audio: TtsAudio }
    | { status: 'needsConfirmation'; confirmation: SpeedupConfirmation }
    | { status: 'invalid'; errors: TagIssue[]; fixes: TagFix[] };

// ---------------------------------------------------------------------------
// 学習
// ---------------------------------------------------------------------------

// 学習セット (学習用の音声に名前を付けて残したもの)。声のモデルの機能ごとに持つ。
// 読み上げの学習セットは言語を 1 つ持ち、その言語の読み上げ文の文ごとに音声を 1 つ持てる
// 読み上げの学習セットの作り方。sentences: サンプル文から作成 (言語の学習用の文章の文ごとに音声を指定する)。
// custom: 任意の文で作成 (音声と本文の組 (グループ) を利用者が並べる)。作成した後は変えない
export type TrainingSetMode = 'sentences' | 'custom';
export const TRAINING_SET_MODES: TrainingSetMode[] = ['sentences', 'custom'];

export type TrainingSetSummary = {
    id: string;
    feature: VoiceModelFeature;
    name: string;
    // 読み上げの学習セットの言語 (音声変換の学習セットには無い)
    language?: VoiceLanguage;
    // 読み上げの学習セットの作り方 (音声変換の学習セットには無い)
    mode?: TrainingSetMode;
    // 音声の数と合計の長さ
    audioCount: number;
    durationSec: number;
    createdAt: number;
    updatedAt: number;
};

// 学習セットの音声。録音も指定したファイルも、学習セットの中に同じ形式の WAV として保存したもの
export type TrainingAudio = {
    id: string;
    // 表示名 (録音は録音した日時、ファイルは元のファイル名)
    name: string;
    source: 'recording' | 'file';
    // 読み上げの学習セットで、この音声を読み上げた文の ID
    sentenceId?: string;
    durationSec: number;
    media: MediaRef;
};

// 音声ファイルを学習セットに加えた結果。skipped は、学習セットにすでに同じ名前の音声があるため加えなかったファイルの名前
// (同じ名前のファイルを加えるのは誤った操作とみなす)
export type TrainingAddFilesResult = {
    added: TrainingAudio[];
    skipped: string[];
};

// 読み上げの学習用の文 (言語の読み上げ文)
export type TrainingSentence = {
    id: string;
    text: string;
};

export type TrainingSetDetail = {
    summary: TrainingSetSummary;
    audios: TrainingAudio[];
    // 読み上げの学習セットの文。サンプル文から作成する学習セットは言語の学習用の文章、任意の文で作成する学習セットは
    // グループ (id と本文。並びは利用者が加えた順)。音声変換の学習セットでは空。音声は sentenceId で文に結び付く
    sentences: TrainingSentence[];
};

export type TrainingStage = 'prepare' | 'preprocess' | 'extract' | 'train' | 'index' | 'finalize';

// 音声機能の処理の段階 (jobPhases.<id> の文言で示す)
export type VoicePhaseId =
    | 'prepare'
    | 'decodeInput'
    | 'loadModel'
    | 'separate'
    | 'finishStems'
    | 'convert'
    | 'loudness'
    | 'silence'
    | 'noiseRemoval'
    | 'dereverb'
    | 'pitchShift'
    | 'mix'
    | 'synthesize'
    | 'stretch'
    | 'assemble'
    | 'encode'
    | `training.${TrainingStage}`;
