import { labInto } from './lab';
import { OPAQUE_ALPHA, type RgbaImage } from './types';

// 背景と小さな点の除去、不透明な画素の印

// 縁のうち透過した画素がこの割合を超える画像は、背景がすでに抜けているとみなして何もしない
const TRANSPARENT_BORDER_RATIO = 0.9;

// 不透明な画素 (アルファ OPAQUE_ALPHA 以上) の印 (1: 不透明、0: 透過)
export function opaqueMask(image: RgbaImage): Uint8Array {
    const pixels = image.width * image.height;
    const mask = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p++) mask[p] = image.data[p * 4 + 3] >= OPAQUE_ALPHA ? 1 : 0;
    return mask;
}

// アルファを 0 か 255 にそろえる (OPAQUE_ALPHA 以上は不透明、未満は透過にして色を白にする)。新しい画像を返す
export function binarizeAlpha(image: RgbaImage): RgbaImage {
    const out = Buffer.from(image.data);
    for (let i = 0; i < out.length; i += 4) {
        if (out[i + 3] >= OPAQUE_ALPHA) {
            out[i + 3] = 255;
        } else {
            out[i] = 255;
            out[i + 1] = 255;
            out[i + 2] = 255;
            out[i + 3] = 0;
        }
    }
    return { width: image.width, height: image.height, data: out };
}

// 縁の画素の番号 (上下の行と左右の列。角は重ねて数える)
function borderPixels(width: number, height: number): number[] {
    const border: number[] = [];
    for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1);
    return border;
}

// 縁からつながる、縁の色 (不透明な縁の画素のチャンネルごとの中央値) との色差 (Lab) が tolerance 未満の領域を透明にする
// (tolerance 0 は縁の色と一致する画素だけ)。透過した画素は背景としてたどる。縁の 9 割を超える画素がすでに透過した画像は
// そのまま返す。新しい画像を返す
export function removeBackground(image: RgbaImage, tolerance: number): RgbaImage {
    const { width: w, height: h, data } = image;
    const out = Buffer.from(data);
    const border = borderPixels(w, h);
    const opaqueBorder = border.filter(p => data[p * 4 + 3] >= OPAQUE_ALPHA);
    if ((border.length - opaqueBorder.length) / border.length > TRANSPARENT_BORDER_RATIO)
        return { width: w, height: h, data: out };
    const median = [0, 1, 2].map(
        c => opaqueBorder.map(p => data[p * 4 + c]).sort((a, b) => a - b)[opaqueBorder.length >> 1]
    );
    const base = new Float64Array(3);
    labInto(median[0], median[1], median[2], base, 0);
    const lab = new Float64Array(3);
    const near = (p: number): boolean => {
        if (data[p * 4 + 3] < OPAQUE_ALPHA) return true;
        labInto(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], lab, 0);
        const distance = Math.hypot(lab[0] - base[0], lab[1] - base[1], lab[2] - base[2]);
        return tolerance > 0 ? distance < tolerance : distance === 0;
    };
    // 4 方向にたどる。どの画素も積むのは 1 回だけなので、画素の数の大きさで足りる
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    const visit = (q: number) => {
        if (!seen[q] && near(q)) {
            seen[q] = 1;
            stack[top++] = q;
        }
    };
    for (const p of border) visit(p);
    while (top > 0) {
        const p = stack[--top];
        out[p * 4 + 3] = 0;
        const x = p % w;
        const y = (p - x) / w;
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (y > 0) visit(p - w);
        if (y < h - 1) visit(p + w);
    }
    return { width: w, height: h, data: out };
}

// 不透明な画素の 8 方向のつながりのうち、面積 (画素数) が minArea 未満のものを透明にする。新しい画像を返す
export function removeSpecks(image: RgbaImage, minArea: number): RgbaImage {
    const { width: w, height: h, data } = image;
    const out = Buffer.from(data);
    if (minArea <= 0) return { width: w, height: h, data: out };
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const component = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
        if (seen[s] || data[s * 4 + 3] < OPAQUE_ALPHA) continue;
        seen[s] = 1;
        let top = 0;
        let size = 0;
        stack[top++] = s;
        while (top > 0) {
            const p = stack[--top];
            component[size++] = p;
            const x = p % w;
            const y = (p - x) / w;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const q = yy * w + xx;
                    if (!seen[q] && data[q * 4 + 3] >= OPAQUE_ALPHA) {
                        seen[q] = 1;
                        stack[top++] = q;
                    }
                }
            }
        }
        if (size < minArea) for (let i = 0; i < size; i++) out[component[i] * 4 + 3] = 0;
    }
    return { width: w, height: h, data: out };
}
