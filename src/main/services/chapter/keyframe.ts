import { probeJson } from '../ffmpeg/ffprobe';

// キーフレーム探索 (元: cut-chapter.py の find_keyframe_before)

type FfprobePacketsResult = {
    packets?: Array<{ pts_time?: string; flags?: string }>;
};

// target 以前で最も近い映像キーフレームの時刻を返す。
// GOP 長は不明のため、見つかるまで探索窓を広げながら遡る。
export async function findKeyframeBefore(
    input: string,
    streamIndex: number,
    target: number,
    jobId?: string
): Promise<number> {
    let window = 30.0;
    for (;;) {
        const begin = Math.max(0, target - window);
        const data = await probeJson<FfprobePacketsResult>(
            [
                '-select_streams',
                String(streamIndex),
                '-show_entries',
                'packet=pts_time,flags',
                '-read_intervals',
                `${begin.toFixed(6)}%${(target + 1.0).toFixed(6)}`,
                input,
            ],
            { jobId }
        );
        let best: number | null = null;
        for (const packet of data.packets ?? []) {
            if (!packet.flags?.includes('K')) continue;
            if (packet.pts_time === undefined) continue;
            const t = Number.parseFloat(packet.pts_time);
            if (!Number.isFinite(t)) continue;
            // ごく近い後方のキーフレームは丸め誤差とみなして許容する
            if (t <= target + 0.001 && (best === null || t > best)) {
                best = t;
            }
        }
        if (best !== null) return best;
        if (begin <= 0) return 0;
        window *= 4;
    }
}
