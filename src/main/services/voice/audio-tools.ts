import fs from 'fs';
import path from 'path';
import { probeJson } from '../ffmpeg/ffprobe';
import { resolveFfmpegPath, runFfmpeg, runTool } from '../ffmpeg/ffmpeg';
import { discardLater, newTempDir, produceFile } from '../work-dir';
import type { AudioExportSettings } from '../../../shared/voice/types';

// 音声機能で使う ffmpeg の処理。中間ファイルは 32bit 浮動小数の WAV とする
// (段階を重ねる処理で音が割れたり精度が落ちたりしないようにするため)。

type AudioInfo = {
    durationSec: number;
    channels: number;
    sampleRate: number;
};

type ProbeResult = {
    streams?: { codec_type?: string; channels?: number; sample_rate?: string; duration?: string }[];
    format?: { duration?: string };
};

// 音声の長さ・チャンネル数・サンプリング周波数を調べる。いずれかが分からない音声は扱えない
export async function probeAudio(filePath: string, jobId?: string): Promise<AudioInfo> {
    const result = await probeJson<ProbeResult>(['-show_streams', '-show_format', '-select_streams', 'a:0', filePath], {
        jobId,
    });
    const stream = result.streams?.find(item => item.codec_type === 'audio');
    if (!stream) throw new Error('NO_AUDIO_STREAM');
    // ストリーム単位の長さを持たない形式 (mkv など) は、コンテナ全体の長さを使う
    const durationSec = Number(stream.duration ?? result.format?.duration);
    const sampleRate = Number(stream.sample_rate);
    const channels = stream.channels;
    if (!Number.isFinite(durationSec) || !(sampleRate > 0) || !channels || channels < 1) {
        throw new Error(`AUDIO_INFO_UNKNOWN: ${filePath}`);
    }
    return { durationSec, channels, sampleRate };
}

// チャンネル数を変える ffmpeg のフィルタ (変えない場合は null)。
// ffmpeg の既定の変換 (-ac) は、モノラル -> ステレオで各チャンネルを -3dB、ステレオ -> モノラルで左右の和の -3dB
// (左右が同じ音なら +3dB) にするため、音量が変わる。ここでは、ステレオ -> モノラルは左右の平均、
// モノラル -> ステレオは同じ音量のまま左右に置く (中央定位) ようにして、音量を変えない。
// 3ch 以上はまず ffmpeg の標準の方法でステレオに縮約する
export function channelFilter(from: number, to: number): string | null {
    if (from === to) return null;
    const average = 'pan=mono|c0=0.5*c0+0.5*c1';
    if (to === 1) return from === 2 ? average : `aformat=channel_layouts=stereo,${average}`;
    return from === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo';
}

// ffmpeg の進み具合 (0-100) を受け取る関数 (段階の残り時間の見積もりに使う)
type ProgressHandler = (percent: number) => void;

type DecodeOptions = {
    jobId?: string;
    onProgress?: ProgressHandler;
    // keep: 元のまま (3ch 以上はステレオへ縮約) / mono: 左右の平均
    channels: 'keep' | 'mono';
};

// 任意の音声 (動画の音声も含む) を内部処理用の WAV にする
export async function decodeToWav(input: string, output: string, options: DecodeOptions): Promise<AudioInfo> {
    const info = await probeAudio(input, options.jobId);
    const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn'];
    const channels = options.channels === 'mono' ? 1 : Math.min(info.channels, 2);
    const filter = channelFilter(info.channels, channels);
    if (filter) args.push('-af', filter);
    args.push('-c:a', 'pcm_f32le', '-f', 'wav', output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await runFfmpeg(args, { jobId: options.jobId, totalSec: info.durationSec, onProgress: options.onProgress });
    return { ...info, channels };
}

// 学習用の音声の形式 (アプリ内の録音と同じ、16bit・モノラルの WAV。サンプリング周波数は元のまま) にする
export async function encodeTrainingWav(input: string, output: string, jobId?: string): Promise<void> {
    const info = await probeAudio(input, jobId);
    const filter = channelFilter(info.channels, 1);
    await produceFile(output, target =>
        runFfmpeg(
            [
                '-hide_banner',
                '-nostdin',
                '-y',
                '-i',
                input,
                '-map',
                '0:a:0',
                '-vn',
                '-sn',
                '-dn',
                ...(filter ? ['-af', filter] : []),
                '-c:a',
                'pcm_s16le',
                '-f',
                'wav',
                target,
            ],
            { jobId }
        )
    );
}

// チャンネル数をそろえる (分離結果を元の音源のチャンネル構成に戻すときなど)。
// durationSec を指定すると、その長さ (このファイルのサンプリング周波数でのサンプル数) に切りそろえる
// (足りない分は無音で埋める)
export async function convertChannels(
    input: string,
    output: string,
    channels: number,
    jobId?: string,
    durationSec?: number,
    onProgress?: ProgressHandler
): Promise<void> {
    const info = await probeAudio(input, jobId);
    const steps = [channelFilter(info.channels, channels)];
    if (durationSec !== undefined) {
        const length = Math.round(durationSec * info.sampleRate);
        steps.push(`apad=whole_len=${length}`, `atrim=end_sample=${length}`);
    }
    const filter = steps.filter(Boolean).join(',');
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            input,
            ...(filter ? ['-af', filter] : []),
            '-c:a',
            'pcm_f32le',
            output,
        ],
        { jobId, totalSec: durationSec ?? info.durationSec, onProgress }
    );
}

// 音声の一部 (サンプル単位) を切り出す
export async function extractSamples(
    input: string,
    output: string,
    start: number,
    frames: number,
    jobId?: string
): Promise<void> {
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            input,
            '-af',
            `atrim=start_sample=${start}:end_sample=${start + frames},asetpts=PTS-STARTPTS`,
            '-c:a',
            'pcm_f32le',
            output,
        ],
        { jobId }
    );
}

// 分離の入力の末尾に足す無音 (秒)。末尾を短く返すモデルがあるため、足して分離し、元の長さに切りそろえる
export const SEPARATION_PAD_SECONDS = 1;

export async function padEnd(
    input: string,
    output: string,
    seconds: number,
    jobId?: string,
    progress?: { totalSec: number; onProgress: ProgressHandler }
): Promise<void> {
    await runFfmpeg(
        ['-hide_banner', '-nostdin', '-y', '-i', input, '-af', `apad=pad_dur=${seconds}`, '-c:a', 'pcm_f32le', output],
        { jobId, ...(progress ? { totalSec: progress.totalSec + seconds, onProgress: progress.onProgress } : {}) }
    );
}

// ffmpeg のビルドに rubberband フィルタが含まれているか (ffmpeg のパスごとに結果を覚える)
const rubberbandCache = new Map<string, boolean>();

export async function hasRubberband(): Promise<boolean> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_FOUND');
    const cached = rubberbandCache.get(ffmpegPath);
    if (cached !== undefined) return cached;
    const result = await runTool(ffmpegPath, ['-hide_banner', '-filters']);
    const available = /^\s*[.A-Z|]+\s+rubberband\s/m.test(result.stdout);
    rubberbandCache.set(ffmpegPath, available);
    return available;
}

export async function requireRubberband(): Promise<void> {
    if (!(await hasRubberband())) throw new Error('RUBBERBAND_UNAVAILABLE');
}

// 統合ラウドネス (ITU-R BS.1770。無音の部分を除いて測る) を LUFS で返す。無音で測れない場合は null
// (ffmpeg の ebur128 は、ゲートを通る区間が無い音を -70 LUFS と報告する)
export async function measureLoudness(
    input: string,
    jobId?: string,
    onProgress?: ProgressHandler
): Promise<number | null> {
    const info = onProgress ? await probeAudio(input, jobId) : null;
    const result = await runFfmpeg(
        ['-hide_banner', '-nostdin', '-i', input, '-map', '0:a:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
        { jobId, totalSec: info?.durationSec, onProgress }
    );
    const matches = [...result.stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)];
    const loudness = matches.length > 0 ? Number(matches[matches.length - 1][1]) : NaN;
    return Number.isFinite(loudness) && loudness > -70 ? loudness : null;
}

// 音の位置がずれる ffmpeg のフィルタ (rubberband・afftdn) を、ずれを打ち消して使う。どちらのフィルタにも、ずれを
// 補正するオプションは無い。どちらも、出力が設定とサンプリング周波数ごとに一定量ずれ (出力のタイムスタンプには
// 表れない)、出力の長さは入力と同じのため、遅れた分の入力の末尾の音は、フィルタの中に残ったまま出力されない。
// 同じ設定・同じサンプリング周波数で短いクリック音を処理してずれを測り (測った値は ffmpeg・設定・周波数ごとに
// 覚える)、入力の前後に無音を足して元の音を最初から最後まで処理させ、ずれのぶん動かした位置から切り出して打ち消す
const CALIBRATION_CLICKS = 16;
const CALIBRATION_INTERVAL_SEC = 0.37;
const CALIBRATION_LEAD_SEC = 0.5;
const CALIBRATION_SEARCH_SEC = 0.05;
// 入力の前後に足す無音 (秒)。フィルタの中に残る音 (ずれの量) より十分に長くする。足した分は最後に切って除く
const ALIGN_PAD_SECONDS = 1;
const filterOffsets = new Map<string, number>();

// ずれ (出力のサンプル数。正の値は遅れ) を返す
async function filterOffset(filter: string, sampleRate: number, tempo: number, jobId?: string): Promise<number> {
    const key = `${resolveFfmpegPath()}|${filter}|${sampleRate}`;
    const cached = filterOffsets.get(key);
    if (cached !== undefined) return cached;
    const length = Math.round((CALIBRATION_LEAD_SEC * 2 + CALIBRATION_CLICKS * CALIBRATION_INTERVAL_SEC) * sampleRate);
    const signal = new Float32Array(length);
    const burst = Math.max(8, Math.round(sampleRate * 0.002));
    const clicks: number[] = [];
    for (let index = 0; index < CALIBRATION_CLICKS; index++) {
        const start = Math.round((CALIBRATION_LEAD_SEC + index * CALIBRATION_INTERVAL_SEC) * sampleRate);
        for (let i = 0; i < burst; i++) {
            const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (burst - 1));
            signal[start + i] = 0.5 * window * Math.sin((2 * Math.PI * 1500 * i) / sampleRate);
        }
        clicks.push(start + peakIndex(signal, start, start + burst));
    }
    const dir = newTempDir();
    try {
        const input = path.join(dir, 'clicks.raw');
        const output = path.join(dir, 'processed.raw');
        fs.writeFileSync(input, Buffer.from(signal.buffer));
        const raw = ['-f', 'f32le', '-ar', String(sampleRate), '-ac', '1'];
        await runFfmpeg(['-hide_banner', '-nostdin', '-y', ...raw, '-i', input, '-af', filter, ...raw, output], {
            jobId,
        });
        const data = fs.readFileSync(output);
        const processed = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.length / 4));
        // 探す範囲は、伸縮後のクリック音の間隔の半分より狭くする (話速を大きく上げると間隔が詰まり、隣のクリック音を拾うため)
        const search = Math.round(
            Math.min(CALIBRATION_SEARCH_SEC, CALIBRATION_INTERVAL_SEC / tempo / 2.5) * sampleRate
        );
        const offsets = clicks
            .map(click => {
                const expected = Math.round(click / tempo);
                const from = Math.max(0, expected - search);
                const to = Math.min(processed.length, expected + search);
                return to > from ? from + peakIndex(processed, from, to) - expected : null;
            })
            .filter((value): value is number => value !== null)
            .sort((a, b) => a - b);
        if (offsets.length === 0) throw new Error('FILTER_CALIBRATION_FAILED');
        const offset = offsets[Math.floor(offsets.length / 2)];
        filterOffsets.set(key, offset);
        return offset;
    } finally {
        discardLater(dir);
    }
}

function peakIndex(samples: Float32Array, from: number, to: number): number {
    let best = from;
    for (let i = from; i < to; i++) if (Math.abs(samples[i]) > Math.abs(samples[best])) best = i;
    return best - from;
}

// 音の位置がずれるフィルタで処理し、ずれを打ち消して、長さを「元の長さ ÷ tempo」にそろえる
export async function runAlignedFilter(
    input: string,
    output: string,
    filter: string,
    tempo: number,
    jobId?: string,
    onProgress?: ProgressHandler
): Promise<void> {
    const info = await probeAudio(input, jobId);
    const offset = await filterOffset(filter, info.sampleRate, tempo, jobId);
    const length = Math.round((info.durationSec * info.sampleRate) / tempo);
    const pad = Math.round(ALIGN_PAD_SECONDS * info.sampleRate);
    // 入力の前後に無音を足してから処理し、出力から元の音の範囲 (足した無音の後ろから、ずれの分を動かした位置) を
    // 長さの分だけ切り出す。先頭にも足すのは、フィルタが処理を始めた直後の音を正しく処理しないため
    // (afftdn は前の区間が無いと弱め、rubberband は失う)。足りない分は無音で埋める
    const start = Math.round(pad / tempo) + offset;
    const chain = [
        `adelay=delays=${pad}S:all=1`,
        `apad=pad_len=${pad}`,
        filter,
        `atrim=start_sample=${start},asetpts=PTS-STARTPTS`,
        `apad=whole_len=${length}`,
        `atrim=end_sample=${length}`,
    ].join(',');
    await runFfmpeg(['-hide_banner', '-nostdin', '-y', '-i', input, '-af', chain, '-c:a', 'pcm_f32le', output], {
        jobId,
        totalSec: (info.durationSec + 2 * ALIGN_PAD_SECONDS) / tempo,
        onProgress,
    });
}

// rubberband で処理する (ずれを打ち消す)
async function runRubberband(
    input: string,
    output: string,
    filter: string,
    tempo: number,
    jobId?: string,
    onProgress?: ProgressHandler
) {
    await requireRubberband();
    await runAlignedFilter(input, output, filter, tempo, jobId, onProgress);
}

// 音程を半音単位で変える (伴奏の移調)。長さと音の位置は変えない
export async function pitchShift(
    input: string,
    output: string,
    semitones: number,
    jobId?: string,
    onProgress?: ProgressHandler
): Promise<void> {
    const ratio = Math.pow(2, semitones / 12);
    await runRubberband(input, output, `rubberband=pitch=${ratio.toFixed(6)}:pitchq=quality`, 1, jobId, onProgress);
}

// 音程を変えずに長さを変える (読み上げの話速の微調整)。tempo > 1 で短くなる。先頭の位置は変えない
export async function timeStretch(input: string, output: string, tempo: number, jobId?: string): Promise<void> {
    // ffmpeg の rubberband が受け付ける倍率は 100 倍まで。それを超える倍率は 100 倍以下の段に分けてつなぐ
    const stages: number[] = [];
    let rest = tempo;
    while (rest > RUBBERBAND_MAX_TEMPO) {
        stages.push(RUBBERBAND_MAX_TEMPO);
        rest /= RUBBERBAND_MAX_TEMPO;
    }
    stages.push(rest);
    const filter = stages.map(stage => `rubberband=tempo=${stage.toFixed(6)}`).join(',');
    await runRubberband(input, output, filter, tempo, jobId);
}

// ffmpeg の rubberband フィルタの tempo の上限
const RUBBERBAND_MAX_TEMPO = 100;

// 複数の音声を重ねる (分離した音を重ねて再生・変換の入力にする)。
// 音量の自動調整は行わず、そのままの大きさで足し合わせる
export async function mixFiles(
    inputs: string[],
    output: string,
    format: { channels: number },
    jobId?: string,
    onProgress?: ProgressHandler
): Promise<void> {
    if (inputs.length === 0) throw new Error('NO_INPUT');
    const args = ['-hide_banner', '-nostdin', '-y'];
    for (const input of inputs) args.push('-i', input);
    const filters: string[] = [];
    const labels: string[] = [];
    let longest = 0;
    for (let index = 0; index < inputs.length; index++) {
        const info = await probeAudio(inputs[index], jobId);
        longest = Math.max(longest, info.durationSec);
        const filter = channelFilter(info.channels, format.channels);
        filters.push(`[${index}:a]${filter ?? 'anull'}[a${index}]`);
        labels.push(`[a${index}]`);
    }
    if (inputs.length === 1) {
        filters.push(`${labels[0]}anull[out]`);
    } else {
        filters.push(`${labels.join('')}amix=inputs=${inputs.length}:duration=longest:normalize=0[out]`);
    }
    args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'pcm_f32le', output);
    await runFfmpeg(args, { jobId, totalSec: longest, onProgress });
}

// MP3 の可変ビットレートの品質 (LAME の -V)。目安のビットレートに平均が近くなる値を選ぶ
function mp3VbrQuality(bitrate: number): string {
    if (bitrate >= 245) return '0';
    if (bitrate >= 225) return '1';
    if (bitrate >= 190) return '2';
    if (bitrate >= 175) return '3';
    if (bitrate >= 165) return '4';
    if (bitrate >= 130) return '5';
    if (bitrate >= 115) return '6';
    if (bitrate >= 100) return '7';
    if (bitrate >= 85) return '8';
    return '9';
}

// 書き出し (MP3 / FLAC)
export async function encodeExport(
    input: string,
    output: string,
    settings: AudioExportSettings,
    jobId?: string,
    onProgress?: ProgressHandler
): Promise<void> {
    const info = await probeAudio(input, jobId);
    const args = ['-hide_banner', '-nostdin', '-nostats', '-y', '-i', input, '-map', '0:a:0'];
    if (settings.format === 'mp3') {
        args.push('-ar', String(settings.sampleRate), '-c:a', 'libmp3lame');
        if (settings.bitrateMode === 'vbr') args.push('-q:a', mp3VbrQuality(settings.bitrate));
        else args.push('-b:a', `${settings.bitrate}k`);
    } else {
        // FLAC は 24bit で書き出す (浮動小数の中間ファイルから精度を落としすぎないため)
        args.push('-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24');
    }
    // 別の名前に書いてから、名前の変更で既存のファイルを置き換える (失敗しても既存のファイルは残る)
    await produceFile(output, target =>
        runFfmpeg([...args, target], { jobId, totalSec: info.durationSec, onProgress })
    );
}
