import type { Config } from '@neplex/vectorizer';
import { labInto } from './lab';
import { idMap } from './rasterize';
import type { SvgModel, SvgPath } from './svg-model';
import { traceBinary } from './trace';
import type { RgbaImage } from './types';

// 色味が 2 つにはっきり分かれる形を分け直す (グレースケールで変換した形は明るさだけで分かれているため、
// 明るさが近く色味の違う部分が 1 つの形にまとまることがある)

// 調べる形の最小の画素数
const MIN_SHAPE_PIXELS = 64;
// 色味 (Lab の a, b) の散らばりがこれを超える形を調べる
const MIN_SPREAD = 6;
// 2-means の 2 つの中心の差がこれを超えるときだけ分ける
const MIN_GAP = 12;
// 少ない側が形のこの割合以上で、かつこの画素数以上のときだけ分ける
const MIN_MINOR_RATIO = 0.1;
const MIN_MINOR_PIXELS = 32;
// 2-means の反復の回数
const TWO_MEANS_ITERATIONS = 8;

export type MinorityMask = {
    // 少ない側の画素の印 (1: 分け直す画素)
    mask: Uint8Array;
    // 少ない側の画素が属する元の形の番号 (それ以外は -1)
    parent: Int32Array;
    // 分けた形の数
    split: number;
};

// 色味が 2 つに分かれる形の、少ない側の画素の印を作る (image の大きさ。image は不透明な元画像)。
// opaque は不透明な画素の印 (透過した画素は印に含めない)
export function minorityMask(model: SvgModel, image: RgbaImage, opaque: Uint8Array): MinorityMask {
    const { width: w, height: h, data } = image;
    const pixels = w * h;
    const ids = idMap(model, w, h);
    const a = new Float32Array(pixels);
    const b = new Float32Array(pixels);
    const lab = new Float64Array(3);
    for (let p = 0; p < pixels; p++) {
        labInto(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], lab, 0);
        a[p] = lab[1];
        b[p] = lab[2];
    }
    // 形ごとに画素を並べる (形の番号ごとの数え上げ)
    const shapeCount = model.paths.length;
    const start = new Int32Array(shapeCount + 1);
    for (let p = 0; p < pixels; p++) if (ids[p] >= 0) start[ids[p] + 1]++;
    for (let id = 0; id < shapeCount; id++) start[id + 1] += start[id];
    const order = new Int32Array(start[shapeCount]);
    const fill = start.slice(0, shapeCount);
    for (let p = 0; p < pixels; p++) if (ids[p] >= 0) order[fill[ids[p]]++] = p;

    const mask = new Uint8Array(pixels);
    const parent = new Int32Array(pixels).fill(-1);
    let split = 0;
    for (let id = 0; id < shapeCount; id++) {
        const px = order.subarray(start[id], start[id + 1]);
        const size = px.length;
        if (size < MIN_SHAPE_PIXELS) continue;
        let ma = 0;
        let mb = 0;
        for (const p of px) {
            ma += a[p];
            mb += b[p];
        }
        ma /= size;
        mb /= size;
        let variance = 0;
        for (const p of px) variance += (a[p] - ma) ** 2 + (b[p] - mb) ** 2;
        if (Math.sqrt(variance / size) <= MIN_SPREAD) continue;
        // 2-means (初期値: 平均から最も遠い色と、それから最も遠い色)
        let c1 = px[0];
        for (const p of px) {
            if ((a[p] - ma) ** 2 + (b[p] - mb) ** 2 > (a[c1] - ma) ** 2 + (b[c1] - mb) ** 2) c1 = p;
        }
        let c2 = px[0];
        for (const p of px) {
            if ((a[p] - a[c1]) ** 2 + (b[p] - b[c1]) ** 2 > (a[c2] - a[c1]) ** 2 + (b[c2] - b[c1]) ** 2) c2 = p;
        }
        let k1a = a[c1];
        let k1b = b[c1];
        let k2a = a[c2];
        let k2b = b[c2];
        const label = new Uint8Array(size);
        for (let iteration = 0; iteration < TWO_MEANS_ITERATIONS; iteration++) {
            let s0a = 0;
            let s0b = 0;
            let n0 = 0;
            let s1a = 0;
            let s1b = 0;
            let n1 = 0;
            for (let i = 0; i < size; i++) {
                const p = px[i];
                const d1 = (a[p] - k1a) ** 2 + (b[p] - k1b) ** 2;
                const d2 = (a[p] - k2a) ** 2 + (b[p] - k2b) ** 2;
                if (d2 < d1) {
                    label[i] = 1;
                    s1a += a[p];
                    s1b += b[p];
                    n1++;
                } else {
                    label[i] = 0;
                    s0a += a[p];
                    s0b += b[p];
                    n0++;
                }
            }
            if (n0) {
                k1a = s0a / n0;
                k1b = s0b / n0;
            }
            if (n1) {
                k2a = s1a / n1;
                k2b = s1b / n1;
            }
        }
        let n1 = 0;
        for (let i = 0; i < size; i++) n1 += label[i];
        const minor = n1 <= size - n1 ? 1 : 0;
        const minorCount = minor ? n1 : size - n1;
        const gap = Math.hypot(k1a - k2a, k1b - k2b);
        if (gap <= MIN_GAP || minorCount < Math.max(MIN_MINOR_PIXELS, size * MIN_MINOR_RATIO)) continue;
        for (let i = 0; i < size; i++) {
            const p = px[i];
            if (label[i] === minor && opaque[p]) {
                mask[p] = 1;
                parent[p] = id;
            }
        }
        split++;
    }
    return { mask, parent, split };
}

// 分け直した形 (extra) を、それぞれが最も多く重なる元の形のすぐ上に入れる (一番上に重ねると、暗い段階の形
// (線や影) を隠すため)。どの元の形とも重ならない形は入れない。新しいモデルを返す
export function insertAbove(base: SvgModel, extra: SvgPath[], parent: Int32Array): SvgModel {
    if (!extra.length) return base;
    const ids = idMap({ ...base, paths: extra }, base.width, base.height);
    const votes = extra.map(() => new Map<number, number>());
    for (let p = 0; p < ids.length; p++) {
        if (ids[p] >= 0 && parent[p] >= 0) votes[ids[p]].set(parent[p], (votes[ids[p]].get(parent[p]) ?? 0) + 1);
    }
    const after = new Map<number, SvgPath[]>();
    extra.forEach((shape, i) => {
        let best = -1;
        let bestVotes = 0;
        for (const [id, count] of votes[i]) {
            if (count > bestVotes) {
                best = id;
                bestVotes = count;
            }
        }
        if (best < 0) return;
        const list = after.get(best);
        if (list) list.push(shape);
        else after.set(best, [shape]);
    });
    const paths: SvgPath[] = [];
    base.paths.forEach((path, i) => paths.push(path, ...(after.get(i) ?? [])));
    return { ...base, paths };
}

// 色味が 2 つに分かれる形の少ない側をまとめて白黒モードで 1 回だけ変換し、元の形のすぐ上に入れたモデルを返す。
// image は不透明な元画像で、大きさは model と同じ。分ける形が無い・形ができないときは null
export async function splitMixedShapes(
    model: SvgModel,
    image: RgbaImage,
    opaque: Uint8Array,
    config: Config,
    signal: AbortSignal
): Promise<SvgModel | null> {
    const { mask, parent, split } = minorityMask(model, image, opaque);
    if (!split) return null;
    const binary = new Uint8Array(mask.length);
    for (let p = 0; p < mask.length; p++) binary[p] = mask[p] ? 0 : 255;
    const extra = await traceBinary({ width: image.width, height: image.height, data: binary }, config, signal);
    if (!extra.length) return null;
    return insertAbove(model, extra, parent);
}
