import { probeJson } from '../ffmpeg/ffprobe';
import { fileStartOf, probeStreams } from './probe';
import type { TrackTagFrames } from '../../../shared/types';

// 動画トラック・タグ管理: 本編の映像のフレームとキーフレームの時刻。パケットを読むだけでデコードしないため、
// 長い動画でも短い時間で済む

type FfprobePackets = { packets?: Array<{ pts_time?: string; dts_time?: string; flags?: string }> };

// 本編の映像 (カバーアートを除く最初の映像) のフレームの表示の時刻とキーフレームの時刻。時刻はファイルの始まりを 0 とする
// (チャプターと同じ。fileStartOf)。映像が無ければ空
export async function probeFrames(input: string): Promise<TrackTagFrames> {
    const streams = await probeStreams(input);
    const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    if (!video) return { times: [], keyframes: [] };
    const data = await probeJson<FfprobePackets>([
        '-select_streams',
        String(video.index),
        '-show_entries',
        'packet=pts_time,dts_time,flags',
        input,
    ]);
    const start = await fileStartOf(input);
    const times: number[] = [];
    const keyframes: number[] = [];
    for (const packet of data.packets ?? []) {
        // 表示の時刻を持たない形式 (AVI など) はデコードの時刻で代える
        const time = Number.parseFloat(packet.pts_time ?? packet.dts_time ?? '') - start;
        if (!Number.isFinite(time)) continue;
        times.push(time);
        if (packet.flags?.includes('K')) keyframes.push(time);
    }
    times.sort((a, b) => a - b);
    keyframes.sort((a, b) => a - b);
    return { times, keyframes };
}
