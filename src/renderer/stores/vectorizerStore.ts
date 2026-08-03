import { create } from 'zustand';
import type { VectorizeParams } from '@shared/types';

// 変換パラメータの初期値 (設定ファイルには保存しないため、起動のたびにこの値から始まる)
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

type VectorizerState = {
    imagePath: string | null;
    imageDataUrl: string | null;
    svg: string | null;
    params: VectorizeParams;
    setImage(imagePath: string, imageDataUrl: string): void;
    setSvg(svg: string | null): void;
    patchParams(patch: Partial<VectorizeParams>): void;
};

export const useVectorizerStore = create<VectorizerState>(set => ({
    imagePath: null,
    imageDataUrl: null,
    svg: null,
    params: DEFAULT_VECTORIZE_PARAMS,
    setImage(imagePath, imageDataUrl) {
        set({ imagePath, imageDataUrl, svg: null });
    },
    setSvg(svg) {
        set({ svg });
    },
    patchParams(patch) {
        set(state => ({ params: { ...state.params, ...patch } }));
    },
}));
