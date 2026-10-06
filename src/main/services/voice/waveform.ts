import fs from 'fs';
import { resolveFfmpegPath } from '../ffmpeg/ffmpeg';
import { mediaPathOf } from '../media-protocol';
import { killTree, spawnGroup } from '../../utils/process-tree';
import { channelFilter, probeAudio } from './audio-tools';
import { WAVEFORM_BUCKETS, type WaveformData } from '../../../shared/voice/types';

// プレビューの波形。ffmpeg で音声を 32bit 浮動小数に展開しながら少しずつ読み、チャンネルごとに
// WAVEFORM_BUCKETS 個の区間の最小値・最大値にまとめる (音声全体をメモリに置かない)。
// 3ch 以上の音声はステレオにまとめて示す。作った波形はファイル (パス・更新時刻・大きさ) ごとに覚える

// 覚えておく波形の数 (古いものから忘れる。1 つあたり最大 64KB)
const CACHE_ENTRIES = 32;
const cache = new Map<string, WaveformData>();

function remember(key: string, data: WaveformData): void {
    cache.delete(key);
    cache.set(key, data);
    while (cache.size > CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

// 再生用の URL (kura-media://) で公開しているファイルの波形を返す
export async function mediaWaveform(url: string): Promise<WaveformData> {
    const filePath = mediaPathOf(url);
    if (!filePath) throw new Error('INVALID_PATH');
    const stat = fs.statSync(filePath);
    const key = `${filePath}|${stat.mtimeMs}|${stat.size}`;
    const cached = cache.get(key);
    if (cached) {
        remember(key, cached);
        return cached;
    }
    const data = await buildWaveform(filePath);
    remember(key, data);
    return data;
}

async function buildWaveform(filePath: string): Promise<WaveformData> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_FOUND');
    const info = await probeAudio(filePath);
    const channels = Math.min(info.channels, 2);
    const filter = channelFilter(info.channels, channels);
    const totalFrames = Math.max(1, Math.round(info.durationSec * info.sampleRate));
    // チャンネルごとに [最小, 最大] を区間の数だけ並べる
    const peaks = Array.from({ length: channels }, () => new Float32Array(WAVEFORM_BUCKETS * 2));
    const args = ['-hide_banner', '-nostdin', '-v', 'error', '-i', filePath, '-map', '0:a:0', '-vn', '-sn', '-dn'];
    if (filter) args.push('-af', filter);
    args.push('-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1');

    await new Promise<void>((resolve, reject) => {
        const child = spawnGroup(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const frameBytes = channels * 4;
        let rest: Buffer = Buffer.alloc(0);
        let frame = 0;
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            const data = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
            const frames = Math.floor(data.length / frameBytes);
            const samples = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + frames * frameBytes));
            for (let index = 0; index < frames; index++, frame++) {
                const bucket = Math.min(WAVEFORM_BUCKETS - 1, Math.floor((frame * WAVEFORM_BUCKETS) / totalFrames));
                for (let channel = 0; channel < channels; channel++) {
                    const value = samples[index * channels + channel];
                    const target = peaks[channel];
                    if (value < target[bucket * 2]) target[bucket * 2] = value;
                    if (value > target[bucket * 2 + 1]) target[bucket * 2 + 1] = value;
                }
            }
            rest = data.subarray(frames * frameBytes);
        });
        child.stderr?.setEncoding('utf-8');
        child.stderr?.on('data', (text: string) => {
            stderr += text;
        });
        child.on('error', error => {
            killTree(child);
            reject(error);
        });
        child.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`FFMPEG_FAILED: ${stderr}`));
        });
    });
    return { channels, durationSec: info.durationSec, peaks };
}
