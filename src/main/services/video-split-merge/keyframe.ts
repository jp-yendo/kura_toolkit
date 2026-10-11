import { probeJson } from '../ffmpeg/ffprobe';
import type { VideoCutBoundary } from '../../../shared/types';

// キーフレーム探索

// 範囲にフレームを含める規則の許容幅 (秒)。表示の時刻が「始まり - FRAME_TOLERANCE」以上・「終わり - FRAME_TOLERANCE」未満の
// フレームを範囲に含める。隣り合う範囲は同じ境界の値を使うため、どのフレームもどちらか一方だけに入る (チャプターの時刻の
// ミリ秒への丸めなどで、境界がフレームの時刻とわずかにずれていても重なりも抜けも出ない)
export const FRAME_TOLERANCE = 0.0005;

type FfprobePacketsResult = {
    packets?: Array<{ pts_time?: string; dts_time?: string; flags?: string }>;
};

// 映像のキーフレームの表示の時刻を、from から to の範囲で読む
async function keyframesBetween(
    input: string,
    streamIndex: number,
    from: number,
    to: number,
    jobId?: string
): Promise<number[]> {
    const data = await probeJson<FfprobePacketsResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time,flags',
            '-read_intervals',
            `${Math.max(0, from).toFixed(6)}%${to.toFixed(6)}`,
            input,
        ],
        { jobId }
    );
    return (data.packets ?? [])
        .filter(packet => packet.flags?.includes('K'))
        .map(packet => Number.parseFloat(packet.pts_time ?? ''))
        .filter(time => Number.isFinite(time))
        .sort((a, b) => a - b);
}

// target 以前で最も近い映像キーフレームの表示の時刻 (time) と、その 1 つ前のキーフレームの表示の時刻 (previous。無ければ null)
// を返す。GOP 長は不明のため、見つかるまで探索窓を広げながら遡る
export async function findKeyframeBefore(
    input: string,
    streamIndex: number,
    target: number,
    jobId?: string
): Promise<{ time: number; previous: number | null }> {
    let window = 30.0;
    for (;;) {
        const begin = Math.max(0, target - window);
        // ごく近い後方のキーフレームは丸め誤差とみなして許容する
        const found = (await keyframesBetween(input, streamIndex, begin, target + 1.0, jobId)).filter(
            time => time <= target + 0.001
        );
        if (found.length >= 2) return { time: found[found.length - 1], previous: found[found.length - 2] };
        if (begin <= 0) return { time: found[0] ?? 0, previous: null };
        window *= 4;
    }
}

// from より後ろ・to より前の映像キーフレームの表示の時刻を、早い順に返す
export async function keyframesWithin(
    input: string,
    streamIndex: number,
    from: number,
    to: number,
    jobId?: string
): Promise<number[]> {
    return (await keyframesBetween(input, streamIndex, from, to + 1.0, jobId)).filter(
        time => time > from + 0.0005 && time < to - 0.0005
    );
}

// 表示の時刻が time 以降の最初の映像のフレームの表示の時刻を返す (切る位置がフレームの途中にある場合、範囲の最初の
// フレームは切る位置より後ろにある)。見つからなければ time
export async function firstFrameFrom(
    input: string,
    streamIndex: number,
    time: number,
    jobId?: string
): Promise<number> {
    const data = await probeJson<FfprobePacketsResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time',
            '-read_intervals',
            `${Math.max(0, time - 1).toFixed(6)}%${(time + 5).toFixed(6)}`,
            input,
        ],
        { jobId }
    );
    const times = (data.packets ?? [])
        .map(packet => Number.parseFloat(packet.pts_time ?? ''))
        .filter(value => Number.isFinite(value) && value >= time - 0.0005);
    return times.length > 0 ? Math.min(...times) : time;
}

// 表示の時刻が from 以上・to より前の映像のフレームの数を返す
export async function countFrames(
    input: string,
    streamIndex: number,
    from: number,
    to: number,
    jobId?: string
): Promise<number> {
    const data = await probeJson<FfprobePacketsResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time',
            '-read_intervals',
            `${Math.max(0, from - 1).toFixed(6)}%${(to + 1).toFixed(6)}`,
            input,
        ],
        { jobId }
    );
    return (data.packets ?? [])
        .map(packet => Number.parseFloat(packet.pts_time ?? ''))
        .filter(time => time >= from - 0.0005 && time < to - 0.0005).length;
}

// キーフレーム (表示の時刻 keyframe) の後ろにデコードされ、それより前に表示されるフレーム (open GOP の先行フレーム。
// 1 つ前の GOP のフレームを参照する) があるかを返す。パケットはファイル内でデコードの順に並ぶため、その順で次の
// キーフレームまでを調べる。キーフレームが見つからない場合も、そこから写し始められないため true を返す
export async function hasLeadingFrames(
    input: string,
    streamIndex: number,
    keyframe: number,
    jobId?: string
): Promise<boolean> {
    const data = await probeJson<FfprobePacketsResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time,flags',
            '-read_intervals',
            `${Math.max(0, keyframe - 1).toFixed(6)}%${(keyframe + 10).toFixed(6)}`,
            input,
        ],
        { jobId }
    );
    const packets = (data.packets ?? []).map(packet => ({
        pts: Number.parseFloat(packet.pts_time ?? ''),
        key: packet.flags?.includes('K') ?? false,
    }));
    const at = packets.findIndex(packet => packet.key && Math.abs(packet.pts - keyframe) <= 0.0005);
    if (at < 0) return true;
    for (let i = at + 1; i < packets.length && !packets[i].key; i++) {
        if (packets[i].pts < keyframe - 0.0005) return true;
    }
    return false;
}

type FfprobePacketDataResult = {
    packets?: Array<{ pts_time?: string; data?: string }>;
};

// ffprobe の -show_data の 16 進ダンプ (各行 "00000000: 0000 0001 6764 ...  ....gd") をバイト列に戻す
function dumpBytes(dump: string): number[] {
    const bytes: number[] = [];
    for (const line of dump.split('\n')) {
        const colon = line.indexOf(': ');
        if (colon < 0) continue;
        const hex = line
            .slice(colon + 2)
            .split('  ')[0]
            .replace(/ /g, '');
        for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    return bytes;
}

// H.264 のパケットに含まれる NAL ユニットの種類を返す。Annex B (開始コード区切り) と、mp4・mkv の長さ区切り (4 バイト)
// の両方を読む。区切りを読み切れない場合は空を返す
function h264NalTypes(bytes: number[]): number[] {
    const types: number[] = [];
    if (bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || (bytes[2] === 0 && bytes[3] === 1))) {
        for (let i = 0; i + 3 < bytes.length; i++) {
            if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) types.push(bytes[i + 3] & 0x1f);
        }
        return types;
    }
    let position = 0;
    while (position + 4 < bytes.length) {
        const length =
            ((bytes[position] << 24) |
                (bytes[position + 1] << 16) |
                (bytes[position + 2] << 8) |
                bytes[position + 3]) >>>
            0;
        types.push(bytes[position + 4] & 0x1f);
        position += 4 + length;
    }
    return position === bytes.length ? types : [];
}

// H.264 のキーフレーム (表示の時刻 keyframe) が IDR かを返す。IDR でない I フレーム (open GOP の区切りなど) は、後ろの
// フレームの参照の指示が前の GOP のフレームを含むことがあり、そこから写し始めるとつなぎ目で正しくデコードできない。
// 中身を読めない場合は、そこから写し始めないよう false を返す
export async function isH264Idr(
    input: string,
    streamIndex: number,
    keyframe: number,
    jobId?: string
): Promise<boolean> {
    const data = await probeJson<FfprobePacketDataResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time,data',
            '-show_data',
            '-read_intervals',
            `${keyframe.toFixed(6)}%+#1`,
            input,
        ],
        { jobId }
    );
    const packet = (data.packets ?? []).find(
        item => Math.abs(Number.parseFloat(item.pts_time ?? '') - keyframe) <= 0.0005
    );
    if (!packet?.data) return false;
    // 5 = IDR のスライス
    return h264NalTypes(dumpBytes(packet.data)).includes(5);
}

// キーフレーム (表示の時刻 keyframe) から写した映像を、別の映像の後ろにつないでも正しくデコードできるかを返す。
// - H.264 は IDR だけができる (isH264Idr)
// - 先行フレーム (open GOP) を持つものはできない (先行フレームは前の GOP を参照し、先行フレームだけを捨てても、後ろの
//   フレームが前の GOP のフレームを参照の一覧に持つ)
export async function decodableFrom(
    input: string,
    streamIndex: number,
    codec: string | undefined,
    keyframe: number,
    jobId?: string
): Promise<boolean> {
    if (codec === 'h264' && !(await isH264Idr(input, streamIndex, keyframe, jobId))) return false;
    return !(await hasLeadingFrames(input, streamIndex, keyframe, jobId));
}

// ストリームコピーの出力側の -ss に渡す位置。ffmpeg はストリームコピーの出力側の -ss をデコードの時刻で比べ、その位置以降の
// 最初のキーフレームから書き始める。キーフレームの表示の時刻を渡すと、B フレームがあるとデコードの時刻の方が前になるため
// そのキーフレームが落ちる。そこで 1 つ前のキーフレームの直後を渡す (1 つ前のキーフレームは落ち、間のフレームはキーフレームを
// 待つ間に捨てられ、目的のキーフレームから始まる)。1 つ前が無い場合は十分前の位置にする
export function copyStartSeek(keyframe: { time: number; previous: number | null }): number {
    return keyframe.previous !== null ? keyframe.previous + 0.001 : keyframe.time - 3600;
}

// 音声のストリームで、target の時刻を含むパケット (target 以前に始まる最後のパケット) の始まりの時刻を返す
// (音声をストリームコピーで target から取り出すとき、target の時刻の音を欠かさないため)。見つからなければ target
export async function findAudioPacketStart(
    input: string,
    streamIndex: number,
    target: number,
    jobId?: string
): Promise<number> {
    const data = await probeJson<FfprobePacketsResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time',
            '-read_intervals',
            `${Math.max(0, target - 5).toFixed(6)}%${(target + 1).toFixed(6)}`,
            input,
        ],
        { jobId }
    );
    let best: number | null = null;
    for (const packet of data.packets ?? []) {
        const t = Number.parseFloat(packet.pts_time ?? '');
        if (Number.isFinite(t) && t <= target + 0.0005 && (best === null || t > best)) best = t;
    }
    return best ?? target;
}

type FfprobeTimedPacketsResult = {
    packets?: Array<{ pts_time?: string; dts_time?: string; duration_time?: string }>;
};

type TimedPacket = { pts: number; dts: number; duration: number };

// 映像のパケットの表示の時刻・デコードの時刻・長さを、target の前後 10 秒の範囲で読む
async function readTimedPackets(
    input: string,
    streamIndex: number,
    target: number,
    jobId?: string
): Promise<TimedPacket[]> {
    const data = await probeJson<FfprobeTimedPacketsResult>(
        [
            '-select_streams',
            String(streamIndex),
            '-show_entries',
            'packet=pts_time,dts_time,duration_time',
            '-read_intervals',
            `${Math.max(0, target - 10).toFixed(6)}%${(target + 10).toFixed(6)}`,
            input,
        ],
        { jobId }
    );
    return (data.packets ?? [])
        .map(packet => ({
            pts: Number.parseFloat(packet.pts_time ?? ''),
            dts: Number.parseFloat(packet.dts_time ?? packet.pts_time ?? ''),
            duration: Number.parseFloat(packet.duration_time ?? '') || 0,
        }))
        .filter(packet => Number.isFinite(packet.pts) && Number.isFinite(packet.dts));
}

// 映像の終わり (最後のフレームの表示の終わり)
function videoEndOf(packets: TimedPacket[], fallback: number): number {
    return packets.length > 0 ? Math.max(...packets.map(packet => packet.pts + packet.duration)) : fallback;
}

// デコードの時刻 lastDecode のフレームまでを含め、次のフレームを含めないように切る位置 (-to に渡す)
function decodeCutAfter(packets: TimedPacket[], lastDecode: number, fallback: number): number {
    const later = packets.map(packet => packet.dts).filter(dts => dts > lastDecode + 0.0005);
    return later.length > 0 ? (lastDecode + Math.min(...later)) / 2 : fallback;
}

// ストリームコピーで target まで切るときの、映像の切り方を決める。
// ffmpeg はストリームコピーをデコードの順 (dts) で切るため、そのまま target で切ると、target より前に表示される B フレームが
// 落ちる一方で、後ろに表示される参照先のフレームだけが入り、終わりが飛び飛びになる。
// target より前に表示されるフレームと、その表示に要るフレーム (デコードの順でそれより前のもの) をすべて含め、
// 含めたフレームの表示が連続して終わる位置まで終わりを後ろへ広げる (広がらなくなるまで繰り返す)。
// 戻り値の decodeEnd はデコードの順で切る位置 (-to に渡す)、displayEnd は出力の映像が表示上終わる元の時刻
// (音声などはここまで取り出す)
export async function findCopyEnd(
    input: string,
    streamIndex: number,
    target: number,
    jobId?: string
): Promise<{ decodeEnd: number; displayEnd: number }> {
    const packets = await readTimedPackets(input, streamIndex, target, jobId);
    // 映像の終わりより後ろは無いため、そこまでにとどめる (チャプターの終わりが映像より後ろの場合)
    const videoEnd = videoEndOf(packets, target);
    if (target >= videoEnd - 0.0005) return { decodeEnd: target, displayEnd: Math.min(target, videoEnd) };
    let end = target;
    let lastDecode: number | null = null;
    for (let round = 0; round < 100; round++) {
        const shown = packets.filter(packet => packet.pts < end - 0.0005);
        if (shown.length === 0) break;
        lastDecode = Math.max(...shown.map(packet => packet.dts));
        const needed = packets.filter(packet => packet.dts <= (lastDecode as number) + 0.0005);
        const next = Math.max(end, ...needed.map(packet => packet.pts + packet.duration));
        if (next <= end + 0.0005) break;
        end = next;
    }
    if (lastDecode === null) return { decodeEnd: target, displayEnd: target };
    return { decodeEnd: decodeCutAfter(packets, lastDecode, end), displayEnd: end };
}

// チャプターの境界 time で、後ろの範囲に入る最初のフレームの表示の時刻を返す。境界をまたぐフレームは rule で決めた範囲に入れる
// (VideoCutBoundary)。境界がフレームの区切りにある場合はどれも同じになる (チャプターの時刻のミリ秒への丸めは FRAME_TOLERANCE
// で吸収する)。後ろにフレームが無ければ time
export async function boundaryFrame(
    input: string,
    streamIndex: number,
    time: number,
    rule: VideoCutBoundary,
    jobId?: string
): Promise<number> {
    if (time <= FRAME_TOLERANCE) return time;
    const frames = (await readTimedPackets(input, streamIndex, time, jobId)).sort((a, b) => a.pts - b.pts);
    for (let i = 0; i < frames.length; i++) {
        const begin = frames[i].pts;
        // 表示の終わり (次のフレームの始まり)
        const finish = i + 1 < frames.length ? frames[i + 1].pts : begin + frames[i].duration;
        const later =
            rule === 'earlier'
                ? begin >= time - FRAME_TOLERANCE
                : rule === 'later'
                  ? finish > time + FRAME_TOLERANCE
                  : (begin + finish) / 2 >= time;
        if (later) return begin;
    }
    return time;
}

// ストリームコピーで写すのをやめても表示が途切れない位置のうち、from より後ろ・target 以前で最も遅いものを返す (無ければ null)。
// 途切れないのは、そこより前に表示されるフレームが、デコードの順でそこ以降に表示されるフレームより前にそろう (それらを
// 参照しない) 位置。キーフレームである必要はなく、B フレームの並びの区切りごとにある。戻り値は findCopyEnd と同じ形
export async function findCopyEndBefore(
    input: string,
    streamIndex: number,
    from: number,
    target: number,
    jobId?: string
): Promise<{ decodeEnd: number; displayEnd: number } | null> {
    const packets = await readTimedPackets(input, streamIndex, target, jobId);
    const videoEnd = videoEndOf(packets, target);
    if (target >= videoEnd - 0.0005) return { decodeEnd: target, displayEnd: Math.min(target, videoEnd) };
    const candidates = [
        target,
        ...packets.map(packet => packet.pts).filter(pts => pts > from + 0.0005 && pts < target - 0.0005),
    ].sort((a, b) => b - a);
    for (const point of candidates) {
        const shown = packets.filter(packet => packet.pts < point - 0.0005);
        if (shown.length === 0) continue;
        const lastDecode = Math.max(...shown.map(packet => packet.dts));
        if (packets.every(packet => packet.dts > lastDecode + 0.0005 || packet.pts < point - 0.0005)) {
            return { decodeEnd: decodeCutAfter(packets, lastDecode, point), displayEnd: point };
        }
    }
    return null;
}
