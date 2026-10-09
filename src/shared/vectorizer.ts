// 画像 SVG 変換 (vtracer) のパラメータの既定値と範囲 (main / renderer で共用)。
// Node / DOM に依存させない。

import type { VectorizeParams } from './types';

// 変換パラメータの初期値 (vtracer の既定値。設定ファイルには保存しないため、起動のたびにこの値から始まる)
export const DEFAULT_VECTORIZE_PARAMS: VectorizeParams = {
    colorMode: 'color',
    hierarchical: 'stacked',
    filterSpeckle: 4,
    colorPrecision: 6,
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
