import { labInto } from './lab';
import { rasterizeSvg } from './rasterize';
import { readSvgFrame, withSvgFrame } from './svg-model';
import type { RgbaImage } from './types';

// 再現度 (変換した SVG が元画像をどれだけ再現しているか)。
// 再現度 = 0.35 x SSIM + 0.25 x (1 - 色差 (ΔE76) / 30) + 0.4 x (1 - GMSD / 0.35)。
// GMSD は輪郭の一致度で、細部の消失を捉えるために入れる (SSIM と色差だけでは細部が消えてもほとんど下がらない)

// 再現度を測る大きさ (長辺)
export const FIDELITY_LONG_SIDE = 1024;

const DELTA_E_CAP = 30;
const GMSD_CAP = 0.35;
const WEIGHT_SSIM = 0.35;
const WEIGHT_DELTA_E = 0.25;
const WEIGHT_GMSD = 0.4;

// SSIM の窓 (8x8) と間隔、定数 ((0.01 x 255)^2、(0.03 x 255)^2)
const SSIM_WINDOW = 8;
const SSIM_STRIDE = 4;
const SSIM_C1 = 6.5025;
const SSIM_C2 = 58.5225;
// GMSD の定数
const GMSD_C = 170;

export type FidelityReference = {
    width: number;
    height: number;
    luma: Float32Array;
    lab: Float32Array;
    grad: Float32Array;
};

export type FidelityMetrics = {
    ssim: number;
    deltaE: number;
    gmsd: number;
};

function lumaOf(image: RgbaImage): Float32Array {
    const pixels = image.width * image.height;
    const out = new Float32Array(pixels);
    const d = image.data;
    for (let p = 0; p < pixels; p++) out[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2];
    return out;
}

// 明るさの勾配の大きさ (Sobel。縁の 1 画素は 0)
function gradMag(l: Float32Array, width: number, height: number): Float32Array {
    const g = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const gx =
                (l[i - width + 1] +
                    2 * l[i + 1] +
                    l[i + width + 1] -
                    l[i - width - 1] -
                    2 * l[i - 1] -
                    l[i + width - 1]) /
                4;
            const gy =
                (l[i + width - 1] +
                    2 * l[i + width] +
                    l[i + width + 1] -
                    l[i - width - 1] -
                    2 * l[i - width] -
                    l[i - width + 1]) /
                4;
            g[i] = Math.hypot(gx, gy);
        }
    }
    return g;
}

// 明るさの SSIM (8x8 の窓を 4 画素ずつずらした平均)
function ssimLuma(a: Float32Array, b: Float32Array, width: number, height: number): number {
    let total = 0;
    let count = 0;
    const n = SSIM_WINDOW * SSIM_WINDOW;
    for (let y = 0; y + SSIM_WINDOW <= height; y += SSIM_STRIDE) {
        for (let x = 0; x + SSIM_WINDOW <= width; x += SSIM_STRIDE) {
            let ma = 0;
            let mb = 0;
            for (let yy = 0; yy < SSIM_WINDOW; yy++) {
                for (let xx = 0; xx < SSIM_WINDOW; xx++) {
                    const i = (y + yy) * width + x + xx;
                    ma += a[i];
                    mb += b[i];
                }
            }
            ma /= n;
            mb /= n;
            let va = 0;
            let vb = 0;
            let cov = 0;
            for (let yy = 0; yy < SSIM_WINDOW; yy++) {
                for (let xx = 0; xx < SSIM_WINDOW; xx++) {
                    const i = (y + yy) * width + x + xx;
                    const da = a[i] - ma;
                    const db = b[i] - mb;
                    va += da * da;
                    vb += db * db;
                    cov += da * db;
                }
            }
            total +=
                ((2 * ma * mb + SSIM_C1) * ((2 * cov) / (n - 1) + SSIM_C2)) /
                ((ma * ma + mb * mb + SSIM_C1) * ((va + vb) / (n - 1) + SSIM_C2));
            count++;
        }
    }
    return count ? total / count : 1;
}

// 白地に合成する (resvg の画素はアルファを掛けた後の色のため、白の分だけを足す)
function flattenOnWhite(image: RgbaImage): RgbaImage {
    const out = Buffer.alloc(image.data.length);
    for (let i = 0; i < image.data.length; i += 4) {
        const white = 255 - image.data[i + 3];
        for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, image.data[i + c] + white);
        out[i + 3] = 255;
    }
    return { width: image.width, height: image.height, data: out };
}

// 比べる元画像 (不透明。長辺 FIDELITY_LONG_SIDE 以下) の明るさ・Lab・勾配を求めておく
export function makeReference(image: RgbaImage): FidelityReference {
    const { width, height, data } = image;
    const luma = lumaOf(image);
    const lab = new Float32Array(width * height * 3);
    for (let p = 0; p < width * height; p++) labInto(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], lab, p * 3);
    return { width, height, luma, lab, grad: gradMag(luma, width, height) };
}

// SVG を元画像と同じ大きさで描き (白地に合成)、元画像と比べる
export function measure(reference: FidelityReference, svg: string): FidelityMetrics {
    const { width, height } = reference;
    // 表示の大きさを比べる画像の大きさにし、座標の範囲 (viewBox) 全体をそこへ合わせて描く (表示の大きさの丸めや
    // 縦横の比の違いで、描く位置がずれないように)
    const frame = readSvgFrame(svg);
    const fitted = withSvgFrame(svg, {
        width: String(width),
        height: String(height),
        viewBox: frame.viewBox,
        preserveAspectRatio: 'none',
    });
    const raster = flattenOnWhite(rasterizeSvg(fitted, width, height));
    const luma = lumaOf(raster);
    const pixels = width * height;
    const lab = new Float64Array(3);
    let deltaSum = 0;
    for (let p = 0; p < pixels; p++) {
        labInto(raster.data[p * 4], raster.data[p * 4 + 1], raster.data[p * 4 + 2], lab, 0);
        deltaSum += Math.hypot(
            reference.lab[p * 3] - lab[0],
            reference.lab[p * 3 + 1] - lab[1],
            reference.lab[p * 3 + 2] - lab[2]
        );
    }
    const grad = gradMag(luma, width, height);
    const gms = new Float32Array(pixels);
    let gmsSum = 0;
    for (let p = 0; p < pixels; p++) {
        const r = reference.grad[p];
        gms[p] = (2 * r * grad[p] + GMSD_C) / (r * r + grad[p] * grad[p] + GMSD_C);
        gmsSum += gms[p];
    }
    const gmsMean = gmsSum / pixels;
    let variance = 0;
    for (let p = 0; p < pixels; p++) variance += (gms[p] - gmsMean) ** 2;
    return {
        ssim: ssimLuma(reference.luma, luma, width, height),
        deltaE: deltaSum / pixels,
        gmsd: Math.sqrt(variance / pixels),
    };
}

export function fidelity(metrics: FidelityMetrics): number {
    return (
        WEIGHT_SSIM * metrics.ssim +
        WEIGHT_DELTA_E * (1 - Math.min(metrics.deltaE, DELTA_E_CAP) / DELTA_E_CAP) +
        WEIGHT_GMSD * (1 - Math.min(metrics.gmsd, GMSD_CAP) / GMSD_CAP)
    );
}

// SVG の再現度
export function measureFidelity(reference: FidelityReference, svg: string): number {
    return fidelity(measure(reference, svg));
}
