import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { checkFeature, isItemInstalled } from './library';
import { corpusSentences } from './corpus';
import { bundledResourceDir, envPythonExecutable, libraryPaths, modelPaths } from './paths';
import { cpuCount, getPlatformInfo } from './platform';
import { buildPythonEnv } from './python-env';
import { runProcess } from './process-runner';
import { pythonLog } from './log';
import { withGpu } from './gpu-lock';
import { newTempDir, discardLater } from '../work-dir';
import { CONVERTER_MODEL_DIR, TTS_WESPEAKER_DIR } from './spec';
import { withTrainingSet, type TrainingSetAudio } from './training-sets';
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
    type TtsModelType,
    type VoiceLanguage,
} from '../../../shared/voice/languages';
import { isValidRvcEpochs, type TrainingStage, type VoiceModelInfo } from '../../../shared/voice/types';
import { voicePhase } from './job-progress';

// 声のモデルの学習。学習用の音声は学習セット (training-sets.ts) から読む。
// 学習時のパラメーターはアプリが決める (利用者は名前を付けるだけ)。

// --- 学習の実行 ---

// 学習の手順 (駆動スクリプトが知らせる段階の順)。手順ごとの重さは学習する音声の量や環境で大きく変わり、
// 全体の割合は決められないため、進捗は手順ごとに示す (「手順 2 / 5」と、その手順の中の進み具合)
const RVC_STEPS: TrainingStage[] = ['preprocess', 'extract', 'train', 'index', 'finalize'];
const TTS_STEPS: TrainingStage[] = ['prepare', 'preprocess', 'extract', 'train', 'finalize'];

type DriverEvent = {
    kind?: string;
    stage?: TrainingStage;
    epoch?: number;
    totalEpochs?: number;
    // 手順の中の進み具合 (0-1。上流のスクリプトの進捗バーから。分からない手順では無い)
    fraction?: number;
    code?: string;
    message?: string;
};

// 学習の駆動スクリプトを実行する。tempDir (作業ディレクトリ) に指示を置き、学習の途中のデータもそこに作らせる
async function runDriver(
    jobId: string,
    component: 'converter' | 'tts',
    script: string,
    steps: TrainingStage[],
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
                    // 手順の中の進み具合: 学習は回数、ほかは上流のスクリプトの進捗バー。分からない間は不定にする
                    const counted = !!(event.epoch && event.totalEpochs);
                    const fraction = counted
                        ? event.epoch! / event.totalEpochs!
                        : typeof event.fraction === 'number'
                          ? event.fraction
                          : undefined;
                    emitJobEvent({
                        jobId,
                        kind: 'progress',
                        percent: fraction !== undefined ? fraction * 100 : null,
                    });
                    const step = steps.indexOf(event.stage) + 1;
                    voicePhase(jobId, `training.${event.stage}`, {
                        ...(fraction !== undefined ? { fraction } : {}),
                        ...(counted ? { current: event.epoch, total: event.totalEpochs } : {}),
                        ...(step > 0 ? { step, steps: steps.length } : {}),
                    });
                }
            },
        }
    );
    if (failure) {
        const { code = 'TRAINING_FAILED', message } = failure as DriverEvent;
        throw new Error(message ? `${code}: ${message}` : code);
    }
    if (result.code !== 0 || !done) throw new Error(`TRAINING_FAILED: ${result.output.join('\n')}`);
}

function internalModelName(): string {
    // 学習処理が作るディレクトリ名に使う。ASCII に限り、Applio が書き換える "trained" を含めない
    return `kura_${crypto.randomBytes(5).toString('hex')}`;
}

export async function startRvcTraining(
    jobId: string,
    setId: string,
    name: string,
    epochs: number
): Promise<VoiceModelInfo> {
    startJob(jobId);
    try {
        // 学習回数は画面で指定する (範囲外は受け付けない)
        if (!isValidRvcEpochs(epochs)) throw new Error('INVALID_EPOCHS');
        return await withTrainingSet('converter', setId, set => trainRvc(jobId, set.audios, name, epochs));
    } finally {
        finishJob(jobId);
    }
}

async function trainRvc(
    jobId: string,
    audios: TrainingSetAudio[],
    name: string,
    epochs: number
): Promise<VoiceModelInfo> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('VOICE_NAME_EMPTY');
    const readiness = await checkFeature('conversionTraining');
    if (!readiness.ready) throw new Error(`MODEL_REQUIRED: ${readiness.missing.join(', ')}`);
    const totalSeconds = audios.reduce((sum, audio) => sum + audio.durationSec, 0);
    if (totalSeconds < 10) throw new Error('TRAINING_DATA_TOO_SHORT');
    const platform = await getPlatformInfo();
    const cuda = platform.gpu.kind === 'cuda' && !!platform.gpu.cudaFlavor;
    const modelName = internalModelName();
    const applio = libraryPaths().source('converter');
    const pretrained = `${CONVERTER_MODEL_DIR}/pretraineds/hifi-gan`;
    // 駆動スクリプトへの指示と学習の途中のデータの置き場 (学習が終わったら消す)
    const temp = newTempDir();
    // 完成したモデルは作成中の置き場に直接書かせ、完成してから声のモデルとして登録する
    const { id, dir } = newVoiceDir('converter');
    try {
        await withGpu(jobId, 'training', () =>
            runDriver(
                jobId,
                'converter',
                'rvc_train.py',
                RVC_STEPS,
                {
                    applioDir: applio,
                    modelName,
                    // 学習セットの音声を直接読む
                    files: audios.map(audio => audio.path),
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
        discardLater(temp);
    }
}

type TtsTrainingOptions = { setId: string; modelType: TtsModelType; name: string };

export async function startTtsTraining(jobId: string, options: TtsTrainingOptions): Promise<VoiceModelInfo> {
    startJob(jobId);
    try {
        return await withTrainingSet('tts', options.setId, set => {
            if (!set.language) throw new Error('TRAINING_SET_LANGUAGE_MISMATCH');
            return trainTts(jobId, set.language, set.audios, options);
        });
    } finally {
        finishJob(jobId);
    }
}

async function trainTts(
    jobId: string,
    language: VoiceLanguage,
    audios: TrainingSetAudio[],
    options: TtsTrainingOptions
): Promise<VoiceModelInfo> {
    const trimmed = options.name.trim();
    if (!trimmed) throw new Error('VOICE_NAME_EMPTY');
    const platform = await getPlatformInfo();
    // 読み上げのモデルの学習は、上流が NVIDIA GPU を前提としているため NVIDIA GPU を使える Windows と Linux でのみ行う
    if (!platform.ttsTrainingAvailable) throw new Error('TTS_TRAINING_UNAVAILABLE');
    if (!LANGUAGE_DEFINITIONS[language].trainingModelTypes.includes(options.modelType)) {
        throw new Error('TTS_MODEL_TYPE_LANGUAGE_MISMATCH');
    }
    const required = ['component:tts', 'component:tts-train', ...ttsTrainingItems(options.modelType, language)];
    const missing = required.filter(item => !isItemInstalled(item));
    if (missing.length > 0) throw new Error(`MODEL_REQUIRED: ${missing.join(', ')}`);

    const byId = new Map(audios.map(audio => [audio.sentenceId, audio.path]));
    const sentences = corpusSentences(language).filter(sentence => byId.has(sentence.id));
    if (sentences.length < LANGUAGE_DEFINITIONS[language].trainingSentences.minimum) {
        throw new Error('TRAINING_DATA_TOO_FEW');
    }
    const clips = sentences.map(sentence => ({
        id: sentence.id,
        // 提示した文章を、その音声の正解テキストとしてそのまま使う
        text: sentence.text,
        // 学習セットの音声を直接読む
        path: byId.get(sentence.id) as string,
    }));

    const memory = platform.gpu.memoryMb ?? 0;
    const batchSize = memory >= 12000 ? 4 : memory >= 10000 ? 3 : memory >= 8000 ? 2 : 1;
    // 全体の学習ステップ数がおよそ 8000 になるように回数を決める
    const stepsPerEpoch = Math.ceil(clips.length / batchSize);
    const epochs = Math.max(20, Math.min(200, Math.round(8000 / stepsPerEpoch)));
    const modelName = internalModelName();
    const repo = libraryPaths().source('tts');
    // 駆動スクリプトへの指示と学習の途中のデータの置き場 (学習が終わったら消す)
    const temp = newTempDir();
    // 完成したモデルは作成中の置き場に直接書かせ、完成してから声のモデルとして登録する
    const { id, dir } = newVoiceDir('tts');
    try {
        await withGpu(jobId, 'training', () =>
            runDriver(
                jobId,
                'tts',
                'sbv2_train.py',
                TTS_STEPS,
                {
                    repoDir: repo,
                    modelName,
                    language,
                    useJpExtra: options.modelType === 'jp-extra',
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
        const tts = { ...ttsMetaFromConfig(config), languages: [language] };
        return await registerTrainedVoice('tts', id, trimmed, { tts });
    } catch (error) {
        await discardVoiceDir('tts', id);
        throw error;
    } finally {
        discardLater(temp);
    }
}
