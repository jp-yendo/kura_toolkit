import type {
    AppInfo,
    AppLanguage,
    AppSettings,
    AppTheme,
    AudioAnalyzeResult,
    AudioProbeItem,
    AudioNormalizeInput,
    AudioNormalizeResult,
    AudioNormalizerSettings,
    AudioOutputCheck,
    AudioOutputFormat,
    ChapterCutRequest,
    ChapterJobResult,
    ChapterOutputCheck,
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
    SvgResult,
    JobEvent,
    SettingsLoadError,
    SettingsUpdateResult,
    MovableStorageKind,
    StorageInfo,
    StorageMoveDecisions,
    StorageMovePlan,
    StorageMoveResult,
    UpdateState,
    VectorizeParams,
} from './types';
import type { TtsModelType, VoiceLanguage } from './voice/languages';
import type {
    AudioExportSettings,
    ConversionCandidate,
    ConversionRunRequest,
    ExportItem,
    ExportResult,
    FeatureReadiness,
    ImportInspection,
    LibraryDownloadResult,
    LibraryItem,
    LibraryRemoveResult,
    LibraryStatus,
    MediaRef,
    MixParams,
    MixRenderRequest,
    WaveformData,
    PreparedInput,
    PresetKind,
    PresetRecord,
    SeparationCandidate,
    SeparationModelList,
    SeparationPresetParams,
    SeparationRunRequest,
    TtsRunRequest,
    TtsRunResult,
    TrainingAddFilesResult,
    TrainingAudio,
    TrainingSetDetail,
    TrainingSetSummary,
    VoiceFeatureId,
    VoiceModelFeature,
    VoiceModelInfo,
} from './voice/types';

import type { SilenceOption, TrainingFilterOptions } from './voice/audio-filters';
import type { AudioFormat } from './audio-format';

export type VoicePresetParams = SeparationPresetParams | MixParams;

// 音声分離・音声変換・読み上げの API
export type VoiceApi = {
    library: {
        getStatus(): Promise<LibraryStatus>;
        // GPU やドライバーを検出し直す
        refreshPlatform(): Promise<LibraryStatus>;
        checkFeature(feature: VoiceFeatureId, extra?: string[]): Promise<FeatureReadiness>;
        download(jobId: string, ids: string[]): Promise<LibraryDownloadResult>;
        remove(ids: string[], options?: { removePython?: boolean }): Promise<LibraryRemoveResult>;
        // 分離モデルの一覧が無ければ作る (パッケージ一式の導入後)
        ensureSeparatorModelList(): Promise<LibraryStatus>;
        probeSeparatorSizes(): Promise<LibraryStatus>;
        getPendingUpdates(): Promise<{ items: LibraryItem[]; promptNeeded: boolean }>;
        markUpdatePrompted(): Promise<void>;
    };
    // https の URL を外部ブラウザで開く (ライセンス・配布元など)
    openExternal(url: string): Promise<void>;
    // 開いている機能 (画面の経路の先頭 2 つ) を知らせる。その機能で使わない Python の処理役を止める
    setFeature(feature: string | null): Promise<void>;
    // マイクの利用許可 (macOS)
    requestMicrophone(): Promise<boolean>;
    // マイク録音の書き込み (16bit・モノラルの PCM を少しずつ送り、main が作業ディレクトリの WAV へ追記する)
    recording: {
        begin(sampleRate: number): Promise<string>;
        append(id: string, pcm: Uint8Array): Promise<void>;
        // 書き込みを終える (その後 trainingSets.addRecording に渡す)
        finish(id: string): Promise<void>;
        // 使わなくなった録音を片付ける
        discard(id: string): Promise<void>;
    };
    media: {
        prepareInput(jobId: string, workKey: string, sourcePath: string): Promise<PreparedInput>;
        mix(jobId: string, workKey: string, paths: string[], channels: number): Promise<MediaRef>;
        // その作業の置き場の中のものに限る
        discard(workKey: string, paths: string[]): Promise<void>;
        discardWork(workKey: string): Promise<void>;
        // 作業ディレクトリ内の音声を再生できるようにする
        ref(workKey: string, path: string): Promise<MediaRef>;
        // 再生用の URL で公開している音声の波形
        waveform(url: string): Promise<WaveformData>;
    };
    separation: {
        listModels(): Promise<SeparationModelList>;
        run(jobId: string, request: SeparationRunRequest): Promise<SeparationCandidate>;
    };
    conversion: {
        run(jobId: string, request: ConversionRunRequest): Promise<ConversionCandidate>;
        renderMix(jobId: string, request: MixRenderRequest): Promise<MediaRef>;
        hasRubberband(): Promise<boolean>;
    };
    tts: {
        run(jobId: string, request: TtsRunRequest): Promise<TtsRunResult>;
        cancelConfirmation(token: string): Promise<void>;
        // 文章ファイルの内容 (改行は LF)
        // language: 読み上げの言語 (文字コードを見分けられないときの手がかり)
        loadText(path: string, language?: VoiceLanguage): Promise<string>;
        saveText(path: string, text: string): Promise<void>;
    };
    models: {
        list(feature: VoiceModelFeature): Promise<VoiceModelInfo[]>;
        rename(feature: VoiceModelFeature, id: string, name: string): Promise<VoiceModelInfo>;
        setLanguages(id: string, languages: VoiceLanguage[]): Promise<VoiceModelInfo>;
        remove(feature: VoiceModelFeature, id: string): Promise<void>;
        export(feature: VoiceModelFeature, id: string, destPath: string): Promise<void>;
        inspectImport(feature: VoiceModelFeature, paths: string[]): Promise<ImportInspection>;
        commitImport(
            token: string,
            options: { name: string; allowUnsafe: boolean; languages?: VoiceLanguage[] }
        ): Promise<VoiceModelInfo>;
        cancelImport(token: string): Promise<void>;
        // 外部で入手したモデルの取り込みで、確認画面で選び直したファイルで調べ直す
        chooseImportFiles(token: string, model: string, index: string | null): Promise<ImportInspection>;
        openHubSearch(feature: VoiceModelFeature): Promise<void>;
    };
    presets: {
        list(kind: PresetKind): Promise<PresetRecord<VoicePresetParams>[]>;
        save(
            kind: PresetKind,
            preset: { id?: string; name: string; params: VoicePresetParams }
        ): Promise<PresetRecord<VoicePresetParams>[]>;
        rename(kind: PresetKind, id: string, name: string): Promise<PresetRecord<VoicePresetParams>[]>;
        remove(kind: PresetKind, id: string): Promise<PresetRecord<VoicePresetParams>[]>;
    };
    trainingSets: {
        list(feature: VoiceModelFeature): Promise<TrainingSetSummary[]>;
        get(feature: VoiceModelFeature, id: string): Promise<TrainingSetDetail>;
        // 読み上げの学習セットは言語を指定し、音声変換の学習セットは指定しない
        create(feature: VoiceModelFeature, name: string, language?: VoiceLanguage): Promise<TrainingSetSummary>;
        rename(feature: VoiceModelFeature, id: string, name: string): Promise<TrainingSetSummary>;
        // ごみ箱に移す
        remove(feature: VoiceModelFeature, id: string): Promise<void>;
        // recording.finish を終えた録音を加える (録音のファイルは学習セットへ移す)
        addRecording(
            feature: VoiceModelFeature,
            id: string,
            recordingId: string,
            target: { name: string; sentenceId?: string }
        ): Promise<TrainingAudio>;
        // 読み上げの学習セットでは、文を指定してファイルを 1 つ渡す
        addFiles(
            jobId: string,
            feature: VoiceModelFeature,
            id: string,
            paths: string[],
            sentenceId?: string
        ): Promise<TrainingAddFilesResult>;
        removeAudio(feature: VoiceModelFeature, id: string, audioId: string): Promise<void>;
        // 学習用の音のフィルター: 個々の音に加工をかけた結果を作る (作業 workKey の中。確定するまで学習セットは変えない)
        filterAudio(
            jobId: string,
            feature: VoiceModelFeature,
            id: string,
            audioId: string,
            workKey: string,
            options: TrainingFilterOptions
        ): Promise<{ media: MediaRef; durationSec: number }>;
        // 個々の音のフィルターの確定: 選んだ結果 (result) で学習セットの音を置き換える
        replaceAudio(
            feature: VoiceModelFeature,
            id: string,
            audioId: string,
            workKey: string,
            result: string
        ): Promise<TrainingAudio>;
        // 学習セットのすべての音に同じ加工をかけて置き換える
        filterAll(jobId: string, feature: VoiceModelFeature, id: string, options: TrainingFilterOptions): Promise<void>;
        // 学習前の確かめ: 音ごとの、無音部分の長さの合計 (秒)
        silenceReport(
            feature: VoiceModelFeature,
            id: string,
            option: SilenceOption
        ): Promise<{ audioId: string; silenceSec: number }[]>;
    };
    training: {
        rvcStart(jobId: string, setId: string, name: string): Promise<VoiceModelInfo>;
        ttsStart(
            jobId: string,
            options: { setId: string; modelType: TtsModelType; name: string }
        ): Promise<VoiceModelInfo>;
    };
    export: {
        run(jobId: string, workKey: string, items: ExportItem[], settings: AudioExportSettings): Promise<ExportResult>;
        existing(paths: string[]): Promise<string[]>;
    };
};

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
    // ウィンドウを閉じる前の問い合わせ (保存していない入力があれば確認するため)。戻り値は登録解除関数
    onCloseRequested(listener: () => void): () => void;
    // 閉じてよいことを伝え、ウィンドウを閉じる
    confirmClose(): Promise<void>;
    // 永続設定
    settings: {
        get(): Promise<AppSettings>;
        // 保存に失敗しても起動中の設定は更新され、理由が saveError で返る
        update(patch: DeepPartial<AppSettings>): Promise<SettingsUpdateResult>;
        // 設定ファイルを読み込めなかった場合の内容 (読み込めた場合は null)
        getLoadError(): Promise<SettingsLoadError | null>;
        // 読み込めなかった設定ファイルを別の名前で残し、既定の設定で保存し直す。残した場所を返す
        resetBroken(): Promise<string>;
    };
    // 保存場所 (ライブラリ・モデル・キャッシュ・作業ディレクトリ)
    storage: {
        getInfo(): Promise<StorageInfo>;
        // ライブラリ・モデル・キャッシュディレクトリの中身を選んだフォルダへ移動し (中身がある場合はまとまりごとにマージする)、
        // そのフォルダを新しい場所にする (進捗は job:event)。targetDir が null の場合は既定の場所へ戻す
        move(
            jobId: string,
            kind: MovableStorageKind,
            targetDir: string | null,
            decisions: StorageMoveDecisions
        ): Promise<StorageMoveResult>;
        // 作業ディレクトリの場所を変える (空文字で既定に戻す)
        setWorkDir(dir: string): Promise<StorageInfo>;
        // 要らなくなった一時ファイルを消す (機能の画面に入ったとき。完了は待たない)
        cleanupWork(): Promise<void>;
        // 移動を始める前に、移動先を選べるかを確かめ、両方にあるまとまり (上書きするかを選ぶもの) を求める
        planMove(kind: MovableStorageKind, targetDir: string | null): Promise<StorageMovePlan>;
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
    // ファイルの列挙
    files: {
        // 渡されたパスのうちディレクトリは配下を再帰的に展開し、
        // 拡張子 (小文字・ドット無し) が一致するファイルだけを返す
        collect(paths: string[], extensions: string[]): Promise<string[]>;
    };
    // 長時間ジョブの制御
    jobs: {
        cancel(jobId: string): Promise<void>;
        // ジョブイベントの購読 (戻り値は購読解除関数)
        onEvent(listener: (event: JobEvent) => void): () => void;
    };
    // オーディオ正規化
    audio: {
        // 一覧に加えたファイルの長さとチャンネル数
        probe(files: string[]): Promise<AudioProbeItem[]>;
        // durations は files と同じ順の長さ (秒。分からないものは null)。全体の進み具合の配分に使う
        analyze(jobId: string, files: string[], durations: (number | null)[]): Promise<AudioAnalyzeResult>;
        normalize(
            jobId: string,
            inputs: AudioNormalizeInput[],
            options: AudioNormalizerSettings
        ): Promise<AudioNormalizeResult>;
        // 実行前の出力先チェック (上書きになるファイルと、出力パスの重複)
        checkOutputs(files: string[], outputDir: string, format: AudioOutputFormat): Promise<AudioOutputCheck>;
        // 使っている ffmpeg で書き出せる形式 (オーディオ正規化と音声機能の書き出しで使う)
        formats(): Promise<AudioFormat[]>;
    };
    // チャプターカット
    chapter: {
        probe(input: string): Promise<ChapterProbeResult>;
        cut(jobId: string, request: ChapterCutRequest): Promise<ChapterJobResult>;
        split(jobId: string, request: ChapterSplitRequest): Promise<ChapterJobResult>;
        // 実行前の出力先チェック (生成される出力パスと、そのうち上書きになるもの)
        checkCut(request: ChapterCutRequest): Promise<ChapterOutputCheck>;
        checkSplit(request: ChapterSplitRequest): Promise<ChapterOutputCheck>;
    };
    // 画像 SVG 変換
    vectorizer: {
        loadImage(path: string): Promise<ImagePreview>;
        convert(path: string, params: VectorizeParams): Promise<SvgResult>;
        // 変換結果 (resultId) を path へ保存する
        saveSvg(resultId: string, path: string): Promise<void>;
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
    // 音声分離・音声変換・読み上げ
    voice: VoiceApi;
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
