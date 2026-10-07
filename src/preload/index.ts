import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcApi } from '../shared/ipc';
import type { JobEvent, UpdateState } from '../shared/types';

// IPCチャンネル定義（ランタイムでsharedからインポートを避けるためローカルコピー）
const IPC_CHANNELS = {
    APP_GET_INFO: 'app:getInfo',
    APP_SET_THEME: 'app:setTheme',
    APP_SET_LANGUAGE: 'app:setLanguage',
    APP_QUIT: 'app:quit',
    WINDOW_MINIMIZE: 'window:minimize',
    WINDOW_MAXIMIZE_OR_RESTORE: 'window:maximizeOrRestore',
    WINDOW_CLOSE: 'window:close',
    // 閉じる前の確認 (main -> renderer の問い合わせと、renderer からの閉じてよいという返事)
    WINDOW_CLOSE_REQUESTED: 'window:closeRequested',
    WINDOW_CONFIRM_CLOSE: 'window:confirmClose',
    WINDOW_IS_MAXIMIZED: 'window:isMaximized',
    MAIN_CONSOLE: 'main:console',
    UPDATER_CHECK: 'updater:check',
    UPDATER_DOWNLOAD: 'updater:download',
    UPDATER_QUIT_AND_INSTALL: 'updater:quitAndInstall',
    UPDATER_GET_STATE: 'updater:getState',
    UPDATER_STATE_CHANGED: 'updater:stateChanged',
    SETTINGS_GET: 'settings:get',
    SETTINGS_UPDATE: 'settings:update',
    SETTINGS_GET_LOAD_ERROR: 'settings:getLoadError',
    SETTINGS_RESET_BROKEN: 'settings:resetBroken',
    STORAGE_GET_INFO: 'storage:getInfo',
    STORAGE_MOVE: 'storage:move',
    STORAGE_SET_WORK_DIR: 'storage:setWorkDir',
    STORAGE_CLEANUP_WORK: 'storage:cleanupWork',
    STORAGE_PLAN_MOVE: 'storage:planMove',
    FFMPEG_DETECT: 'ffmpeg:detect',
    DIALOG_OPEN_FILES: 'dialog:openFiles',
    DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
    DIALOG_SAVE_FILE: 'dialog:saveFile',
    FILES_COLLECT: 'files:collect',
    JOB_CANCEL: 'job:cancel',
    JOB_EVENT: 'job:event',
    AUDIO_ANALYZE: 'audio:analyze',
    AUDIO_NORMALIZE: 'audio:normalize',
    AUDIO_CHECK_OUTPUTS: 'audio:checkOutputs',
    AUDIO_FORMATS: 'audio:formats',
    AUDIO_PROBE: 'audio:probe',
    CHAPTER_PROBE: 'chapter:probe',
    CHAPTER_CUT: 'chapter:cut',
    CHAPTER_SPLIT: 'chapter:split',
    CHAPTER_CHECK_CUT: 'chapter:checkCut',
    CHAPTER_CHECK_SPLIT: 'chapter:checkSplit',
    VECTORIZER_LOAD_IMAGE: 'vectorizer:loadImage',
    VECTORIZER_CONVERT: 'vectorizer:convert',
    VECTORIZER_SAVE_SVG: 'vectorizer:saveSvg',
    CLEANUP_GET_ROOTS: 'cleanup:getRoots',
    CLEANUP_GET_CAPABILITIES: 'cleanup:getCapabilities',
    CLEANUP_OPEN_PERMISSION_SETTINGS: 'cleanup:openPermissionSettings',
    CLEANUP_SCAN: 'cleanup:scan',
    CLEANUP_REMOVE: 'cleanup:remove',
    VOICE_LIBRARY_STATUS: 'voice:library:status',
    VOICE_LIBRARY_REFRESH_PLATFORM: 'voice:library:refreshPlatform',
    VOICE_LIBRARY_CHECK_FEATURE: 'voice:library:checkFeature',
    VOICE_LIBRARY_DOWNLOAD: 'voice:library:download',
    VOICE_LIBRARY_REMOVE: 'voice:library:remove',
    VOICE_LIBRARY_ENSURE_SEPARATOR_LIST: 'voice:library:ensureSeparatorList',
    VOICE_LIBRARY_PROBE_SIZES: 'voice:library:probeSizes',
    VOICE_LIBRARY_PENDING_UPDATES: 'voice:library:pendingUpdates',
    VOICE_LIBRARY_MARK_PROMPTED: 'voice:library:markPrompted',
    VOICE_OPEN_EXTERNAL: 'voice:openExternal',
    VOICE_SET_FEATURE: 'voice:setFeature',
    VOICE_REQUEST_MICROPHONE: 'voice:requestMicrophone',
    VOICE_RECORDING_BEGIN: 'voice:recording:begin',
    VOICE_RECORDING_APPEND: 'voice:recording:append',
    VOICE_RECORDING_FINISH: 'voice:recording:finish',
    VOICE_RECORDING_DISCARD: 'voice:recording:discard',
    VOICE_MEDIA_PREPARE: 'voice:media:prepare',
    VOICE_MEDIA_MIX: 'voice:media:mix',
    VOICE_MEDIA_DISCARD: 'voice:media:discard',
    VOICE_MEDIA_DISCARD_WORK: 'voice:media:discardWork',
    VOICE_MEDIA_REF: 'voice:media:ref',
    VOICE_MEDIA_WAVEFORM: 'voice:media:waveform',
    VOICE_SEPARATION_MODELS: 'voice:separation:models',
    VOICE_SEPARATION_RUN: 'voice:separation:run',
    VOICE_CONVERSION_RUN: 'voice:conversion:run',
    VOICE_CONVERSION_MIX: 'voice:conversion:mix',
    VOICE_RUBBERBAND: 'voice:rubberband',
    VOICE_TTS_RUN: 'voice:tts:run',
    VOICE_TTS_CANCEL_CONFIRMATION: 'voice:tts:cancelConfirmation',
    VOICE_TTS_LOAD_TEXT: 'voice:tts:loadText',
    VOICE_TTS_SAVE_TEXT: 'voice:tts:saveText',
    VOICE_MODELS_LIST: 'voice:models:list',
    VOICE_MODELS_RENAME: 'voice:models:rename',
    VOICE_MODELS_SET_LANGUAGES: 'voice:models:setLanguages',
    VOICE_MODELS_REMOVE: 'voice:models:remove',
    VOICE_MODELS_EXPORT: 'voice:models:export',
    VOICE_MODELS_INSPECT_IMPORT: 'voice:models:inspectImport',
    VOICE_MODELS_COMMIT_IMPORT: 'voice:models:commitImport',
    VOICE_MODELS_CANCEL_IMPORT: 'voice:models:cancelImport',
    VOICE_MODELS_CHOOSE_IMPORT_FILES: 'voice:models:chooseImportFiles',
    VOICE_MODELS_OPEN_HUB: 'voice:models:openHub',
    VOICE_PRESETS_LIST: 'voice:presets:list',
    VOICE_PRESETS_SAVE: 'voice:presets:save',
    VOICE_PRESETS_RENAME: 'voice:presets:rename',
    VOICE_PRESETS_REMOVE: 'voice:presets:remove',
    VOICE_TRAINING_SETS_LIST: 'voice:trainingSets:list',
    VOICE_TRAINING_SETS_GET: 'voice:trainingSets:get',
    VOICE_TRAINING_SETS_CREATE: 'voice:trainingSets:create',
    VOICE_TRAINING_SETS_RENAME: 'voice:trainingSets:rename',
    VOICE_TRAINING_SETS_REMOVE: 'voice:trainingSets:remove',
    VOICE_TRAINING_SETS_ADD_RECORDING: 'voice:trainingSets:addRecording',
    VOICE_TRAINING_SETS_ADD_FILES: 'voice:trainingSets:addFiles',
    VOICE_TRAINING_SETS_REMOVE_AUDIO: 'voice:trainingSets:removeAudio',
    VOICE_TRAINING_SETS_FILTER_AUDIO: 'voice:trainingSets:filterAudio',
    VOICE_TRAINING_SETS_REPLACE_AUDIO: 'voice:trainingSets:replaceAudio',
    VOICE_TRAINING_SETS_FILTER_ALL: 'voice:trainingSets:filterAll',
    VOICE_TRAINING_SETS_SILENCE: 'voice:trainingSets:silence',
    VOICE_TRAINING_RVC_START: 'voice:training:rvcStart',
    VOICE_TRAINING_TTS_START: 'voice:training:ttsStart',
    VOICE_EXPORT_RUN: 'voice:export:run',
    VOICE_EXPORT_EXISTING: 'voice:export:existing',
} as const;

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: IpcApi = {
    async getAppInfo() {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO);
    },
    async setTheme(theme) {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_SET_THEME, theme);
    },
    async setLanguage(language) {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_SET_LANGUAGE, language);
    },
    async quitApp() {
        return ipcRenderer.invoke(IPC_CHANNELS.APP_QUIT);
    },
    getPathForFile(file) {
        return webUtils.getPathForFile(file);
    },
    async minimize() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
    },
    async maximizeOrRestore() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE_OR_RESTORE);
    },
    async isMaximized() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED);
    },
    async close() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE);
    },
    onCloseRequested(listener: () => void) {
        const handler = () => listener();
        ipcRenderer.on(IPC_CHANNELS.WINDOW_CLOSE_REQUESTED, handler);
        return () => {
            ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_CLOSE_REQUESTED, handler);
        };
    },
    async confirmClose() {
        return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CONFIRM_CLOSE);
    },
    settings: {
        async get() {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET);
        },
        async update(patch) {
            return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, patch);
        },
        getLoadError: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_LOAD_ERROR),
        resetBroken: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RESET_BROKEN),
    },
    storage: {
        getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_INFO),
        move: (jobId, kind, targetDir, decisions) =>
            ipcRenderer.invoke(IPC_CHANNELS.STORAGE_MOVE, jobId, kind, targetDir, decisions),
        setWorkDir: dir => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_WORK_DIR, dir),
        cleanupWork: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CLEANUP_WORK),
        planMove: (kind, targetDir) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_PLAN_MOVE, kind, targetDir),
    },
    ffmpeg: {
        async detect() {
            return ipcRenderer.invoke(IPC_CHANNELS.FFMPEG_DETECT);
        },
    },
    dialog: {
        async openFiles(options) {
            return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILES, options);
        },
        async openDirectory(options) {
            return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, options);
        },
        async saveFile(options) {
            return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options);
        },
    },
    files: {
        async collect(paths, extensions) {
            return ipcRenderer.invoke(IPC_CHANNELS.FILES_COLLECT, paths, extensions);
        },
    },
    jobs: {
        async cancel(jobId) {
            return ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, jobId);
        },
        onEvent(listener: (event: JobEvent) => void) {
            const handler = (_event: Electron.IpcRendererEvent, jobEvent: JobEvent) => listener(jobEvent);
            ipcRenderer.on(IPC_CHANNELS.JOB_EVENT, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.JOB_EVENT, handler);
            };
        },
    },
    audio: {
        async probe(files) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_PROBE, files);
        },
        async analyze(jobId, files, durations) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_ANALYZE, jobId, files, durations);
        },
        async normalize(jobId, inputs, options) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_NORMALIZE, jobId, inputs, options);
        },
        async checkOutputs(files, outputDir, format) {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_CHECK_OUTPUTS, files, outputDir, format);
        },
        async formats() {
            return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_FORMATS);
        },
    },
    chapter: {
        async probe(input) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_PROBE, input);
        },
        async cut(jobId, request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_CUT, jobId, request);
        },
        async split(jobId, request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_SPLIT, jobId, request);
        },
        async checkCut(request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_CHECK_CUT, request);
        },
        async checkSplit(request) {
            return ipcRenderer.invoke(IPC_CHANNELS.CHAPTER_CHECK_SPLIT, request);
        },
    },
    vectorizer: {
        async loadImage(path) {
            return ipcRenderer.invoke(IPC_CHANNELS.VECTORIZER_LOAD_IMAGE, path);
        },
        async convert(path, params) {
            return ipcRenderer.invoke(IPC_CHANNELS.VECTORIZER_CONVERT, path, params);
        },
        async saveSvg(resultId, path) {
            return ipcRenderer.invoke(IPC_CHANNELS.VECTORIZER_SAVE_SVG, resultId, path);
        },
    },
    cleanup: {
        async getCapabilities() {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_GET_CAPABILITIES);
        },
        async openPermissionSettings() {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_OPEN_PERMISSION_SETTINGS);
        },
        async getRoots() {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_GET_ROOTS);
        },
        async scan(jobId, options) {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_SCAN, jobId, options);
        },
        async remove(jobId, items) {
            return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_REMOVE, jobId, items);
        },
    },
    voice: {
        library: {
            getStatus: () => invoke(IPC_CHANNELS.VOICE_LIBRARY_STATUS),
            refreshPlatform: () => invoke(IPC_CHANNELS.VOICE_LIBRARY_REFRESH_PLATFORM),
            checkFeature: (feature, extra) => invoke(IPC_CHANNELS.VOICE_LIBRARY_CHECK_FEATURE, feature, extra),
            download: (jobId, ids) => invoke(IPC_CHANNELS.VOICE_LIBRARY_DOWNLOAD, jobId, ids),
            remove: (ids, options) => invoke(IPC_CHANNELS.VOICE_LIBRARY_REMOVE, ids, options),
            ensureSeparatorModelList: () => invoke(IPC_CHANNELS.VOICE_LIBRARY_ENSURE_SEPARATOR_LIST),
            probeSeparatorSizes: () => invoke(IPC_CHANNELS.VOICE_LIBRARY_PROBE_SIZES),
            getPendingUpdates: () => invoke(IPC_CHANNELS.VOICE_LIBRARY_PENDING_UPDATES),
            markUpdatePrompted: () => invoke(IPC_CHANNELS.VOICE_LIBRARY_MARK_PROMPTED),
        },
        openExternal: url => invoke(IPC_CHANNELS.VOICE_OPEN_EXTERNAL, url),
        setFeature: feature => invoke(IPC_CHANNELS.VOICE_SET_FEATURE, feature),
        requestMicrophone: () => invoke(IPC_CHANNELS.VOICE_REQUEST_MICROPHONE),
        recording: {
            begin: sampleRate => invoke(IPC_CHANNELS.VOICE_RECORDING_BEGIN, sampleRate),
            append: (id, pcm) => invoke(IPC_CHANNELS.VOICE_RECORDING_APPEND, id, pcm),
            finish: id => invoke(IPC_CHANNELS.VOICE_RECORDING_FINISH, id),
            discard: id => invoke(IPC_CHANNELS.VOICE_RECORDING_DISCARD, id),
        },
        media: {
            prepareInput: (jobId, workKey, sourcePath) =>
                invoke(IPC_CHANNELS.VOICE_MEDIA_PREPARE, jobId, workKey, sourcePath),
            mix: (jobId, workKey, paths, channels) =>
                invoke(IPC_CHANNELS.VOICE_MEDIA_MIX, jobId, workKey, paths, channels),
            discard: (workKey, paths) => invoke(IPC_CHANNELS.VOICE_MEDIA_DISCARD, workKey, paths),
            discardWork: workKey => invoke(IPC_CHANNELS.VOICE_MEDIA_DISCARD_WORK, workKey),
            ref: (workKey, path) => invoke(IPC_CHANNELS.VOICE_MEDIA_REF, workKey, path),
            waveform: url => invoke(IPC_CHANNELS.VOICE_MEDIA_WAVEFORM, url),
        },
        separation: {
            listModels: () => invoke(IPC_CHANNELS.VOICE_SEPARATION_MODELS),
            run: (jobId, request) => invoke(IPC_CHANNELS.VOICE_SEPARATION_RUN, jobId, request),
        },
        conversion: {
            run: (jobId, request) => invoke(IPC_CHANNELS.VOICE_CONVERSION_RUN, jobId, request),
            renderMix: (jobId, request) => invoke(IPC_CHANNELS.VOICE_CONVERSION_MIX, jobId, request),
            hasRubberband: () => invoke(IPC_CHANNELS.VOICE_RUBBERBAND),
        },
        tts: {
            run: (jobId, request) => invoke(IPC_CHANNELS.VOICE_TTS_RUN, jobId, request),
            cancelConfirmation: token => invoke(IPC_CHANNELS.VOICE_TTS_CANCEL_CONFIRMATION, token),
            loadText: (path, language) => invoke(IPC_CHANNELS.VOICE_TTS_LOAD_TEXT, path, language),
            saveText: (path, text) => invoke(IPC_CHANNELS.VOICE_TTS_SAVE_TEXT, path, text),
        },
        models: {
            list: feature => invoke(IPC_CHANNELS.VOICE_MODELS_LIST, feature),
            rename: (feature, id, name) => invoke(IPC_CHANNELS.VOICE_MODELS_RENAME, feature, id, name),
            setLanguages: (id, languages) => invoke(IPC_CHANNELS.VOICE_MODELS_SET_LANGUAGES, id, languages),
            remove: (feature, id) => invoke(IPC_CHANNELS.VOICE_MODELS_REMOVE, feature, id),
            export: (feature, id, destPath) => invoke(IPC_CHANNELS.VOICE_MODELS_EXPORT, feature, id, destPath),
            inspectImport: (feature, paths) => invoke(IPC_CHANNELS.VOICE_MODELS_INSPECT_IMPORT, feature, paths),
            commitImport: (token, options) => invoke(IPC_CHANNELS.VOICE_MODELS_COMMIT_IMPORT, token, options),
            cancelImport: token => invoke(IPC_CHANNELS.VOICE_MODELS_CANCEL_IMPORT, token),
            chooseImportFiles: (token, model, index) =>
                invoke(IPC_CHANNELS.VOICE_MODELS_CHOOSE_IMPORT_FILES, token, model, index),
            openHubSearch: feature => invoke(IPC_CHANNELS.VOICE_MODELS_OPEN_HUB, feature),
        },
        presets: {
            list: kind => invoke(IPC_CHANNELS.VOICE_PRESETS_LIST, kind),
            save: (kind, preset) => invoke(IPC_CHANNELS.VOICE_PRESETS_SAVE, kind, preset),
            rename: (kind, id, name) => invoke(IPC_CHANNELS.VOICE_PRESETS_RENAME, kind, id, name),
            remove: (kind, id) => invoke(IPC_CHANNELS.VOICE_PRESETS_REMOVE, kind, id),
        },
        trainingSets: {
            list: feature => invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_LIST, feature),
            get: (feature, id) => invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_GET, feature, id),
            create: (feature, name, language) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_CREATE, feature, name, language),
            rename: (feature, id, name) => invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_RENAME, feature, id, name),
            remove: (feature, id) => invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_REMOVE, feature, id),
            addRecording: (feature, id, recordingId, target) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_ADD_RECORDING, feature, id, recordingId, target),
            addFiles: (jobId, feature, id, paths, sentenceId) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_ADD_FILES, jobId, feature, id, paths, sentenceId),
            removeAudio: (feature, id, audioId) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_REMOVE_AUDIO, feature, id, audioId),
            filterAudio: (jobId, feature, id, audioId, workKey, options) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_FILTER_AUDIO, jobId, feature, id, audioId, workKey, options),
            replaceAudio: (feature, id, audioId, workKey, result) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_REPLACE_AUDIO, feature, id, audioId, workKey, result),
            filterAll: (jobId, feature, id, options) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_FILTER_ALL, jobId, feature, id, options),
            silenceReport: (feature, id, option) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_SETS_SILENCE, feature, id, option),
        },
        training: {
            rvcStart: (jobId, setId, name, epochs) =>
                invoke(IPC_CHANNELS.VOICE_TRAINING_RVC_START, jobId, setId, name, epochs),
            ttsStart: (jobId, options) => invoke(IPC_CHANNELS.VOICE_TRAINING_TTS_START, jobId, options),
        },
        export: {
            run: (jobId, workKey, items, settings) =>
                invoke(IPC_CHANNELS.VOICE_EXPORT_RUN, jobId, workKey, items, settings),
            existing: paths => invoke(IPC_CHANNELS.VOICE_EXPORT_EXISTING, paths),
        },
    },
    updater: {
        async getState() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_STATE);
        },
        async check() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK);
        },
        async download() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD);
        },
        async quitAndInstall() {
            return ipcRenderer.invoke(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL);
        },
        onStateChanged(listener: (state: UpdateState) => void) {
            const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
            ipcRenderer.on(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
            };
        },
    },
};

contextBridge.exposeInMainWorld('kuraToolkit', api);

// メインプロセスのコンソールメッセージを受信してDevToolsに転送
ipcRenderer.on(
    IPC_CHANNELS.MAIN_CONSOLE,
    (
        _event,
        data: {
            level: string;
            args: Array<{ type: string; value?: string; message?: string; stack?: string; name?: string }>;
        }
    ) => {
        const { level, args } = data;
        // DevTools出力用に引数をデシリアライズ
        const deserializedArgs = args.map(arg => {
            if (arg.type === 'error') {
                const error = new Error(arg.message || 'Unknown error');
                if (arg.stack) error.stack = arg.stack;
                if (arg.name) error.name = arg.name;
                return error;
            } else if (arg.type === 'object') {
                try {
                    return JSON.parse(arg.value || '{}');
                } catch {
                    return arg.value;
                }
            } else {
                return arg.value;
            }
        });

        // レンダラーコンソールに転送（DevToolsに表示される）
        switch (level) {
            case 'log':
                console.log('[Main]', ...deserializedArgs);
                break;
            case 'error':
                console.error('[Main]', ...deserializedArgs);
                break;
            case 'warn':
                console.warn('[Main]', ...deserializedArgs);
                break;
            case 'info':
                console.info('[Main]', ...deserializedArgs);
                break;
            case 'debug':
                console.debug('[Main]', ...deserializedArgs);
                break;
            default:
                console.log('[Main]', ...deserializedArgs);
        }
    }
);
