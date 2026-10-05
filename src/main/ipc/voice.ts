import { ipcMain, shell, systemPreferences } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { renderMix, runConversion } from '../services/voice/conversion';
import { hasRubberband } from '../services/voice/audio-tools';
import { existingPaths, exportAudio } from '../services/voice/exporter';
import {
    checkFeature,
    downloadItems,
    getLibraryStatus,
    getPendingUpdates,
    markUpdatePrompted,
    removeItems,
} from '../services/voice/library';
import { getPlatformInfo } from '../services/voice/platform';
import { listPresets, removePreset, renamePreset, savePreset, type PresetParams } from '../services/voice/presets';
import { probeSeparatorSizes, refreshSeparatorModelList } from '../services/voice/separator-models';
import {
    discardPaths,
    discardWork,
    listSeparationModels,
    mixStems,
    prepareInput,
    runSeparation,
} from '../services/voice/separation';
import { loadTextFile, saveTextFile } from '../services/voice/text-files';
import { mediaRef } from '../services/voice/media';
import { isInsideWorkRoot } from '../services/work-dir';
import {
    addRvcFiles,
    addRvcRecording,
    clearRvcDataset,
    clearTtsDraft,
    getRvcDataset,
    getTtsDraft,
    setTtsSentenceFile,
    removeRvcItem,
    removeTtsRecording,
    saveTtsRecording,
    startRvcTraining,
    startTtsTraining,
} from '../services/voice/training';
import { cancelTtsConfirmation, runTts } from '../services/voice/tts';
import {
    cancelImport,
    chooseImportFiles,
    commitImport,
    exportVoice,
    hubSearchUrl,
    inspectImport,
    listVoices,
    removeVoice,
    renameVoice,
    setVoiceLanguages,
} from '../services/voice/voice-models';
import { isVoiceLanguage, type CorpusSetId, type TtsEngineId, type VoiceLanguage } from '../../shared/voice/languages';
import type {
    AudioExportSettings,
    ConversionRunRequest,
    ExportItem,
    MixRenderRequest,
    PresetKind,
    SeparationRunRequest,
    TtsRunRequest,
    VoiceFeatureId,
    VoiceModelFeature,
} from '../../shared/voice/types';

// 外部ブラウザで開く URL は https に限る (ライセンス・配布元・モデル検索のリンク)
function openHttps(url: string): Promise<void> {
    if (!/^https:\/\//i.test(url)) throw new Error('INVALID_URL');
    return shell.openExternal(url);
}

// renderer から渡された言語を確かめる (言語ごとの定義を引いて処理するため、未知の値は受け付けない)
function checkLanguage(value: unknown): VoiceLanguage {
    if (typeof value !== 'string' || !isVoiceLanguage(value)) throw new Error(`INVALID_LANGUAGE: ${String(value)}`);
    return value;
}

function checkLanguages(values: unknown): VoiceLanguage[] {
    if (!Array.isArray(values)) throw new Error(`INVALID_LANGUAGE: ${String(values)}`);
    return values.map(value => checkLanguage(value));
}

// renderer から渡された学習用の文章の種類を確かめる (録音の保存先のフォルダ名に使うため、決まった値に限る)
function checkCorpusSet(value: unknown): CorpusSetId {
    if (value !== 'quick' && value !== 'accurate') throw new Error(`INVALID_CORPUS_SET: ${String(value)}`);
    return value;
}

export function registerVoiceIpcHandlers() {
    // --- ライブラリ (ダウンロード・削除) ---
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_STATUS, () => getLibraryStatus());
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_REFRESH_PLATFORM, async () => {
        await getPlatformInfo(true);
        return getLibraryStatus();
    });
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_CHECK_FEATURE, (_e, feature: VoiceFeatureId, extra?: string[]) =>
        checkFeature(feature, extra)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_DOWNLOAD, (_e, jobId: string, ids: string[]) =>
        downloadItems(jobId, ids)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_REMOVE, (_e, ids: string[], options?: { removePython?: boolean }) =>
        removeItems(ids, options)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_REFRESH_SEPARATOR, async () => {
        await refreshSeparatorModelList();
        void probeSeparatorSizes().catch(error => console.warn('failed to look up separation model sizes', error));
        return getLibraryStatus();
    });
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_PROBE_SIZES, async () => {
        await probeSeparatorSizes();
        return getLibraryStatus();
    });
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_PENDING_UPDATES, () => getPendingUpdates());
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_MARK_PROMPTED, () => markUpdatePrompted());
    ipcMain.handle(IPC_CHANNELS.VOICE_OPEN_EXTERNAL, (_e, url: string) => openHttps(url));
    ipcMain.handle(IPC_CHANNELS.VOICE_REQUEST_MICROPHONE, async () => {
        // macOS ではマイクの利用を OS に許可してもらう必要がある (他の OS は録音開始時にブラウザ側で扱う)
        if (process.platform !== 'darwin') return true;
        if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
        return systemPreferences.askForMediaAccess('microphone');
    });

    // --- 入力・作業の結果 ---
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_PREPARE, (_e, jobId: string, workKey: string, sourcePath: string) =>
        prepareInput(jobId, workKey, sourcePath)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_MEDIA_MIX,
        (_e, jobId: string, workKey: string, paths: string[], channels: number) =>
            mixStems(jobId, workKey, paths, channels)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_DISCARD, (_e, paths: string[]) => discardPaths(paths));
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_DISCARD_WORK, (_e, workKey: string) => discardWork(workKey));
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_REF, (_e, filePath: string) => {
        // 任意のファイルを公開しないよう、作業ディレクトリ内のものに限る
        if (!isInsideWorkRoot(filePath)) throw new Error('INVALID_PATH');
        return mediaRef(filePath);
    });

    // --- 分離 ---
    ipcMain.handle(IPC_CHANNELS.VOICE_SEPARATION_MODELS, (_e, refresh?: boolean) => listSeparationModels(refresh));
    ipcMain.handle(IPC_CHANNELS.VOICE_SEPARATION_RUN, (_e, jobId: string, request: SeparationRunRequest) =>
        runSeparation(jobId, request)
    );

    // --- 変換 ---
    ipcMain.handle(IPC_CHANNELS.VOICE_CONVERSION_RUN, (_e, jobId: string, request: ConversionRunRequest) =>
        runConversion(jobId, request)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_CONVERSION_MIX, (_e, jobId: string, request: MixRenderRequest) =>
        renderMix(jobId, request)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_RUBBERBAND, () => hasRubberband());

    // --- 読み上げ ---
    ipcMain.handle(IPC_CHANNELS.VOICE_TTS_RUN, (_e, jobId: string, request: TtsRunRequest) =>
        runTts(jobId, { ...request, language: checkLanguage(request.language) })
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TTS_CANCEL_CONFIRMATION, (_e, token: string) => cancelTtsConfirmation(token));
    ipcMain.handle(IPC_CHANNELS.VOICE_TTS_LOAD_TEXT, (_e, filePath: string) => loadTextFile(filePath));
    ipcMain.handle(IPC_CHANNELS.VOICE_TTS_SAVE_TEXT, (_e, filePath: string, text: string) =>
        saveTextFile(filePath, text)
    );

    // --- 声のモデル ---
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_LIST, (_e, feature: VoiceModelFeature) => listVoices(feature));
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_RENAME, (_e, feature: VoiceModelFeature, id: string, name: string) =>
        renameVoice(feature, id, name)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_SET_LANGUAGES, (_e, id: string, languages: unknown) =>
        setVoiceLanguages(id, checkLanguages(languages))
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_REMOVE, (_e, feature: VoiceModelFeature, id: string) =>
        removeVoice(feature, id)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_EXPORT, (_e, feature: VoiceModelFeature, id: string, dest: string) =>
        exportVoice(feature, id, dest)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_INSPECT_IMPORT, (_e, feature: VoiceModelFeature, paths: string[]) =>
        inspectImport(feature, paths)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_MODELS_COMMIT_IMPORT,
        (_e, token: string, options: { name: string; allowUnsafe: boolean; languages?: unknown }) =>
            commitImport(token, {
                name: options.name,
                allowUnsafe: options.allowUnsafe,
                languages: options.languages === undefined ? undefined : checkLanguages(options.languages),
            })
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_CANCEL_IMPORT, (_e, token: string) => cancelImport(token));
    ipcMain.handle(
        IPC_CHANNELS.VOICE_MODELS_CHOOSE_IMPORT_FILES,
        (_e, token: string, model: string, index: string | null) => chooseImportFiles(token, model, index)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MODELS_OPEN_HUB, (_e, feature: VoiceModelFeature) =>
        openHttps(hubSearchUrl(feature))
    );

    // --- プリセット ---
    ipcMain.handle(IPC_CHANNELS.VOICE_PRESETS_LIST, (_e, kind: PresetKind) => listPresets(kind));
    ipcMain.handle(
        IPC_CHANNELS.VOICE_PRESETS_SAVE,
        (_e, kind: PresetKind, preset: { id?: string; name: string; params: PresetParams }) => savePreset(kind, preset)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_PRESETS_RENAME, (_e, kind: PresetKind, id: string, name: string) =>
        renamePreset(kind, id, name)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_PRESETS_REMOVE, (_e, kind: PresetKind, id: string) => removePreset(kind, id));

    // --- 学習 ---
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_DATASET, () => getRvcDataset());
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_ADD_FILES, (_e, jobId: string, paths: string[]) =>
        addRvcFiles(jobId, paths)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_ADD_RECORDING, (_e, wav: Uint8Array, name: string) =>
        addRvcRecording(wav, name)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_REMOVE, (_e, id: string) => removeRvcItem(id));
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_CLEAR, () => clearRvcDataset());
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_START, (_e, jobId: string, name: string) =>
        startRvcTraining(jobId, name)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_TTS_DRAFT, (_e, language: unknown, set: unknown) =>
        getTtsDraft(checkLanguage(language), checkCorpusSet(set))
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_TTS_SAVE_RECORDING,
        (_e, language: unknown, set: unknown, sentenceId: string, wav: Uint8Array) =>
            saveTtsRecording(checkLanguage(language), checkCorpusSet(set), sentenceId, wav)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_TTS_SET_FILE,
        (_e, jobId: string, language: unknown, set: unknown, sentenceId: string, source: string) =>
            setTtsSentenceFile(jobId, checkLanguage(language), checkCorpusSet(set), sentenceId, source)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_TTS_REMOVE, (_e, language: unknown, set: unknown, sentenceId: string) =>
        removeTtsRecording(checkLanguage(language), checkCorpusSet(set), sentenceId)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_TTS_CLEAR, (_e, language: unknown, set: unknown) =>
        clearTtsDraft(checkLanguage(language), checkCorpusSet(set))
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_TTS_START,
        (_e, jobId: string, options: { language: unknown; corpusSet: unknown; engine: TtsEngineId; name: string }) =>
            startTtsTraining(jobId, {
                ...options,
                language: checkLanguage(options.language),
                corpusSet: checkCorpusSet(options.corpusSet),
            })
    );

    // --- 書き出し ---
    ipcMain.handle(
        IPC_CHANNELS.VOICE_EXPORT_RUN,
        (_e, jobId: string, items: ExportItem[], settings: AudioExportSettings) => exportAudio(jobId, items, settings)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_EXPORT_EXISTING, (_e, paths: string[]) => existingPaths(paths));
}
