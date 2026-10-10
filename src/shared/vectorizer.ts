// 画像 SVG 変換 (vtracer) のパラメータ・前処理・出力の既定値と範囲 (main / renderer で共用)。
// Node / DOM に依存させない。

import type { VectorizeOutput, VectorizeParams, VectorizePreprocess } from './types';

// 変換パラメータの初期値 (設定ファイルには保存しないため、起動のたびにこの値から始まる)。
// 色精度のほかは vtracer の既定値
export const DEFAULT_VECTORIZE_PARAMS: VectorizeParams = {
    colorMode: 'color',
    hierarchical: 'stacked',
    filterSpeckle: 4,
    colorPrecision: 8,
    layerDifference: 16,
    mode: 'spline',
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    spliceThreshold: 45,
};

// 標準のプリセット「汎用」の ID。値は DEFAULT_VECTORIZE_PARAMS と同じで、起動したときはこのプリセットを選んだ状態にする
export const INITIAL_VECTORIZE_PRESET_ID = 'builtin-general';

type NumericVectorizeParam =
    'filterSpeckle' | 'colorPrecision' | 'layerDifference' | 'cornerThreshold' | 'lengthThreshold' | 'spliceThreshold';

// 数値のパラメータの範囲 (画面のスライダーの範囲。プリセットの値もこの範囲に収める)
export const VECTORIZE_PARAM_RANGES: Record<NumericVectorizeParam, { min: number; max: number; step: number }> = {
    filterSpeckle: { min: 0, max: 128, step: 1 },
    colorPrecision: { min: 1, max: 8, step: 1 },
    layerDifference: { min: 0, max: 128, step: 1 },
    cornerThreshold: { min: 0, max: 180, step: 1 },
    lengthThreshold: { min: 3.5, max: 10, step: 0.1 },
    spliceThreshold: { min: 0, max: 180, step: 1 },
};

// 前処理の初期値 (パラメータと同じく設定ファイルには保存しない)
export const DEFAULT_VECTORIZE_PREPROCESS: VectorizePreprocess = {
    longSide: 2048,
    upscale: 'bilinear',
    removeBackground: false,
    backgroundTolerance: 12,
    speckArea: 16,
    grayscale: false,
    recolor: false,
};

// 前処理の数値の範囲 (画面のスライダーと入力欄の範囲。整数)
export const VECTORIZE_PREPROCESS_RANGES: Record<
    'longSide' | 'backgroundTolerance' | 'speckArea',
    { min: number; max: number }
> = {
    longSide: { min: 256, max: 8192 },
    backgroundTolerance: { min: 0, max: 64 },
    speckArea: { min: 0, max: 256 },
};

// 出力の初期値 (パラメータと同じく設定ファイルには保存しない)
export const DEFAULT_VECTORIZE_OUTPUT: VectorizeOutput = {
    optimize: true,
    pathPrecision: 2,
};

// 出力の数値の範囲 (画面のスライダーの範囲)。座標の精度 0 は変換ライブラリの中でメモリが際限なく増えるため選べない
export const VECTORIZE_OUTPUT_RANGES: Record<'pathPrecision', { min: number; max: number; step: number }> = {
    pathPrecision: { min: 1, max: 8, step: 1 },
};
