import fs from 'fs';
import path from 'path';
import { probeJson } from './ffmpeg/ffprobe';
import { isCancelledError, runFfmpeg } from './ffmpeg/ffmpeg';
import { emitJobEvent, finishJob, isCancelled, startJob } from './job-manager';
import type {
    AudioProbeItem,
    AudioNormalizeInput,
    AudioAnalyzeItem,
    AudioAnalyzeResult,
    AudioNormalizeItem,
    AudioNormalizeResult,
    AudioNormalizerSettings,
    AudioOutputCheck,
} from '../../shared/types';

// オーディオのラウドネス解析と正規化

type FfprobeStream = {
    codec_type?: string;
    codec_name?: string;
    channels?: number;
};

type FfprobeStreamsResult = {
    streams?: FfprobeStream[];
    format?: { duration?: string };
};

// 入力コーデック -> ffmpeg エンコーダのマップ (フォーマット維持で再エンコードする)
const ENCODER_MAP: Record<string, string> = {
    mp3: 'libmp3lame',
    aac: 'aac',
    vorbis: 'libvorbis',
    opus: 'libopus',
    flac: 'flac',
};

// LAME VBR 品質 (-q:a) の近似マップ (目標ビットレート kbps -> 品質値)
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

// Vorbis VBR 品質 (-q:a) の近似マップ
function vorbisVbrQuality(bitrate: number): string {
    if (bitrate >= 320) return '9';
    if (bitrate >= 256) return '8';
    if (bitrate >= 224) return '7';
    if (bitrate >= 192) return '6';
    if (bitrate >= 160) return '5';
    if (bitrate >= 128) return '4';
    if (bitrate >= 112) return '3';
    if (bitrate >= 96) return '2';
    if (bitrate >= 80) return '1';
    return '0';
}

// libopus が受け付けるサンプリング周波数 (これ以外を渡すとエンコードに失敗する)
const OPUS_SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000];

// エンコーダが対応しないサンプリング周波数を、対応する最も近い上位の値へ丸める
function resolveSampleRate(encoder: string, requested: number): number {
    if (encoder !== 'libopus') return requested;
    return OPUS_SAMPLE_RATES.find(rate => rate >= requested) ?? 48000;
}

// loudnorm が stderr 末尾に出力する JSON ブロックを抽出する
function extractLoudnormJson(stderr: string): Record<string, string> | null {
    const matches = stderr.match(/\{[^{}]*\}/g);
    if (!matches) return null;
    for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i].includes('input_i')) {
            try {
                return JSON.parse(matches[i]) as Record<string, string>;
            } catch {
                return null;
            }
        }
    }
    return null;
}

async function probeAudio(filePath: string, jobId: string): Promise<FfprobeStreamsResult> {
    return probeJson<FfprobeStreamsResult>(['-show_streams', '-show_format', filePath], { jobId });
}

function firstAudioStream(probe: FfprobeStreamsResult): FfprobeStream | undefined {
    return probe.streams?.find(stream => stream.codec_type === 'audio');
}

// 一覧に加えたファイルの長さとチャンネル数 (画面の一覧に示し、全体の進み具合の配分に使う)。調べられないものは null
export async function probeFiles(files: string[]): Promise<AudioProbeItem[]> {
    const items: AudioProbeItem[] = [];
    for (const filePath of files) {
        try {
            const probe = await probeJson<FfprobeStreamsResult>(['-show_streams', '-show_format', filePath]);
            const duration = Number.parseFloat(probe.format?.duration ?? '');
            items.push({
                path: filePath,
                durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
                channels: firstAudioStream(probe)?.channels ?? null,
            });
        } catch {
            // 読めないファイルは、解析・正規化のときにエラーとして示す
            items.push({ path: filePath, durationSec: null, channels: null });
        }
    }
    return items;
}

// 全体の進み具合の配分 (ファイルごとの長さ、秒)。全体の進み具合を長さの合計で決め、ファイルが終わるたびにその
// 長さを足す (ファイルの長さが違っても進み方がずれず、残り時間を見積もれるように)。長さは一覧に加えたときに調べた
// もので、分からないファイルは分かったファイルの平均 (どれも分からなければ 1) とする
function durationWeights(files: string[], durations: (number | null)[]): number[] {
    const known = durations.filter((value): value is number => typeof value === 'number' && value > 0);
    const fallback = known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : 1;
    return files.map((_, index) => {
        const value = durations[index];
        return typeof value === 'number' && value > 0 ? value : fallback;
    });
}

// 終わったファイルの長さの合計と、ファイルの中の進み具合 (0-100) から、全体の進み具合 (%) を求める
function weightedPercent(weights: number[], index: number, filePercent = 0): number {
    const total = weights.reduce((sum, value) => sum + value, 0);
    const done = weights.slice(0, index).reduce((sum, value) => sum + value, 0);
    return total > 0 ? ((done + (weights[index] ?? 0) * (filePercent / 100)) / total) * 100 : 0;
}

// 正規化で上げたあとの True Peak の上限 (dBTP)。非可逆圧縮での書き出しやサンプリング周波数の変換でピークが少し
// 上がるための余白
export const TRUE_PEAK_LIMIT = -1.5;

export type Loudness = { lufs: number | null; truePeak: number | null };

function finiteOrNull(value: string | undefined): number | null {
    const parsed = value === undefined ? Number.NaN : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// 曲全体の実測値 (ラウドネスと True Peak)。loudnorm の測定 (結果を出力しない 1 回目) の結果から取る
// (目標値は実測値に影響しない)。無音などで測れないものは null
export async function measureLoudness(
    filePath: string,
    jobId: string,
    totalSec: number | undefined,
    onProgress: (percent: number) => void
): Promise<Loudness> {
    const result = await runFfmpeg(
        ['-hide_banner', '-i', filePath, '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5:print_format=json', '-f', 'null', '-'],
        { jobId, totalSec, onProgress }
    );
    const loudnorm = extractLoudnormJson(result.stderr);
    return { lufs: finiteOrNull(loudnorm?.input_i), truePeak: finiteOrNull(loudnorm?.input_tp) };
}

// 各ファイルのチャンネル数と実測値 (ラウドネスと True Peak) を取得する
export async function analyzeFiles(
    jobId: string,
    files: string[],
    durations: (number | null)[]
): Promise<AudioAnalyzeResult> {
    startJob(jobId);
    const items: AudioAnalyzeItem[] = [];
    let cancelled = false;
    try {
        const weights = durationWeights(files, durations);
        for (let i = 0; i < files.length; i++) {
            if (isCancelled(jobId)) {
                cancelled = true;
                break;
            }
            const filePath = files[i];
            emitJobEvent({
                jobId,
                kind: 'progress',
                current: i + 1,
                total: files.length,
                percent: weightedPercent(weights, i),
                message: path.basename(filePath),
            });
            const item: AudioAnalyzeItem = { path: filePath, channels: null, lufs: null, truePeak: null };
            try {
                const probe = await probeAudio(filePath, jobId);
                item.channels = firstAudioStream(probe)?.channels ?? null;
                const durationSec = Number.parseFloat(probe.format?.duration ?? '');
                const fileIndex = i;
                // ファイルの中の進み具合も全体の進み具合に足す (ファイルが 1 つでも進み、残り時間を見積もれるように)
                const loudness = await measureLoudness(
                    filePath,
                    jobId,
                    Number.isFinite(durationSec) ? durationSec : undefined,
                    percent =>
                        emitJobEvent({
                            jobId,
                            kind: 'progress',
                            current: fileIndex + 1,
                            total: files.length,
                            percent: weightedPercent(weights, fileIndex, percent),
                            message: path.basename(filePath),
                        })
                );
                item.lufs = loudness.lufs;
                item.truePeak = loudness.truePeak;
            } catch (error) {
                if (isCancelledError(error)) {
                    cancelled = true;
                    items.push(item);
                    break;
                }
                item.error = error instanceof Error ? error.message : String(error);
            }
            items.push(item);
        }
    } finally {
        finishJob(jobId);
    }
    return { items, cancelled: cancelled || isCancelled(jobId) };
}

function buildEncoderArgs(codec: string, encoder: string, options: AudioNormalizerSettings): string[] {
    const bitrateArg = `${options.bitrate}k`;
    if (encoder === 'flac' || codec.startsWith('pcm_')) {
        // ロスレスにビットレート指定は不要
        return [];
    }
    if (encoder === 'libmp3lame') {
        if (options.bitrateMode === 'vbr') {
            return ['-q:a', mp3VbrQuality(options.bitrate)];
        }
        return ['-b:a', bitrateArg];
    }
    if (encoder === 'libvorbis') {
        if (options.bitrateMode === 'vbr') {
            return ['-q:a', vorbisVbrQuality(options.bitrate)];
        }
        return ['-b:a', bitrateArg];
    }
    if (encoder === 'libopus') {
        if (options.bitrateMode === 'cbr') {
            return ['-vbr', 'off', '-b:a', bitrateArg];
        }
        return ['-b:a', bitrateArg];
    }
    // aac などは常にビットレート指定
    return ['-b:a', bitrateArg];
}

// 出力パスの決め方。出力先が未指定の場合は入力と同じディレクトリ (= 元のファイルの上書き) になる
function resolveOutputPath(filePath: string, outputDir: string): string {
    return path.join(outputDir || path.dirname(filePath), path.basename(filePath));
}

// パス比較用のキー。Windows は大文字小文字を区別しないため小文字へ揃える
function pathKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// 出力パスが重複する入力の一覧 (別ディレクトリの同名ファイルを 1 つの出力先へ出す場合)
function findDuplicatedOutputs(files: string[], outputDir: string): string[] {
    const seen = new Set<string>();
    const duplicated = new Map<string, string>();
    for (const filePath of files) {
        const outputPath = resolveOutputPath(filePath, outputDir);
        const key = pathKey(outputPath);
        if (seen.has(key)) {
            duplicated.set(key, outputPath);
        } else {
            seen.add(key);
        }
    }
    return [...duplicated.values()];
}

// 正規化を実行する前に出力先を調べる。既存ファイル (上書き) と出力パスの重複を返す
export function checkOutputs(files: string[], outputDir: string): AudioOutputCheck {
    const existing = new Map<string, string>();
    for (const filePath of files) {
        const outputPath = resolveOutputPath(filePath, outputDir);
        try {
            if (fs.existsSync(outputPath)) existing.set(pathKey(outputPath), outputPath);
        } catch {
            // 判定できない場合は確認対象にしない (実行時に改めて失敗を返す)
        }
    }
    return { existing: [...existing.values()], duplicated: findDuplicatedOutputs(files, outputDir) };
}

// 指定ターゲット LUFS へ正規化し、出力先ディレクトリへ同名で書き出す。
// 曲全体に一定量の音量をかけるだけにする (曲の中の強弱を保つ)。かける量は「目標 - 実測のラウドネス」で、上げた後の
// True Peak が上限を超える場合は、上限に収まる量までにする (その曲は目標に届かない)。実測値は解析で求めたものを使い、
// 解析していないファイルは先に測る。loudnorm の 2 回目は使わない (条件を満たさないと曲の中の音量を細かく調整する
// 方式に切り替わり、強弱が変わるため)
export async function normalizeFiles(
    jobId: string,
    inputs: AudioNormalizeInput[],
    options: AudioNormalizerSettings
): Promise<AudioNormalizeResult> {
    const files = inputs.map(input => input.path);
    // 出力パスが重複する指定は必ず互いを上書きするため、1 件も処理せずに失敗させる
    if (findDuplicatedOutputs(files, options.outputDir).length > 0) {
        throw new Error('DUPLICATE_OUTPUTS');
    }
    startJob(jobId);
    const items: AudioNormalizeItem[] = [];
    let cancelled = false;
    try {
        // 測る必要があるファイルは、測る分 (読み込み 1 回分) を足して配分する
        const needsMeasure = inputs.map(input => input.lufs === null || input.truePeak === null);
        const weights = durationWeights(
            files,
            inputs.map(input => input.durationSec)
        ).map((weight, index) => (needsMeasure[index] ? weight * 2 : weight));
        for (let i = 0; i < files.length; i++) {
            if (isCancelled(jobId)) {
                cancelled = true;
                break;
            }
            const filePath = files[i];
            const outputPath = resolveOutputPath(filePath, options.outputDir);
            const outputDir = path.dirname(outputPath);
            // 出力は同じフォルダに別の名前で書き、完成してから正式な名前にする (上書きする場合に、途中で
            // 失敗しても元のファイルが残るようにするため。ffmpeg は読み込み中のファイルへ直接書けない)
            const extension = path.extname(outputPath);
            const writePath = path.join(outputDir, `${path.basename(outputPath, extension)}.kura-tmp${extension}`);
            const item: AudioNormalizeItem = { path: filePath, outputPath, ok: false };
            emitJobEvent({
                jobId,
                kind: 'progress',
                current: i + 1,
                total: files.length,
                percent: weightedPercent(weights, i),
                message: path.basename(filePath),
            });
            try {
                const probe = await probeAudio(filePath, jobId);
                const audioStream = firstAudioStream(probe);
                const codec = audioStream?.codec_name ?? '';
                let encoder: string | undefined = ENCODER_MAP[codec];
                if (!encoder && codec.startsWith('pcm_')) {
                    // 無圧縮 PCM は同じコーデックで再エンコードする
                    encoder = codec;
                }
                if (!encoder) {
                    // フィルタ適用にはデコード/再エンコードが必須のため未対応コーデックはスキップ
                    item.skipped = true;
                    item.error = `UNSUPPORTED_CODEC: ${codec || 'unknown'}`;
                    items.push(item);
                    continue;
                }

                const durationSec = Number.parseFloat(probe.format?.duration ?? '');
                const totalSec = Number.isFinite(durationSec) ? durationSec : undefined;
                const fileIndex = i;
                // ファイルの中の進み具合 (測る場合は前半を測定、後半を書き出しに当てる)
                const report = (filePercent: number) =>
                    emitJobEvent({
                        jobId,
                        kind: 'progress',
                        current: fileIndex + 1,
                        total: files.length,
                        percent: weightedPercent(weights, fileIndex, filePercent),
                        message: path.basename(filePath),
                    });
                let { lufs, truePeak } = inputs[i];
                if (needsMeasure[i]) {
                    ({ lufs, truePeak } = await measureLoudness(filePath, jobId, totalSec, percent =>
                        report(percent / 2)
                    ));
                    item.lufs = lufs;
                    item.truePeak = truePeak;
                }
                if (lufs === null || truePeak === null) {
                    // 無音などで測れないファイルは、かける量を決められないため書き出さない
                    item.error = 'LOUDNESS_UNKNOWN';
                    items.push(item);
                    continue;
                }
                let gain = options.targetLufs - lufs;
                if (truePeak + gain > TRUE_PEAK_LIMIT) {
                    gain = TRUE_PEAK_LIMIT - truePeak;
                    item.limitedLufs = lufs + gain;
                }
                const encodeOffset = needsMeasure[i] ? 50 : 0;
                const encodeShare = needsMeasure[i] ? 0.5 : 1;
                const args = [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-y',
                    '-i',
                    filePath,
                    '-af',
                    `volume=${gain.toFixed(2)}dB`,
                    '-ar',
                    String(resolveSampleRate(encoder, options.sampleRate)),
                    '-map_metadata',
                    '0',
                    '-map',
                    '0:a:0',
                    '-map',
                    '0:v?',
                    '-c:v',
                    'copy',
                    '-c:a',
                    encoder,
                    ...buildEncoderArgs(codec, encoder, options),
                    writePath,
                ];
                await runFfmpeg(args, {
                    jobId,
                    totalSec,
                    onProgress: percent => report(encodeOffset + percent * encodeShare),
                });
                fs.renameSync(writePath, outputPath);
                item.ok = true;
                item.inputReplaced = pathKey(outputPath) === pathKey(filePath);
            } catch (error) {
                // 書きかけの出力ファイルを削除 (別の名前に書いているため、上書きする元のファイルは残る)
                try {
                    if (fs.existsSync(writePath)) fs.unlinkSync(writePath);
                } catch {
                    // 削除失敗は無視
                }
                if (isCancelledError(error)) {
                    cancelled = true;
                    items.push(item);
                    break;
                }
                item.error = error instanceof Error ? error.message : String(error);
            }
            items.push(item);
        }
    } finally {
        finishJob(jobId);
    }
    return { items, cancelled: cancelled || isCancelled(jobId) };
}
