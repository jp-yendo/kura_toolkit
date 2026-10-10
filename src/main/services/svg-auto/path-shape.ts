// 変換ライブラリが出力するパスの形の読み取りと書き出し。
// d は絶対座標の M・L・C・Z だけ、transform は translate だけを扱う (変換ライブラリの出力の形)。
// それ以外の形のパスは読めないものとして null を返し、調整の対象から外す

export type Point = { x: number; y: number };

export type Segment = { kind: 'L'; to: Point } | { kind: 'C'; c1: Point; c2: Point; to: Point };

// 1 つの閉じた輪郭 (書き出すときは必ず Z で閉じる。塗りでは閉じていない輪郭も閉じて扱われるため、見え方は変わらない)
export type Subpath = { start: Point; segments: Segment[] };

// 形の範囲 (制御点を含む。曲線は制御点の凸包の中にあるため、形はこの中に収まる)
export type Bounds = { x0: number; y0: number; x1: number; y1: number };

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

// d を輪郭の並びにする。M・L・C・Z (絶対座標) 以外を含むときと、形の崩れた d は null
export function parsePathData(d: string): Subpath[] | null {
    const subpaths: Subpath[] = [];
    let current: Subpath | null = null;
    let command = '';
    let index = 0;

    const skipSeparators = () => {
        while (index < d.length && /[\s,]/.test(d[index])) index++;
    };
    const readNumber = (): number | null => {
        skipSeparators();
        NUMBER.lastIndex = index;
        const match = NUMBER.exec(d);
        if (!match) return null;
        index = NUMBER.lastIndex;
        const value = Number(match[0]);
        return Number.isFinite(value) ? value : null;
    };
    const readPoint = (): Point | null => {
        const x = readNumber();
        if (x === null) return null;
        const y = readNumber();
        return y === null ? null : { x, y };
    };

    for (;;) {
        skipSeparators();
        if (index >= d.length) break;
        const char = d[index];
        if (/[A-Za-z]/.test(char)) {
            if (!'MLCZ'.includes(char)) return null;
            index++;
            if (char === 'Z') {
                if (!current) return null;
                current = null;
                command = '';
            } else {
                command = char;
            }
            continue;
        }
        // 同じコマンドの続きの値 (M の後の値の組は L とみなす)
        if (command === 'M') {
            const start = readPoint();
            if (!start) return null;
            current = { start, segments: [] };
            subpaths.push(current);
            command = 'L';
        } else if (command === 'L' && current) {
            const to = readPoint();
            if (!to) return null;
            current.segments.push({ kind: 'L', to });
        } else if (command === 'C' && current) {
            const c1 = readPoint();
            const c2 = c1 && readPoint();
            const to = c2 && readPoint();
            if (!c1 || !c2 || !to) return null;
            current.segments.push({ kind: 'C', c1, c2, to });
        } else {
            return null;
        }
    }
    return subpaths;
}

// transform 属性の平行移動 (属性が無いときは 0, 0)。translate 以外のときは null
export function parseTranslate(transform: string | null): Point | null {
    if (!transform) return { x: 0, y: 0 };
    const match = /^\s*translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)\s*$/.exec(transform);
    if (!match) return null;
    const x = Number(match[1]);
    const y = match[2] === undefined ? 0 : Number(match[2]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// 数値を小数点以下 precision 桁までの文字にする (末尾の 0 と、-0 の符号は付けない)
function formatNumber(value: number, precision: number): string {
    const text = value.toFixed(precision);
    const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
    return trimmed === '-0' ? '0' : trimmed;
}

// 輪郭の並びを d にする (座標は小数点以下 precision 桁。offset だけずらして書く)
export function formatPathData(subpaths: Subpath[], precision: number, offset: Point = { x: 0, y: 0 }): string {
    const point = (p: Point) => `${formatNumber(p.x + offset.x, precision)} ${formatNumber(p.y + offset.y, precision)}`;
    return subpaths
        .map(subpath => {
            const segments = subpath.segments
                .map(segment =>
                    segment.kind === 'C'
                        ? `C${point(segment.c1)} ${point(segment.c2)} ${point(segment.to)}`
                        : `L${point(segment.to)}`
                )
                .join('');
            return `M${point(subpath.start)}${segments}Z`;
        })
        .join('');
}

// 輪郭の並びの範囲 (offset だけずらした位置。輪郭が無いときは null)
export function shapeBounds(subpaths: Subpath[], offset: Point): Bounds | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (p: Point) => {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
    };
    for (const subpath of subpaths) {
        add(subpath.start);
        for (const segment of subpath.segments) {
            if (segment.kind === 'C') {
                add(segment.c1);
                add(segment.c2);
            }
            add(segment.to);
        }
    }
    if (x0 > x1) return null;
    return { x0: x0 + offset.x, y0: y0 + offset.y, x1: x1 + offset.x, y1: y1 + offset.y };
}

// 2 つの範囲が重なるか (辺が接するだけのときは重ならない)
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
