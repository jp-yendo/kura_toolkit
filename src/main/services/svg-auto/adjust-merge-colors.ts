import { idMap, toLab, type SvgModel, type SvgPath } from '../vector-trace';
import {
    boundsOverlap,
    formatPathData,
    parsePathData,
    parseTranslate,
    shapeBounds,
    unionBounds,
    type Bounds,
    type Point,
    type Subpath,
} from './path-shape';

// 補正の調整「近い色の統合」

// 塗りの色差 (Lab の ΔE76) がこれ未満なら同じ色にそろえる
const MERGE_DELTA_E = 2;

// どの形とも重なるとみなす範囲 (形を読めないパス。動かさず、ほかの形がその上下を越えて動かないようにする)
const EVERYWHERE: Bounds = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

type Shape = {
    subpaths: Subpath[];
    offset: Point;
    bounds: Bounds;
};

function parseHexColor(fill: string): [number, number, number] | null {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill.trim());
    if (!match) return null;
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

// 塗りの色をそろえる: 見えている面積の大きい形から順に、それまでに出た色 (代表の色) との色差が MERGE_DELTA_E 未満なら
// その代表の色にし、そうでなければ新しい代表の色にする。#RRGGBB でない塗りは変えない
function unifyFills(model: SvgModel, width: number, height: number): string[] {
    const ids = idMap(model, width, height);
    const area = new Float64Array(model.paths.length);
    for (let p = 0; p < ids.length; p++) if (ids[p] >= 0) area[ids[p]]++;
    const order = model.paths.map((_, i) => i).sort((a, b) => area[b] - area[a] || a - b);
    const representatives: { lab: [number, number, number]; fill: string }[] = [];
    const fills = model.paths.map(path => path.fill);
    for (const i of order) {
        const rgb = parseHexColor(model.paths[i].fill);
        if (!rgb) continue;
        const lab = toLab(rgb[0], rgb[1], rgb[2]);
        const hit = representatives.find(
            other => Math.hypot(other.lab[0] - lab[0], other.lab[1] - lab[1], other.lab[2] - lab[2]) < MERGE_DELTA_E
        );
        if (hit) {
            fills[i] = hit.fill;
        } else {
            const fill = model.paths[i].fill.toUpperCase();
            representatives.push({ lab, fill });
            fills[i] = fill;
        }
    }
    return fills;
}

function readShape(path: SvgPath): Shape | null {
    const subpaths = parsePathData(path.d);
    const offset = parseTranslate(path.transform);
    if (!subpaths || !offset) return null;
    const bounds = shapeBounds(subpaths, offset);
    return bounds ? { subpaths, offset, bounds } : null;
}

// 色差 (Lab) が 2 未満の塗りを 1 色にそろえ、重なり順を変えずに済む同じ色の形を 1 つのパスにまとめる。
// 形 i を同じ色の上の形 j にまとめるのは、i と j の範囲が重ならず、間にある形のどれとも i の範囲が重ならないときだけ
// (i を j の位置まで上げても、間の形との重なり順が変わらず、i と j の塗りの部分が重ならないため、1 つのパスにしても
// 見え方が変わらない)。塗りの色は width x height に描いた ID 画像の面積の順に決める。座標を書き直すときは小数点以下
// precision 桁。変わるものが無いときは null
export function mergeNearColors(model: SvgModel, width: number, height: number, precision: number): SvgModel | null {
    const fills = unifyFills(model, width, height);
    const paths = model.paths.map((path, i) => ({ ...path, fill: fills[i] }));
    const shapes = paths.map(readShape);
    const bounds = shapes.map(shape => shape?.bounds ?? EVERYWHERE);
    const removed = new Uint8Array(paths.length);
    let merged = 0;
    for (let i = 0; i < paths.length; i++) {
        const source = shapes[i];
        if (!source) continue;
        for (let j = i + 1; j < paths.length; j++) {
            if (removed[j]) continue;
            // 範囲が重なる形があれば、それより上へは動かせない (同じ色でも、重なる形どうしは 1 つにできない)
            if (boundsOverlap(bounds[i], bounds[j])) break;
            if (paths[j].fill.toUpperCase() !== paths[i].fill.toUpperCase()) continue;
            const target = shapes[j];
            if (!target) break;
            const sameFrame = (paths[i].transform ?? '') === (paths[j].transform ?? '');
            // 平行移動が違うときは、i の座標を j の座標系に書き直す
            const sourceData = sameFrame
                ? paths[i].d
                : formatPathData(source.subpaths, precision, {
                      x: source.offset.x - target.offset.x,
                      y: source.offset.y - target.offset.y,
                  });
            paths[j] = { ...paths[j], d: `${sourceData} ${paths[j].d}` };
            const shifted = source.subpaths.map(subpath => shiftSubpath(subpath, source.offset, target.offset));
            shapes[j] = { ...target, subpaths: [...shifted, ...target.subpaths] };
            bounds[j] = unionBounds(bounds[i], bounds[j]);
            removed[i] = 1;
            merged++;
            break;
        }
    }
    const recolored = paths.some((path, i) => path.fill.toUpperCase() !== model.paths[i].fill.toUpperCase());
    if (!merged && !recolored) return null;
    return { ...model, paths: paths.filter((_, i) => !removed[i]) };
}

// 輪郭を from の座標系から to の座標系へ移す
function shiftSubpath(subpath: Subpath, from: Point, to: Point): Subpath {
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    if (dx === 0 && dy === 0) return subpath;
    const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
    return {
        start: move(subpath.start),
        segments: subpath.segments.map(segment =>
            segment.kind === 'C'
                ? { kind: 'C', c1: move(segment.c1), c2: move(segment.c2), to: move(segment.to) }
                : { kind: 'L', to: move(segment.to) }
        ),
    };
}
