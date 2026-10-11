import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { fileStartOf, probeStreams } from './probe';
import type { TrackTagWaveform } from '../../../shared/types';

// 動画トラック・タグ管理: 音声のトラックの波形 (チャンネルごと・区間ごとの音の大きさの最大)。区間ごとの最大を
// ffmpeg (astats) で求めるため、音声そのものを受け取るより短い時間で済む

// 区間の数のおおよその上限 (長い音声ほど区間を長くする)
const MAX_BUCKETS = 20000;
// 区間の長さの下限 (秒)
const MIN_STEP_SEC = 0.01;

// チャンネルごと・区間ごとの最大の大きさを、時刻 (pts_time) と最大 (lavfi.astats.<チャンネル>.Peak_level。dB) の行で
// 書き出すフィルタ。3 チャンネル以上はステレオにまとめてから求める
function peakFilter(samples: number, toStereo: boolean, measurePeakOnly: boolean): string {
    const stats = measurePeakOnly
        ? 'astats=metadata=1:reset=1:measure_overall=none:measure_perchannel=Peak_level'
        : 'astats=metadata=1:reset=1';
    return [
        ...(toStereo ? ['aformat=channel_layouts=stereo'] : []),
        `asetnsamples=n=${samples}`,
        stats,
        'ametadata=print:file=-',
    ].join(',');
}

// source の streamIndex のトラックの波形。時刻はファイルの始まりを 0 とする (チャプター・フレームと同じ。fileStartOf)
export async function probeWaveform(
    source: string,
    streamIndex: number,
    durationSec: number | null
): Promise<TrackTagWaveform> {
    const stream = (await probeStreams(source)).find(item => item.index === streamIndex);
    const sampleRate = Number(stream?.sample_rate);
    if (!stream || stream.codec_type !== 'audio' || !(sampleRate > 0)) return { step: 0, channels: [] };
    const channelCount = Math.min(2, Math.max(1, stream.channels ?? 1));
    const toStereo = (stream.channels ?? 1) > 2;
    const step = Math.max(MIN_STEP_SEC, (durationSec ?? 0) / MAX_BUCKETS);
    const samples = Math.max(1, Math.round(sampleRate * step));
    const run = (measurePeakOnly: boolean) =>
        runFfmpeg([
            '-v',
            'error',
            '-i',
            source,
            '-map',
            `0:${streamIndex}`,
            '-af',
            peakFilter(samples, toStereo, measurePeakOnly),
            '-f',
            'null',
            '-',
        ]);
    // measure_overall・measure_perchannel を持たない ffmpeg では、すべての値を求める形で読み直す
    const result = await run(true).catch(() => run(false));
    const start = await fileStartOf(source);
    const bucketSec = samples / sampleRate;
    const channels: number[][] = Array.from({ length: channelCount }, () => []);
    let time: number | null = null;
    for (const line of result.stdout.split(/\r?\n/)) {
        const frame = /pts_time:(-?[\d.]+)/.exec(line);
        if (frame) {
            time = Number(frame[1]) - start;
            continue;
        }
        const level = /^lavfi\.astats\.(\d+)\.Peak_level=(.+)$/.exec(line.trim());
        if (!level || time === null || !Number.isFinite(time) || time < 0) continue;
        const peaks = channels[Number(level[1]) - 1];
        if (!peaks) continue;
        const db = Number(level[2]);
        const index = Math.round(time / bucketSec);
        while (peaks.length < index) peaks.push(0);
        peaks[index] = Math.max(peaks[index] ?? 0, Number.isFinite(db) ? Math.min(1, 10 ** (db / 20)) : 0);
    }
    return { step: bucketSec, channels };
}
