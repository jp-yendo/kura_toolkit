import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { FRAME_TOLERANCE } from './keyframe';

// 場面の切り替わりの検出 (ffmpeg の select フィルタの scene スコア。前のフレームとの絵の違い、0-1)

// 場面の切り替わりとみなすスコアの下限と、周りのフレームのスコアに対して何倍以上あれば切り替わりとみなすか
// (動きの大きい場面では周りのフレームのスコアも高くなるため、周りより際立って高いものだけを切り替わりとする)
const SCENE_MIN_SCORE = 0.1;
const SCENE_MIN_RATIO = 2;
// 境界のフレームから前後何フレームまでで切り替わりを探すか
const SCENE_SEARCH_FRAMES = 2;
// 際立っているかを比べる周りのフレームの範囲 (境界のフレームから前後何フレームまでか)
const SCENE_CONTEXT_FRAMES = 4;

// 境界のフレーム (表示の時刻 frame) の前後 SCENE_SEARCH_FRAMES フレームのうち、場面がはっきり切り替わるフレーム
// (前のフレームから絵が大きく変わるもの) の表示の時刻を返す。見つからなければ null。frameDuration は 1 フレームの長さ (秒)
export async function sceneChangeNear(
    input: string,
    streamIndex: number,
    frame: number,
    frameDuration: number,
    jobId?: string
): Promise<number | null> {
    // 周りのフレームの範囲より 1 フレーム前から読む (読み始めのフレームは前のフレームが無く、スコアが無意味なため)
    const span = (SCENE_CONTEXT_FRAMES + 1) * frameDuration;
    const scores: Array<{ time: number; score: number }> = [];
    let pending: number | null = null;
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostats',
            '-loglevel',
            'info',
            '-copyts',
            '-ss',
            Math.max(0, frame - span - frameDuration).toFixed(6),
            '-to',
            (frame + span).toFixed(6),
            '-i',
            input,
            '-map',
            `0:${streamIndex}`,
            // すべてのフレームを通して scene スコアを付け、フレームごとに時刻とスコアをログへ出す
            '-vf',
            'select=gte(scene\\,0),metadata=print',
            '-f',
            'null',
            '-',
        ],
        {
            jobId,
            onStderrLine: line => {
                const time = /pts_time:([-0-9.]+)/.exec(line);
                if (time) pending = Number(time[1]);
                const score = /lavfi\.scene_score=([0-9.]+)/.exec(line);
                if (score && pending !== null) {
                    scores.push({ time: pending, score: Number(score[1]) });
                    pending = null;
                }
            },
        }
    );
    const within = (frames: number) => (item: { time: number }) =>
        Math.abs(item.time - frame) <= frames * frameDuration + FRAME_TOLERANCE;
    const candidates = scores.filter(within(SCENE_SEARCH_FRAMES));
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score < SCENE_MIN_SCORE) return null;
    const others = scores.filter(within(SCENE_CONTEXT_FRAMES)).filter(item => item !== best);
    if (others.some(item => item.score * SCENE_MIN_RATIO > best.score)) return null;
    return best.time;
}
