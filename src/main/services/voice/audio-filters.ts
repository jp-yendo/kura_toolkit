import fs from 'fs';
import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { measureLoudness, TRUE_PEAK_LIMIT } from '../audio-normalizer';
import { padEnd, probeAudio, runAlignedFilter, SEPARATION_PAD_SECONDS } from './audio-tools';
import { isItemInstalled } from './library';
import { getWorker } from './python-worker';
import { separatorItemId } from './spec';
import { ffmpegPhase, voicePhase, workerEvents } from './job-progress';
import { withGpu } from './gpu-lock';
import { modelPaths } from './paths';
import { resolveFfmpegPath } from '../ffmpeg/ffmpeg';
import { discardLater } from '../work-dir';
import { DEFAULT_SEPARATION_PARAMS } from '../../../shared/voice/separation-defaults';
import {
    DEREVERB_MODELS,
    NOISE_REMOVAL_MODELS,
    type DereverbOption,
    type LoudnessOption,
    type NoiseRemovalOption,
    type SilenceOption,
} from '../../../shared/voice/audio-filters';
import type { VoiceComponentId } from '../../../shared/voice/types';

// 声の音の加工 (残響・エコーの除去・無音の扱い・ノイズ除去・音量をそろえる)。学習用の音のフィルターと分岐の「その他」で
// 使い、変換では残響・エコーの除去とノイズ除去を使う (変換の無音の扱いは converter_service.rpc_convert の中で行う)。
// どれも入力を変えずに output に書く
// (書く形式は 32bit 浮動小数の WAV。音量をそろえる処理で測れない場合だけは、入力をそのまま写す)

// 無音部分の音量を 0 にする (mute。長さは変わらない) か、除去して詰める (remove)。無音の判断は Python の処理役で行う
// (component は、その機能で使っている処理役)。長さ (秒) を返す
export async function editSilence(
    jobId: string,
    component: VoiceComponentId,
    input: string,
    output: string,
    option: SilenceOption,
    mode: 'mute' | 'remove'
): Promise<number> {
    voicePhase(jobId, 'silence', { fraction: 0 });
    const result = await getWorker(component).request<{ durationSec: number }>(
        'edit_silence',
        { input, output, thresholdDb: option.thresholdDb, minSeconds: option.minSeconds, mode },
        { jobId, onEvent: workerEvents(jobId) }
    );
    return result.durationSec;
}

// ノイズ除去の「モデルで除去する」で使うモデル。指定されたモデルが取得済みのおすすめならそれ、無ければ取得済みの
// おすすめのうち先頭。1 つも無ければ null
export function noiseRemovalModel(requested: string | null): (typeof NOISE_REMOVAL_MODELS)[number] | null {
    const installed = NOISE_REMOVAL_MODELS.filter(model => isItemInstalled(separatorItemId(model.filename)));
    return installed.find(model => model.filename === requested) ?? installed[0] ?? null;
}

// 残響・エコーの除去で使うモデル。指定されたモデルが取得済みのおすすめならそれ、無ければ取得済みのおすすめのうち先頭。
// 1 つも無ければ null
export function dereverbModel(requested: string | null): (typeof DEREVERB_MODELS)[number] | null {
    const installed = DEREVERB_MODELS.filter(model => isItemInstalled(separatorItemId(model.filename)));
    return installed.find(model => model.filename === requested) ?? installed[0] ?? null;
}

// 残響・エコーを除去する。残響・エコーの除去のモデルで分離して、残響を除いた方の出力を使う (途中のファイルは tempDir に作る)
export async function removeReverb(
    jobId: string,
    input: string,
    output: string,
    option: DereverbOption,
    tempDir: string
): Promise<void> {
    const model = dereverbModel(option.model);
    if (!model) throw new Error('DEREVERB_MODEL_REQUIRED');
    voicePhase(jobId, 'dereverb', { fraction: 0 });
    await separateOneStem(
        jobId,
        'dereverb',
        input,
        model.filename,
        model.cleanStem,
        output,
        path.join(tempDir, 'dereverb-model')
    );
}

// ノイズを除去する。FFT の場合は ffmpeg の afftdn (音の位置がずれるため、ずれを打ち消して使う)、ウェーブレットの場合は
// ffmpeg の afwtdn (音の位置はずれない)、モデルの場合はノイズ除去のモデルで分離して、ノイズを除いた方の出力を使う
// (途中のファイルは tempDir に作る)
export async function removeNoise(
    jobId: string,
    input: string,
    output: string,
    option: NoiseRemovalOption,
    tempDir: string
): Promise<void> {
    if (option.method === 'model') {
        const model = noiseRemovalModel(option.model);
        if (!model) throw new Error('NOISE_REMOVAL_MODEL_REQUIRED');
        voicePhase(jobId, 'noiseRemoval', { fraction: 0 });
        await separateOneStem(
            jobId,
            'noiseRemoval',
            input,
            model.filename,
            model.cleanStem,
            output,
            path.join(tempDir, 'noise-model')
        );
        return;
    }
    if (option.method === 'wavelet') {
        // afwtdn の sigma は雑音の大きさを振幅 (0-1) で指定する
        const sigma = Math.pow(10, option.waveletNoiseDb / 20);
        const { durationSec } = await probeAudio(input, jobId);
        await runFfmpeg(
            [
                '-hide_banner',
                '-nostdin',
                '-y',
                '-i',
                input,
                '-af',
                `afwtdn=sigma=${sigma.toPrecision(6)}:percent=${option.waveletPercent}`,
                '-c:a',
                'pcm_f32le',
                output,
            ],
            { jobId, totalSec: durationSec, onProgress: ffmpegPhase(jobId, 'noiseRemoval') }
        );
        return;
    }
    await runAlignedFilter(
        input,
        output,
        `afftdn=nf=${option.floorDb}:nr=${option.reductionDb}`,
        1,
        jobId,
        ffmpegPhase(jobId, 'noiseRemoval')
    );
}

// 音量をそろえる。ファイル全体を一律に上げ下げし、上げた後の True Peak が上限を超える場合は上限までにとどめる
// (オーディオ正規化と同じ)。無音などで測れない場合は、そのまま写す
export async function normalizeLoudness(
    jobId: string,
    input: string,
    output: string,
    option: LoudnessOption
): Promise<void> {
    const { durationSec } = await probeAudio(input, jobId);
    const measure = ffmpegPhase(jobId, 'loudness');
    const { lufs, truePeak } = await measureLoudness(input, jobId, durationSec, percent => measure(percent / 2));
    if (lufs === null || truePeak === null) {
        await fs.promises.copyFile(input, output);
        return;
    }
    let gain = option.targetLufs - lufs;
    if (truePeak + gain > TRUE_PEAK_LIMIT) gain = TRUE_PEAK_LIMIT - truePeak;
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            input,
            '-af',
            `volume=${gain.toFixed(2)}dB`,
            '-c:a',
            'pcm_f32le',
            output,
        ],
        { jobId, totalSec: durationSec, onProgress: percent => measure(50 + percent / 2) }
    );
}

// 1 つのモデルでファイルを分離し、指定した出力 (名前。大文字・小文字は区別しない) を output に書く。チャンネル数と長さは
// 入力にそろえる (残響・エコーの除去と、ノイズ除去の「モデルで除去する」で使う。進み具合は phase の段階として示す)。
// 途中のファイルは dir に作り、終わったら片付けの一覧に積む
async function separateOneStem(
    jobId: string,
    phase: 'noiseRemoval' | 'dereverb',
    input: string,
    filename: string,
    stemName: string,
    output: string,
    dir: string
): Promise<void> {
    if (!resolveFfmpegPath()) throw new Error('FFMPEG_NOT_FOUND');
    if (!isItemInstalled(separatorItemId(filename)))
        throw new Error(`MODEL_NOT_INSTALLED: ${separatorItemId(filename)}`);
    const info = await probeAudio(input, jobId);
    const padded = path.join(dir, 'input.wav');
    fs.mkdirSync(dir, { recursive: true });
    try {
        await padEnd(input, padded, SEPARATION_PAD_SECONDS, jobId, {
            totalSec: info.durationSec,
            onProgress: percent => voicePhase(jobId, phase, { fraction: (0.1 * percent) / 100 }),
        });
        const result = await withGpu(jobId, 'separator', () =>
            getWorker('separator').request<{ stems: { name: string; path: string }[] }>(
                'separate',
                {
                    modelDir: modelPaths().group('separator'),
                    outputDir: path.join(dir, 'stems'),
                    input: padded,
                    method: { kind: 'model', filename },
                    params: DEFAULT_SEPARATION_PARAMS,
                },
                {
                    jobId,
                    // 呼び出し側のジョブの進み具合を上書きしないよう、その段階の進み具合として示す
                    onEvent: event => {
                        if (event.kind === 'progress' && typeof event.fraction === 'number') {
                            voicePhase(jobId, phase, { fraction: 0.1 + 0.85 * event.fraction });
                        }
                    },
                }
            )
        );
        const stem = result.stems.find(item => item.name.toLowerCase() === stemName.toLowerCase());
        if (!stem) throw new Error(`STEM_NOT_FOUND: ${stemName}`);
        // 分離の出力は決まったサンプリング周波数のため、入力のサンプリング周波数とチャンネル数に戻す
        // (変換結果はモデルの周波数のまま持つなど、呼び出し側が周波数を前提にしているため)。チャンネル数を減らすときは
        // 左右の平均にする (rematrix_maxval=1。ffmpeg の既定では左右を 0.707 倍ずつ足すため、左右が同じ音は +3dB になる)
        await runFfmpeg(
            [
                '-hide_banner',
                '-nostdin',
                '-y',
                '-i',
                stem.path,
                '-af',
                'aresample=rematrix_maxval=1',
                '-ac',
                String(Math.min(2, info.channels)),
                '-ar',
                String(info.sampleRate),
                '-t',
                String(info.durationSec),
                '-c:a',
                'pcm_f32le',
                output,
            ],
            { jobId }
        );
    } finally {
        discardLater(dir);
    }
}
