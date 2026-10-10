import type { Config } from '@neplex/vectorizer';
import { thresholdGray } from './image-io';
import type { SvgModel, SvgPath } from './svg-model';
import { traceBinaryWithRetry } from './trace';
import { throwIfCancelled, type GrayImage } from './types';

// しきい値ごとの白黒の変換を重ねるグレースケールの変換 (Inkscape (potrace) の「複数のスキャン: グレー」や
// Adobe の画像トレースの「グレースケール」と同じ考え方)。
// 一番明るい段階の灰色を下地にし、しきい値の明るい順に「しきい値より暗い画素」を白黒モードで変換して、
// その段階の灰色で塗って重ねる。透過した画素には形を作らない (変換ライブラリの白黒モードはアルファを無視するため、
// 白黒画像では透過した画素を白 (形を作らない側) にし、下地は不透明な画素の印を変換した形にする)

// 試す段階の数
export const GRAY_LEVEL_COUNTS = [8, 16, 32] as const;

// 1 次元 k-means の反復の回数
const KMEANS_ITERATIONS = 30;

// 段階の境目 (しきい値): 不透明な画素の明るさのヒストグラムの 1 次元 k-means で最大 count 個の明るさに分け、
// 隣り合う明るさの中間をしきい値にする。画素の割り当てられない明るさは除く (同じ白黒画像を何度も作らないため。
// 明るさの種類が少ない画像では、しきい値は count - 1 個より少なくなり、1 種類だけなら無い)。明るさの小さい順で、同じ値は 1 つにまとめる
export function levelThresholds(gray: GrayImage, opaque: Uint8Array, count: number): number[] {
    const hist = new Float64Array(256);
    for (let p = 0; p < gray.data.length; p++) if (opaque[p]) hist[gray.data[p]]++;
    let centers = Array.from({ length: count }, (_, k) => ((k + 0.5) * 256) / count);
    let assigned = new Float64Array(count);
    for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration++) {
        const sum = new Float64Array(count);
        const n = new Float64Array(count);
        for (let v = 0; v < 256; v++) {
            if (!hist[v]) continue;
            let best = 0;
            for (let k = 1; k < count; k++) if (Math.abs(v - centers[k]) < Math.abs(v - centers[best])) best = k;
            sum[best] += v * hist[v];
            n[best] += hist[v];
        }
        const next = centers.map((c, k) => ({ center: n[k] ? sum[k] / n[k] : c, n: n[k] }));
        next.sort((a, b) => a.center - b.center);
        centers = next.map(item => item.center);
        assigned = Float64Array.from(next, item => item.n);
    }
    const used = centers.filter((_, k) => assigned[k] > 0);
    const thresholds = used.slice(0, -1).map((c, k) => Math.round((c + used[k + 1]) / 2));
    return [...new Set(thresholds)].sort((a, b) => a - b);
}

// 各段階の灰色: その段階に入る不透明な画素の明るさの平均 (画素の無い段階は境目の中間)。
// 段階 k は [bounds[k], bounds[k + 1]) (bounds = [0, ...thresholds, 256])
function levelTones(gray: GrayImage, opaque: Uint8Array, thresholds: number[]): number[] {
    const bounds = [0, ...thresholds, 256];
    const sum = new Float64Array(bounds.length - 1);
    const n = new Float64Array(bounds.length - 1);
    for (let p = 0; p < gray.data.length; p++) {
        if (!opaque[p]) continue;
        const v = gray.data[p];
        let k = 0;
        while (v >= bounds[k + 1]) k++;
        sum[k] += v;
        n[k]++;
    }
    return Array.from(sum, (s, k) => Math.round(n[k] ? s / n[k] : (bounds[k] + bounds[k + 1]) / 2));
}

function grayHex(v: number): string {
    return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
}

export type GrayScanResult = {
    model: SvgModel;
    // 変換を試みた白黒画像の数と、変換できた数
    attempted: number;
    traced: number;
};

// 変換する白黒画像の数 (下地と、しきい値の数)
export function grayScanSteps(thresholds: number[]): number {
    return thresholds.length + 1;
}

// 明るさ gray を thresholds で段階に分けて変換し、重ねた SVG のモデルを返す。
// opaque は不透明な画素の印。白黒の変換が失敗した段階は飛ばす。onStep は白黒画像を 1 つ処理するたびに呼ぶ
export async function scanGray(
    gray: GrayImage,
    opaque: Uint8Array,
    thresholds: number[],
    config: Config,
    signal: AbortSignal,
    onStep: () => void
): Promise<GrayScanResult> {
    const { width: w, height: h } = gray;
    const pixels = w * h;
    const tones = levelTones(gray, opaque, thresholds);
    const paths: SvgPath[] = [];
    let attempted = 0;
    let traced = 0;
    let opaqueCount = 0;
    for (let p = 0; p < pixels; p++) opaqueCount += opaque[p];

    // 下地: 一番明るい段階の灰色。すべて不透明なら全面の矩形、そうでなければ不透明な画素の印を変換した形
    const baseFill = grayHex(tones[tones.length - 1]);
    if (opaqueCount === pixels) {
        paths.push({ d: `M0 0L${w} 0L${w} ${h}L0 ${h}Z`, fill: baseFill, transform: null });
    } else if (opaqueCount > 0) {
        const base = new Uint8Array(pixels);
        for (let p = 0; p < pixels; p++) base[p] = opaque[p] ? 0 : 255;
        attempted++;
        const shapes = await traceBinaryWithRetry({ width: w, height: h, data: base }, config, signal);
        if (shapes) {
            traced++;
            for (const shape of shapes) paths.push({ ...shape, fill: baseFill });
        }
    }
    onStep();

    // 明るいしきい値から順に、しきい値より暗い (透過していない) 画素を変換して重ねる
    for (let k = thresholds.length - 1; k >= 0; k--) {
        throwIfCancelled(signal);
        const bw = await thresholdGray(gray, thresholds[k]);
        let dark = 0;
        for (let p = 0; p < pixels; p++) {
            if (!opaque[p]) bw.data[p] = 255;
            else if (bw.data[p] === 0) dark++;
        }
        if (dark > 0) {
            attempted++;
            const shapes = await traceBinaryWithRetry(bw, config, signal);
            if (shapes) {
                traced++;
                const fill = grayHex(tones[k]);
                for (const shape of shapes) paths.push({ ...shape, fill });
            }
        }
        onStep();
    }
    return { model: { width: w, height: h, paths }, attempted, traced };
}
