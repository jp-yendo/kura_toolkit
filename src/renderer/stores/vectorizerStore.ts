import { create } from 'zustand';
import type { SvgResult, VectorizeParams } from '@shared/types';
import { DEFAULT_VECTORIZE_PARAMS, INITIAL_VECTORIZE_PRESET_ID } from '@shared/vectorizer';

type VectorizerState = {
    imagePath: string | null;
    imageUrl: string | null;
    // 変換結果 (中身は main が作業ディレクトリに持つ)
    svg: SvgResult | null;
    params: VectorizeParams;
    // 選択中のプリセットの ID (空 = 選んでいない。パラメータと同じく画面を行き来しても保つ)
    presetId: string;
    // 選択中のプリセットの値 (スライダーの「プリセットの値に戻す」の戻り先。プリセットを選んでいないときは null)
    presetParams: VectorizeParams | null;
    setImage(imagePath: string, imageUrl: string): void;
    setSvg(svg: SvgResult | null): void;
    patchParams(patch: Partial<VectorizeParams>): void;
    setPresetId(presetId: string): void;
    setPresetParams(presetParams: VectorizeParams | null): void;
};

export const useVectorizerStore = create<VectorizerState>(set => ({
    imagePath: null,
    imageUrl: null,
    svg: null,
    params: DEFAULT_VECTORIZE_PARAMS,
    presetId: INITIAL_VECTORIZE_PRESET_ID,
    // 「汎用」の値 (= 既定値)。一覧を読み込むと、読み込んだプリセットの値に置き換わる
    presetParams: DEFAULT_VECTORIZE_PARAMS,
    setImage(imagePath, imageUrl) {
        set({ imagePath, imageUrl, svg: null });
    },
    setSvg(svg) {
        set({ svg });
    },
    patchParams(patch) {
        set(state => ({ params: { ...state.params, ...patch } }));
    },
    setPresetId(presetId) {
        set({ presetId });
    },
    setPresetParams(presetParams) {
        set({ presetParams });
    },
}));
