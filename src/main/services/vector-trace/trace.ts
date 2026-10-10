import { ColorMode, Hierarchical, PathSimplifyMode, vectorizeRaw, type Config } from '@neplex/vectorizer';
import type { VectorizeParams } from '../../../shared/types';
import { medianGray } from './image-io';
import { blackPaths, parseSvg, type SvgPath } from './svg-model';
import { isTraceCancelled, throwIfCancelled, type GrayImage, type RgbaImage } from './types';

// 変換ライブラリ (vtracer) の呼び出し

// 反復の回数 (vtracer の既定値)
const MAX_ITERATIONS = 10;
// 白黒モードで使わない値 (白黒モードでは色精度・グラデーション幅・階層は使われない。vtracer の既定値を渡す)
const BINARY_COLOR_PRECISION = 6;
const BINARY_LAYER_DIFFERENCE = 16;
// 白黒の変換に失敗したときに、かけてから変換し直すメディアンの大きさ (順に試す)
const RETRY_MEDIANS = [3, 5];

function pathMode(params: VectorizeParams): PathSimplifyMode {
    if (params.mode === 'polygon') return PathSimplifyMode.Polygon;
    if (params.mode === 'none') return PathSimplifyMode.None;
    return PathSimplifyMode.Spline;
}

// パラメータの変換の設定 (pathPrecision は座標の小数点以下の桁数)
export function traceConfig(params: VectorizeParams, pathPrecision: number): Config {
    return {
        colorMode: params.colorMode === 'binary' ? ColorMode.Binary : ColorMode.Color,
        hierarchical: params.hierarchical === 'cutout' ? Hierarchical.Cutout : Hierarchical.Stacked,
        filterSpeckle: params.filterSpeckle,
        colorPrecision: params.colorPrecision,
        layerDifference: params.layerDifference,
        mode: pathMode(params),
        cornerThreshold: params.cornerThreshold,
        lengthThreshold: params.lengthThreshold,
        maxIterations: MAX_ITERATIONS,
        spliceThreshold: params.spliceThreshold,
        pathPrecision,
    };
}

// 白黒モードの変換の設定 (カラー・階層・色精度・グラデーション幅はパラメータの値を使わない)
export function binaryTraceConfig(params: VectorizeParams, pathPrecision: number): Config {
    return {
        ...traceConfig(params, pathPrecision),
        colorMode: ColorMode.Binary,
        hierarchical: Hierarchical.Stacked,
        colorPrecision: BINARY_COLOR_PRECISION,
        layerDifference: BINARY_LAYER_DIFFERENCE,
    };
}

// RGBA の画像を変換する
export async function traceRgba(image: RgbaImage, config: Config, signal: AbortSignal): Promise<string> {
    throwIfCancelled(signal);
    return vectorizeRaw(image.data, { width: image.width, height: image.height }, config, signal);
}

// 白黒の画像 (0 が黒) を、白黒モードで変換するための RGBA にする
function binaryToRgba(image: GrayImage): RgbaImage {
    const pixels = image.width * image.height;
    const out = Buffer.alloc(pixels * 4, 255);
    for (let p = 0; p < pixels; p++) {
        if (image.data[p] < 128) out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = 0;
    }
    return { width: image.width, height: image.height, data: out };
}

// 白黒の画像 (0 が黒、255 が白) を白黒モードで変換し、黒の形を返す
export async function traceBinary(image: GrayImage, config: Config, signal: AbortSignal): Promise<SvgPath[]> {
    try {
        return blackPaths(parseSvg(await traceRgba(binaryToRgba(image), config, signal)));
    } catch (error) {
        throwIfCancelled(signal);
        throw error;
    }
}

// traceBinary と同じだが、失敗したら (細かい点が多すぎる白黒画像で `Unknown error occurred` になる)、
// 3x3、5x5 のメディアンをかけて変換し直す。それでも失敗したら null
export async function traceBinaryWithRetry(
    image: GrayImage,
    config: Config,
    signal: AbortSignal
): Promise<SvgPath[] | null> {
    for (const median of [0, ...RETRY_MEDIANS]) {
        try {
            const input = median ? await medianGray(image, median) : image;
            return await traceBinary(input, config, signal);
        } catch (error) {
            if (isTraceCancelled(error)) throw error;
            // 次の大きさのメディアンで変換し直す
        }
    }
    return null;
}
