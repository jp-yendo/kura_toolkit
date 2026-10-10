import type { SvgModel } from '../vector-trace';
import { formatPathData, parsePathData, type Point, type Segment, type Subpath } from './path-shape';

// 補正の調整「点の削減」

// 間引くときの許容の距離 (パスの座標の単位。処理の大きさの画素)
const TOLERANCE = 0.3;
// 曲がる角度がこれ以上の点を角として残す (度)
const CORNER_DEGREES = 50;
// 曲線を折れ線にするときの、1 つの曲線あたりの分割の数
const CURVE_SAMPLES = 8;

// 輪郭を折れ線にする (始点を含み、曲線は CURVE_SAMPLES に分ける)
function outline(subpath: Subpath): Point[] {
    const points: Point[] = [subpath.start];
    let previous = subpath.start;
    for (const segment of subpath.segments) {
        if (segment.kind === 'C') {
            for (let k = 1; k <= CURVE_SAMPLES; k++) {
                const t = k / CURVE_SAMPLES;
                const u = 1 - t;
                const a = u * u * u;
                const b = 3 * u * u * t;
                const c = 3 * u * t * t;
                const d = t * t * t;
                points.push({
                    x: a * previous.x + b * segment.c1.x + c * segment.c2.x + d * segment.to.x,
                    y: a * previous.y + b * segment.c1.y + c * segment.c2.y + d * segment.to.y,
                });
            }
        } else {
            points.push(segment.to);
        }
        previous = segment.to;
    }
    return points;
}

// Douglas-Peucker 法で折れ線の点を間引く (両端は残す)
function douglasPeucker(points: Point[], tolerance: number): Point[] {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop()!;
        const a = points[first];
        const b = points[last];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        let maxDistance = -1;
        let index = -1;
        for (let i = first + 1; i < last; i++) {
            const p = points[i];
            // 両端が同じ点のときは、その点からの距離
            const distance =
                length > 0
                    ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length
                    : Math.hypot(p.x - a.x, p.y - a.y);
            if (distance > maxDistance) {
                maxDistance = distance;
                index = i;
            }
        }
        if (maxDistance > tolerance) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

// 輪郭の点を間引き、角を保って曲線を当てはめ直す。間引いても点が減らない輪郭は元のまま返す。
// 閉じた輪郭を始点と、始点から最も遠い点で 2 つに分けて間引く (始点と終点が同じ折れ線は Douglas-Peucker 法で扱えないため)。
// 曲がる角度が CORNER_DEGREES 以上の点を角とし、角でない点では前後の点を結ぶ向きに滑らかに通る 3 次ベジェ曲線
// (Catmull-Rom 曲線と同じ接線) にする。両端が角の区間は直線にする
function simplifySubpath(subpath: Subpath): Subpath {
    const polyline = outline(subpath);
    const first = polyline[0];
    const last = polyline[polyline.length - 1];
    if (polyline.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) polyline.pop();
    if (polyline.length < 4) return subpath;
    let far = 1;
    let farDistance = -1;
    for (let k = 1; k < polyline.length; k++) {
        const distance = Math.hypot(polyline[k].x - first.x, polyline[k].y - first.y);
        if (distance > farDistance) {
            far = k;
            farDistance = distance;
        }
    }
    const points = [
        ...douglasPeucker(polyline.slice(0, far + 1), TOLERANCE).slice(0, -1),
        ...douglasPeucker([...polyline.slice(far), first], TOLERANCE).slice(0, -1),
    ];
    const n = points.length;
    if (n < 3 || n >= subpath.segments.length) return subpath;
    const cornerCos = Math.cos((CORNER_DEGREES * Math.PI) / 180);
    const corner = points.map((p, i) => {
        const a = points[(i - 1 + n) % n];
        const b = points[(i + 1) % n];
        const v1x = p.x - a.x;
        const v1y = p.y - a.y;
        const v2x = b.x - p.x;
        const v2y = b.y - p.y;
        const norm = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
        // 曲がる角度が CORNER_DEGREES 以上 (向きの変化の cos がその cos 以下)
        return norm === 0 || (v1x * v2x + v1y * v2y) / norm <= cornerCos;
    });
    const tangent = (i: number): Point => {
        if (corner[i]) return { x: 0, y: 0 };
        const next = points[(i + 1) % n];
        const previous = points[(i - 1 + n) % n];
        return { x: (next.x - previous.x) / 6, y: (next.y - previous.y) / 6 };
    };
    const segments: Segment[] = points.map((p0, i) => {
        const p1 = points[(i + 1) % n];
        if (corner[i] && corner[(i + 1) % n]) return { kind: 'L', to: p1 };
        const t0 = tangent(i);
        const t1 = tangent((i + 1) % n);
        return {
            kind: 'C',
            c1: { x: p0.x + t0.x, y: p0.y + t0.y },
            c2: { x: p1.x - t1.x, y: p1.y - t1.y },
            to: p1,
        };
    });
    return { start: points[0], segments };
}

// 各形の輪郭の点を間引き (許容 0.3px)、角 (50 度以上) を保って曲線を当てはめ直す (座標は小数点以下 precision 桁)。
// 点の並びの向きは変えない (塗りの向きと穴が変わらない)。形を読めないパスは元のまま。変わる形が無いときは null
export function simplifyPaths(model: SvgModel, precision: number): SvgModel | null {
    let changed = false;
    const paths = model.paths.map(path => {
        const subpaths = parsePathData(path.d);
        if (!subpaths) return path;
        const simplified = subpaths.map(simplifySubpath);
        if (simplified.every((subpath, i) => subpath === subpaths[i])) return path;
        changed = true;
        return { ...path, d: formatPathData(simplified, precision) };
    });
    return changed ? { ...model, paths } : null;
}
