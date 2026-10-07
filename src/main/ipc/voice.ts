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
    isComponentCurrent,
    markUpdatePrompted,
    removeItems,
} from '../services/voice/library';
import { getPlatformInfo } from '../services/voice/platform';
import { setVoiceFeature } from '../services/voice/python-worker';
import {
    sanitizeSilenceOption,
    sanitizeTrainingFilterOptions,
    type SilenceOption,
    type TrainingFilterOptions,
} from '../../shared/voice/audio-filters';
import { listPresets, removePreset, renamePreset, savePreset, type PresetParams } from '../services/voice/presets';
import { ensureSeparatorModelList, probeSeparatorSizes } from '../services/voice/separator-models';
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
import { mediaWaveform } from '../services/voice/waveform';
import { appendRecording, beginRecording, discardRecording, finishRecording } from '../services/voice/recording';
import { isInsideWork } from '../services/work-dir';
import { startRvcTraining, startTtsTraining } from '../services/voice/training';
import {
    addTrainingFiles,
    addTrainingRecording,
    createTrainingSet,
    getTrainingSet,
    listTrainingSets,
    removeTrainingAudio,
    filterTrainingAudio,
    replaceTrainingAudio,
    filterTrainingSet,
    trainingSilenceReport,
    removeTrainingSet,
    renameTrainingSet,
} from '../services/voice/training-sets';
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
import { isVoiceLanguage, type TtsModelType, type VoiceLanguage } from '../../shared/voice/languages';
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

// renderer から渡された声のモデルの機能を確かめる (保存先のフォルダ名に使うため、決まった値に限る)
function checkFeatureId(value: unknown): VoiceModelFeature {
    if (value !== 'converter' && value !== 'tts') throw new Error(`INVALID_FEATURE: ${String(value)}`);
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
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_ENSURE_SEPARATOR_LIST, async () => {
        // 更新が必要なパッケージ一式 (古い版) では一覧を作らない (古い版の一覧を新しい版のものとして残さないため)
        if (await isComponentCurrent('separator')) await ensureSeparatorModelList();
        return getLibraryStatus();
    });
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_PROBE_SIZES, async () => {
        await probeSeparatorSizes();
        return getLibraryStatus();
    });
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_PENDING_UPDATES, () => getPendingUpdates());
    ipcMain.handle(IPC_CHANNELS.VOICE_LIBRARY_MARK_PROMPTED, () => markUpdatePrompted());
    ipcMain.handle(IPC_CHANNELS.VOICE_OPEN_EXTERNAL, (_e, url: string) => openHttps(url));
    ipcMain.handle(IPC_CHANNELS.VOICE_SET_FEATURE, (_e, feature: string | null) =>
        setVoiceFeature(typeof feature === 'string' ? feature : null)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_RECORDING_BEGIN, (_e, sampleRate: number) => beginRecording(sampleRate));
    ipcMain.handle(IPC_CHANNELS.VOICE_RECORDING_APPEND, (_e, id: string, pcm: Uint8Array) => appendRecording(id, pcm));
    ipcMain.handle(IPC_CHANNELS.VOICE_RECORDING_FINISH, (_e, id: string) => finishRecording(id));
    ipcMain.handle(IPC_CHANNELS.VOICE_RECORDING_DISCARD, (_e, id: string) => discardRecording(id));
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
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_DISCARD, (_e, workKey: string, paths: string[]) =>
        discardPaths(workKey, paths)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_DISCARD_WORK, (_e, workKey: string) => discardWork(workKey));
    // 公開している URL のものに限る (公開していない URL は INVALID_PATH)
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_WAVEFORM, (_e, url: string) => mediaWaveform(url));
    ipcMain.handle(IPC_CHANNELS.VOICE_MEDIA_REF, (_e, workKey: string, filePath: string) => {
        // 任意のファイルを公開しないよう、その作業の置き場の中のものに限る
        if (!isInsideWork(workKey, filePath)) throw new Error('INVALID_PATH');
        return mediaRef(filePath);
    });

    // --- 分離 ---
    ipcMain.handle(IPC_CHANNELS.VOICE_SEPARATION_MODELS, () => listSeparationModels());
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
    ipcMain.handle(IPC_CHANNELS.VOICE_TTS_LOAD_TEXT, (_e, filePath: string, language?: unknown) =>
        loadTextFile(filePath, typeof language === 'string' && isVoiceLanguage(language) ? language : undefined)
    );
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

    // --- パラメーターのプリセット ---
    ipcMain.handle(IPC_CHANNELS.VOICE_PRESETS_LIST, (_e, kind: PresetKind) => listPresets(kind));
    ipcMain.handle(
        IPC_CHANNELS.VOICE_PRESETS_SAVE,
        (_e, kind: PresetKind, preset: { id?: string; name: string; params: PresetParams }) => savePreset(kind, preset)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_PRESETS_RENAME, (_e, kind: PresetKind, id: string, name: string) =>
        renamePreset(kind, id, name)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_PRESETS_REMOVE, (_e, kind: PresetKind, id: string) => removePreset(kind, id));

    // --- 学習セット ---
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_SETS_LIST, (_e, feature: unknown) =>
        listTrainingSets(checkFeatureId(feature))
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_SETS_GET, (_e, feature: unknown, id: string) =>
        getTrainingSet(checkFeatureId(feature), id)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_SETS_CREATE, (_e, feature: unknown, name: string, language: unknown) =>
        createTrainingSet(checkFeatureId(feature), name, language === undefined ? undefined : checkLanguage(language))
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_SETS_RENAME, (_e, feature: unknown, id: string, name: string) =>
        renameTrainingSet(checkFeatureId(feature), id, name)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_SETS_REMOVE, (_e, feature: unknown, id: string) =>
        removeTrainingSet(checkFeatureId(feature), id)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_SETS_ADD_RECORDING,
        (_e, feature: unknown, id: string, recordingId: string, target: { name: string; sentenceId?: string }) =>
            addTrainingRecording(checkFeatureId(feature), id, recordingId, target)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_SETS_ADD_FILES,
        (_e, jobId: string, feature: unknown, id: string, paths: string[], sentenceId?: string) =>
            addTrainingFiles(jobId, checkFeatureId(feature), id, paths, sentenceId)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_SETS_REMOVE_AUDIO, (_e, feature: unknown, id: string, audioId: string) =>
        removeTrainingAudio(checkFeatureId(feature), id, audioId)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_SETS_FILTER_AUDIO,
        (
            _e,
            jobId: string,
            feature: unknown,
            id: string,
            audioId: string,
            workKey: string,
            options: TrainingFilterOptions
        ) =>
            filterTrainingAudio(
                jobId,
                checkFeatureId(feature),
                id,
                audioId,
                workKey,
                sanitizeTrainingFilterOptions(options)
            )
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_SETS_REPLACE_AUDIO,
        (_e, feature: unknown, id: string, audioId: string, workKey: string, result: string) =>
            replaceTrainingAudio(checkFeatureId(feature), id, audioId, workKey, result)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_SETS_FILTER_ALL,
        (_e, jobId: string, feature: unknown, id: string, options: TrainingFilterOptions) =>
            filterTrainingSet(jobId, checkFeatureId(feature), id, sanitizeTrainingFilterOptions(options))
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_SETS_SILENCE,
        (_e, feature: unknown, id: string, option: SilenceOption) =>
            trainingSilenceReport(checkFeatureId(feature), id, sanitizeSilenceOption(option))
    );

    // --- 学習 ---
    ipcMain.handle(IPC_CHANNELS.VOICE_TRAINING_RVC_START, (_e, jobId: string, setId: string, name: string) =>
        startRvcTraining(jobId, setId, name)
    );
    ipcMain.handle(
        IPC_CHANNELS.VOICE_TRAINING_TTS_START,
        (_e, jobId: string, options: { setId: string; modelType: TtsModelType; name: string }) =>
            startTtsTraining(jobId, options)
    );

    // --- 書き出し ---
    ipcMain.handle(
        IPC_CHANNELS.VOICE_EXPORT_RUN,
        (_e, jobId: string, workKey: string, items: ExportItem[], settings: AudioExportSettings) =>
            exportAudio(jobId, workKey, items, settings)
    );
    ipcMain.handle(IPC_CHANNELS.VOICE_EXPORT_EXISTING, (_e, paths: string[]) => existingPaths(paths));
}
