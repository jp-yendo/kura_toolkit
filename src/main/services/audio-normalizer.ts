import fs from 'fs';
import path from 'path';
import { probeJson } from './ffmpeg/ffprobe';
import { isCancelledError, runFfmpeg } from './ffmpeg/ffmpeg';
import { emitJobEvent, finishJob, isCancelled, startJob } from './job-manager';
import type {
    AudioAnalyzeItem,
    AudioAnalyzeResult,
    AudioNormalizeItem,
    AudioNormalizeResult,
    AudioNormalizerSettings,
    AudioOutputCheck,
} from '../../shared/types';

// オーディオのラウドネス解析と正規化 (元: AudioNormalizer/audio_normalizer.py)

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

// 各ファイルのチャンネル数と実測ラウドネス (LUFS) を取得する
export async function analyzeFiles(jobId: string, files: string[]): Promise<AudioAnalyzeResult> {
    startJob(jobId);
    const items: AudioAnalyzeItem[] = [];
    let cancelled = false;
    try {
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
                percent: (i / files.length) * 100,
                message: path.basename(filePath),
            });
            const item: AudioAnalyzeItem = { path: filePath, channels: null, lufs: null };
            try {
                const probe = await probeAudio(filePath, jobId);
                item.channels = firstAudioStream(probe)?.channels ?? null;

                // loudnorm の 1 パス目 (実測値の取得のみ。ターゲット値は実測結果に影響しない)
                const result = await runFfmpeg(
                    [
                        '-hide_banner',
                        '-i',
                        filePath,
                        '-af',
                        'loudnorm=I=-16:LRA=11:TP=-1.5:print_format=json',
                        '-f',
                        'null',
                        '-',
                    ],
                    { jobId }
                );
                const loudnorm = extractLoudnormJson(result.stderr);
                const inputI = loudnorm ? Number.parseFloat(loudnorm.input_i) : Number.NaN;
                item.lufs = Number.isFinite(inputI) ? inputI : null;
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

// 指定ターゲット LUFS へ正規化し、出力先ディレクトリへ同名で書き出す
export async function normalizeFiles(
    jobId: string,
    files: string[],
    options: AudioNormalizerSettings
): Promise<AudioNormalizeResult> {
    // 出力パスが重複する指定は必ず互いを上書きするため、1 件も処理せずに失敗させる
    if (findDuplicatedOutputs(files, options.outputDir).length > 0) {
        throw new Error('DUPLICATE_OUTPUTS');
    }
    startJob(jobId);
    const items: AudioNormalizeItem[] = [];
    let cancelled = false;
    try {
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
                percent: (i / files.length) * 100,
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
                const args = [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-y',
                    '-i',
                    filePath,
                    '-af',
                    `loudnorm=I=${options.targetLufs}:LRA=11:TP=-1.5:linear=true`,
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
                    onProgress: percent => {
                        emitJobEvent({
                            jobId,
                            kind: 'progress',
                            current: fileIndex + 1,
                            total: files.length,
                            percent: ((fileIndex + percent / 100) / files.length) * 100,
                            message: path.basename(filePath),
                        });
                    },
                });
                fs.renameSync(writePath, outputPath);
                item.ok = true;
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
