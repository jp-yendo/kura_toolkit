import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { probeAudio } from './audio-tools';
import { checkFeature, isItemInstalled } from './library';
import { forgetMedia, mediaUrl } from './media-protocol';
import { bundledResourceDir, envPythonExecutable, libraryPaths, modelPaths } from './paths';
import { cpuCount, getPlatformInfo } from './platform';
import { buildPythonEnv } from './python-env';
import { runProcess } from './process-runner';
import { pythonLog } from './log';
import { withGpu } from './gpu-lock';
import { newJobTempDir, removeTemp, workRoot } from '../work-dir';
import { CONVERTER_MODEL_DIR, TTS_ENGINE_ITEMS, TTS_WESPEAKER_DIR } from './spec';
import {
    discardVoiceDir,
    newVoiceDir,
    readRvcModelJson,
    registerTrainedVoice,
    ttsMetaFromConfig,
} from './voice-models';
import {
    LANGUAGE_DEFINITIONS,
    ttsTrainingItems,
    type CorpusSetId,
    type TtsEngineId,
    type VoiceLanguage,
} from '../../../shared/voice/languages';
import {
    TRAINING_AUDIO_EXTENSIONS,
    type DatasetItem,
    type TrainingProgress,
    type TtsTrainingDraft,
    type VoiceModelInfo,
} from '../../../shared/voice/types';

// 声のモデルの学習と、学習用の音声の管理。
// 学習用の音声は 2 種類。一覧はこの起動中だけ持つ。
// - 利用者が指定したファイル: 元の場所から直接読み、消さない
// - アプリ内での録音: 作業ディレクトリに保存し、学習が終わった時点 (成功・エラー・キャンセル) と、
//   利用者が破棄した時点で消す
// 学習時のパラメーターはアプリが決める (利用者は名前を付けるだけ)。

type DatasetEntry = {
    id: string;
    name: string;
    // 指定したファイルは利用者のファイル、録音は作業ディレクトリのファイル
    path: string;
    recorded: boolean;
    durationSec: number;
    sampleRate: number;
    channels: number;
};

function toItem(entry: DatasetEntry): DatasetItem {
    return {
        id: entry.id,
        name: entry.name,
        durationSec: entry.durationSec,
        recorded: entry.recorded,
        media: {
            path: entry.path,
            // 指定したファイルが移動・削除された場合は再生できない (学習の開始時に TRAINING_FILE_MISSING で知らせる)
            url: fs.existsSync(entry.path) ? mediaUrl(entry.path) : '',
            durationSec: entry.durationSec,
            channels: entry.channels,
            sampleRate: entry.sampleRate,
        },
    };
}

async function probeEntry(
    id: string,
    name: string,
    filePath: string,
    recorded: boolean,
    jobId?: string
): Promise<DatasetEntry> {
    const info = await probeAudio(filePath, jobId);
    return {
        id,
        name,
        path: filePath,
        recorded,
        durationSec: info.durationSec,
        sampleRate: info.sampleRate,
        channels: info.channels,
    };
}

function checkAudioFile(filePath: string): void {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    if (!TRAINING_AUDIO_EXTENSIONS.includes(extension)) {
        throw new Error(`TRAINING_FILE_UNSUPPORTED: ${path.basename(filePath)}`);
    }
}

// 録音の保存先 (作業ディレクトリ。一覧の単位ごとのフォルダ)
function recordingPath(group: string, name: string): string {
    const dir = path.join(workRoot(), 'recordings', group);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${name}.wav`);
}

async function storeRecording(id: string, name: string, target: string, wav: Uint8Array): Promise<DatasetEntry> {
    fs.writeFileSync(target, Buffer.from(wav));
    try {
        return await probeEntry(id, name, target, true);
    } catch (error) {
        await removeTemp(target);
        throw error;
    }
}

// 一覧から外したものの後始末。録音は消し、指定されたファイルは利用者のファイルなので消さない
function discardEntries(entries: Iterable<DatasetEntry>): void {
    for (const entry of entries) {
        forgetMedia(entry.path);
        if (entry.recorded) void removeTemp(entry.path);
    }
}

// 学習の前に、指定されたファイルが今もあるかを確かめる (移動・削除されていれば止める)
function checkEntriesExist(entries: DatasetEntry[]): void {
    const missing = entries.filter(entry => !fs.existsSync(entry.path));
    if (missing.length > 0) throw new Error(`TRAINING_FILE_MISSING: ${missing.map(entry => entry.name).join(', ')}`);
}

// --- 音声変換 (RVC) の学習用の音声 ---

const rvcEntries = new Map<string, DatasetEntry>();

export function getRvcDataset(): DatasetItem[] {
    return [...rvcEntries.values()].map(toItem);
}

// 音声ファイルを学習用に加える。元の場所から直接読む
export async function addRvcFiles(jobId: string, paths: string[]): Promise<DatasetItem[]> {
    startJob(jobId);
    try {
        const added: DatasetItem[] = [];
        for (let i = 0; i < paths.length; i++) {
            if (isCancelled(jobId)) break;
            emitJobEvent({
                jobId,
                kind: 'progress',
                percent: (i / paths.length) * 100,
                current: i + 1,
                total: paths.length,
            });
            const source = path.resolve(paths[i]);
            checkAudioFile(source);
            // 同じファイルは重ねて加えない
            if ([...rvcEntries.values()].some(entry => !entry.recorded && entry.path === source)) continue;
            const entry = await probeEntry(crypto.randomUUID(), path.basename(source), source, false, jobId);
            rvcEntries.set(entry.id, entry);
            added.push(toItem(entry));
        }
        return added;
    } finally {
        finishJob(jobId);
    }
}

// アプリ内で録音した音声 (16bit PCM の WAV) を作業ディレクトリに置く
export async function addRvcRecording(wav: Uint8Array, name: string): Promise<DatasetItem> {
    const id = crypto.randomUUID();
    const entry = await storeRecording(id, name, recordingPath('converter', id), wav);
    rvcEntries.set(id, entry);
    return toItem(entry);
}

export function removeRvcItem(id: string): void {
    const entry = rvcEntries.get(id);
    if (!entry) return;
    rvcEntries.delete(id);
    discardEntries([entry]);
}

export function clearRvcDataset(): void {
    discardEntries(rvcEntries.values());
    rvcEntries.clear();
}

// --- 読み上げの学習用の音声 (提示した文ごとに 1 つ) ---

type CorpusFile = { sentences: { id: string; set: string; text: string }[] };

const corpusCache = new Map<VoiceLanguage, CorpusFile>();

function corpusSentences(language: VoiceLanguage, set: CorpusSetId): { id: string; text: string }[] {
    const definition = LANGUAGE_DEFINITIONS[language];
    let corpus = corpusCache.get(language);
    if (!corpus) {
        corpus = JSON.parse(
            fs.readFileSync(path.join(bundledResourceDir('third_party'), ...definition.corpus.file.split('/')), 'utf-8')
        ) as CorpusFile;
        corpusCache.set(language, corpus);
    }
    if (set === 'accurate') return corpus.sentences.map(({ id, text }) => ({ id, text }));
    return corpus.sentences
        .filter(sentence => sentence.set === definition.corpus.quick.set)
        .slice(0, definition.corpus.quick.count)
        .map(({ id, text }) => ({ id, text }));
}

// 言語と文章の種類ごとの、文の ID と音声
const ttsDrafts = new Map<string, Map<string, DatasetEntry>>();

function draftKey(language: VoiceLanguage, set: CorpusSetId): string {
    return `${language}-${set}`;
}

function ttsDraft(language: VoiceLanguage, set: CorpusSetId): Map<string, DatasetEntry> {
    const key = draftKey(language, set);
    let draft = ttsDrafts.get(key);
    if (!draft) {
        draft = new Map();
        ttsDrafts.set(key, draft);
    }
    return draft;
}

function requireSentence(language: VoiceLanguage, set: CorpusSetId, sentenceId: string): { id: string; text: string } {
    const sentence = corpusSentences(language, set).find(item => item.id === sentenceId);
    if (!sentence) throw new Error('UNKNOWN_SENTENCE');
    return sentence;
}

// 文の音声を置き換える (前の録音は消す)
function setSentenceEntry(language: VoiceLanguage, set: CorpusSetId, entry: DatasetEntry): void {
    const draft = ttsDraft(language, set);
    const previous = draft.get(entry.id);
    draft.set(entry.id, entry);
    if (previous && previous.path !== entry.path) discardEntries([previous]);
}

export function getTtsDraft(language: VoiceLanguage, set: CorpusSetId): TtsTrainingDraft {
    const draft = ttsDraft(language, set);
    return {
        language,
        corpusSet: set,
        sentences: corpusSentences(language, set).map(sentence => {
            const entry = draft.get(sentence.id);
            return { id: sentence.id, text: sentence.text, recording: entry ? toItem(entry) : null };
        }),
    };
}

// アプリ内で録音した音声を作業ディレクトリに置く (録り直しは別の名前で保存し、前の録音を消す)
export async function saveTtsRecording(
    language: VoiceLanguage,
    set: CorpusSetId,
    sentenceId: string,
    wav: Uint8Array
): Promise<DatasetItem> {
    requireSentence(language, set, sentenceId);
    const name = `${sentenceId}-${crypto.randomBytes(4).toString('hex')}`;
    const target = recordingPath(`tts-${draftKey(language, set)}`, name);
    const entry = await storeRecording(sentenceId, sentenceId, target, wav);
    setSentenceEntry(language, set, entry);
    return toItem(entry);
}

// その 1 文に対応する音声ファイルを指定する。元の場所から直接読む
// (複数の文を続けて録ったファイルの分割は利用者が行う)
export async function setTtsSentenceFile(
    jobId: string,
    language: VoiceLanguage,
    set: CorpusSetId,
    sentenceId: string,
    source: string
): Promise<DatasetItem> {
    startJob(jobId);
    try {
        requireSentence(language, set, sentenceId);
        const filePath = path.resolve(source);
        checkAudioFile(filePath);
        const entry = await probeEntry(sentenceId, path.basename(filePath), filePath, false, jobId);
        setSentenceEntry(language, set, entry);
        return toItem(entry);
    } finally {
        finishJob(jobId);
    }
}

export function removeTtsRecording(language: VoiceLanguage, set: CorpusSetId, sentenceId: string): void {
    const draft = ttsDraft(language, set);
    const entry = draft.get(sentenceId);
    if (!entry) return;
    draft.delete(sentenceId);
    discardEntries([entry]);
}

export function clearTtsDraft(language: VoiceLanguage, set: CorpusSetId): void {
    const draft = ttsDraft(language, set);
    discardEntries(draft.values());
    draft.clear();
}

// --- 学習の実行 ---

// 学習処理の段階ごとの進捗の配分 (%)
const STAGE_RANGES: Record<TrainingProgress['stage'], [number, number]> = {
    prepare: [0, 2],
    preprocess: [2, 10],
    extract: [10, 22],
    train: [22, 96],
    index: [96, 99],
    finalize: [99, 100],
};

type DriverEvent = {
    kind?: string;
    stage?: TrainingProgress['stage'];
    epoch?: number;
    totalEpochs?: number;
    code?: string;
    message?: string;
};

// 学習の駆動スクリプトを実行する。tempDir (作業ディレクトリ) に指示を置き、学習の途中のデータもそこに作らせる
async function runDriver(
    jobId: string,
    component: 'converter' | 'tts',
    script: string,
    job: Record<string, unknown>,
    extraEnv: Record<string, string>,
    tempDir: string
): Promise<void> {
    const jobFile = path.join(tempDir, 'job.json');
    fs.writeFileSync(jobFile, JSON.stringify(job), 'utf-8');
    let failure: DriverEvent | null = null;
    let done = false;
    const result = await runProcess(
        envPythonExecutable(component),
        ['-u', path.join(bundledResourceDir('python'), 'kura_voice', script), '--job', jobFile],
        {
            jobId,
            cwd: tempDir,
            env: buildPythonEnv(component, extraEnv),
            tailLines: 80,
            onLine: (line, stream) => {
                if (stream === 'stderr') {
                    pythonLog('train', line);
                    return;
                }
                let message: { event?: DriverEvent };
                try {
                    message = JSON.parse(line) as { event?: DriverEvent };
                } catch {
                    pythonLog('train', line);
                    return;
                }
                const event = message.event;
                if (!event) return;
                if (event.kind === 'error') failure = event;
                if (event.kind === 'done') done = true;
                if (event.kind === 'stage' && event.stage) {
                    const [start, end] = STAGE_RANGES[event.stage];
                    const fraction = event.epoch && event.totalEpochs ? event.epoch / event.totalEpochs : 0;
                    const progress: TrainingProgress = {
                        stage: event.stage,
                        epoch: event.epoch,
                        totalEpochs: event.totalEpochs,
                    };
                    emitJobEvent({
                        jobId,
                        kind: 'progress',
                        percent: start + (end - start) * fraction,
                        payload: progress,
                    });
                }
            },
        }
    );
    if (failure) {
        const { code = 'TRAINING_FAILED', message } = failure as DriverEvent;
        throw new Error(message ? `${code}: ${message}` : code);
    }
    if (result.code !== 0 || !done) throw new Error(`TRAINING_FAILED: ${result.tail.slice(-15).join('\n')}`);
}

function internalModelName(): string {
    // 学習処理が作るディレクトリ名に使う。ASCII に限り、Applio が書き換える "trained" を含めない
    return `kura_${crypto.randomBytes(5).toString('hex')}`;
}

export async function startRvcTraining(jobId: string, name: string): Promise<VoiceModelInfo> {
    startJob(jobId);
    try {
        return await trainRvc(jobId, name);
    } finally {
        finishJob(jobId);
    }
}

async function trainRvc(jobId: string, name: string): Promise<VoiceModelInfo> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('VOICE_NAME_EMPTY');
    const readiness = await checkFeature('conversionTraining');
    if (!readiness.ready) throw new Error(`MODEL_REQUIRED: ${readiness.missing.join(', ')}`);
    const entries = [...rvcEntries.values()];
    const totalSeconds = entries.reduce((sum, entry) => sum + entry.durationSec, 0);
    if (totalSeconds < 10) throw new Error('TRAINING_DATA_TOO_SHORT');
    checkEntriesExist(entries);
    const platform = await getPlatformInfo();
    const cuda = platform.gpu.kind === 'cuda' && !!platform.gpu.cudaFlavor;
    // データが少ないほど多めに学習する (Applio の画面の既定は 200)
    const epochs = totalSeconds < 300 ? 250 : totalSeconds < 900 ? 200 : totalSeconds < 1800 ? 150 : 100;
    const modelName = internalModelName();
    const applio = libraryPaths().source('converter');
    const pretrained = `${CONVERTER_MODEL_DIR}/pretraineds/hifi-gan`;
    // 駆動スクリプトへの指示と学習の途中のデータの置き場 (学習が終わったら消す)
    const temp = newJobTempDir('training');
    // 完成したモデルは作成中の置き場に直接書かせ、完成してから声のモデルとして登録する
    const { id, dir } = newVoiceDir('converter');
    try {
        await withGpu(jobId, 'training', () =>
            runDriver(
                jobId,
                'converter',
                'rvc_train.py',
                {
                    applioDir: applio,
                    modelName,
                    // 指定されたファイルは元の場所から、録音は作業ディレクトリから直接読む
                    files: entries.map(entry => entry.path),
                    // 事前学習モデルはモデルディレクトリから直接読む
                    pretrainedG: modelPaths().file(`${pretrained}/f0G40k.pth`),
                    pretrainedD: modelPaths().file(`${pretrained}/f0D40k.pth`),
                    sampleRate: 40000,
                    epochs,
                    saveEvery: 10,
                    cpuCores: Math.min(cpuCount(), process.platform === 'win32' ? 60 : 32),
                    extractGpu: cuda ? '0' : '-',
                    trainGpu: '0',
                    batchSize: cuda && (platform.gpu.memoryMb ?? 0) >= 8000 ? 8 : 4,
                    outputDir: dir,
                },
                {},
                temp
            )
        );
        const rvc = readRvcModelJson(path.join(dir, 'model.json'), fs.existsSync(path.join(dir, 'model.index')));
        return await registerTrainedVoice('converter', id, trimmed, { rvc });
    } catch (error) {
        await discardVoiceDir('converter', id);
        throw error;
    } finally {
        await removeTemp(temp);
        // 学習が終わったら (成功・エラー・キャンセルを問わず) 録音は不要になるため消し、一覧を空にする
        clearRvcDataset();
    }
}

type TtsTrainingOptions = { language: VoiceLanguage; corpusSet: CorpusSetId; engine: TtsEngineId; name: string };

export async function startTtsTraining(jobId: string, options: TtsTrainingOptions): Promise<VoiceModelInfo> {
    startJob(jobId);
    try {
        return await trainTts(jobId, options);
    } finally {
        finishJob(jobId);
    }
}

async function trainTts(jobId: string, options: TtsTrainingOptions): Promise<VoiceModelInfo> {
    const trimmed = options.name.trim();
    if (!trimmed) throw new Error('VOICE_NAME_EMPTY');
    const platform = await getPlatformInfo();
    // 読み上げのモデルの学習は、上流が NVIDIA GPU を前提としているため NVIDIA GPU を搭載した Windows でのみ行う
    if (!platform.ttsTrainingAvailable) throw new Error('TTS_TRAINING_UNAVAILABLE');
    if (!LANGUAGE_DEFINITIONS[options.language].trainingEngines.includes(options.engine)) {
        throw new Error('TTS_ENGINE_LANGUAGE_MISMATCH');
    }
    const required = [
        'component:tts',
        'component:tts-train',
        TTS_ENGINE_ITEMS['jp-extra'],
        ...ttsTrainingItems(options.engine, options.language),
    ];
    const missing = required.filter(item => !isItemInstalled(item));
    if (missing.length > 0) throw new Error(`MODEL_REQUIRED: ${missing.join(', ')}`);

    const draft = ttsDraft(options.language, options.corpusSet);
    const sentences = corpusSentences(options.language, options.corpusSet).filter(sentence => draft.has(sentence.id));
    if (sentences.length < 10) throw new Error('TRAINING_DATA_TOO_FEW');
    checkEntriesExist(sentences.map(sentence => draft.get(sentence.id) as DatasetEntry));
    const clips = sentences.map(sentence => ({
        id: sentence.id,
        // 提示した文章を、その音声の正解テキストとしてそのまま使う
        text: sentence.text,
        // 指定されたファイルは元の場所から、録音は作業ディレクトリから直接読む
        path: (draft.get(sentence.id) as DatasetEntry).path,
    }));

    const memory = platform.gpu.memoryMb ?? 0;
    const batchSize = memory >= 12000 ? 4 : memory >= 10000 ? 3 : memory >= 8000 ? 2 : 1;
    // 全体の学習ステップ数がおよそ 8000 になるように回数を決める
    const stepsPerEpoch = Math.ceil(clips.length / batchSize);
    const epochs = Math.max(20, Math.min(200, Math.round(8000 / stepsPerEpoch)));
    const modelName = internalModelName();
    const repo = libraryPaths().source('tts');
    // 駆動スクリプトへの指示と学習の途中のデータの置き場 (学習が終わったら消す)
    const temp = newJobTempDir('training');
    // 完成したモデルは作成中の置き場に直接書かせ、完成してから声のモデルとして登録する
    const { id, dir } = newVoiceDir('tts');
    try {
        await withGpu(jobId, 'training', () =>
            runDriver(
                jobId,
                'tts',
                'sbv2_train.py',
                {
                    repoDir: repo,
                    modelName,
                    language: options.language,
                    useJpExtra: options.engine === 'jp-extra',
                    clips,
                    epochs,
                    batchSize,
                    cpuCores: Math.max(1, Math.floor(cpuCount() / 2)),
                    outputDir: dir,
                },
                {
                    // リポジトリの学習スクリプトがリポジトリ内のパッケージ (bert/ などの場所の基準) を使うようにする
                    PYTHONPATH: path.join(repo, 'src'),
                    KURA_WESPEAKER: modelPaths().file(`${TTS_WESPEAKER_DIR}/pytorch_model.bin`),
                },
                temp
            )
        );
        const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
        const tts = { ...ttsMetaFromConfig(config), languages: [options.language] };
        return await registerTrainedVoice('tts', id, trimmed, { tts });
    } catch (error) {
        await discardVoiceDir('tts', id);
        throw error;
    } finally {
        await removeTemp(temp);
        // 学習が終わったら (成功・エラー・キャンセルを問わず) 録音は不要になるため消し、一覧を空にする
        clearTtsDraft(options.language, options.corpusSet);
    }
}
