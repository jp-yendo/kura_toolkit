import { create } from 'zustand';
import type { SvgResult, VectorizeOutput, VectorizeParams, VectorizePreprocess } from '@shared/types';
import type { ImageBackdrop } from '../components/image/backdrop';
import {
    DEFAULT_VECTORIZE_OUTPUT,
    DEFAULT_VECTORIZE_PARAMS,
    DEFAULT_VECTORIZE_PREPROCESS,
    INITIAL_VECTORIZE_PRESET_ID,
} from '@shared/vectorizer';

type VectorizerState = {
    imagePath: string | null;
    imageUrl: string | null;
    // 変換結果 (中身は main が作業ディレクトリに持つ)
    svg: SvgResult | null;
    params: VectorizeParams;
    // 前処理と出力 (プリセットに含めない)
    preprocess: VectorizePreprocess;
    output: VectorizeOutput;
    // 選択中のプリセットの ID (空 = 選んでいない)
    presetId: string;
    // 選択中のプリセットの値 (スライダーの「プリセットの値に戻す」の戻り先。プリセットを選んでいないときは null)
    presetParams: VectorizeParams | null;
    // 比較の背景と、上下の表示を同期するか
    backdrop: ImageBackdrop;
    sync: boolean;
    setImage(imagePath: string, imageUrl: string): void;
    setSvg(svg: SvgResult | null): void;
    patchParams(patch: Partial<VectorizeParams>): void;
    patchPreprocess(patch: Partial<VectorizePreprocess>): void;
    patchOutput(patch: Partial<VectorizeOutput>): void;
    setPresetId(presetId: string): void;
    setPresetParams(presetParams: VectorizeParams | null): void;
    setBackdrop(backdrop: ImageBackdrop): void;
    setSync(sync: boolean): void;
    // 初めの状態に戻す (別の機能へ移ったとき)
    reset(): void;
};

type VectorizerData = Omit<
    VectorizerState,
    | 'setImage'
    | 'setSvg'
    | 'patchParams'
    | 'patchPreprocess'
    | 'patchOutput'
    | 'setPresetId'
    | 'setPresetParams'
    | 'setBackdrop'
    | 'setSync'
    | 'reset'
>;

const INITIAL_STATE: VectorizerData = {
    imagePath: null,
    imageUrl: null,
    svg: null,
    params: DEFAULT_VECTORIZE_PARAMS,
    preprocess: DEFAULT_VECTORIZE_PREPROCESS,
    output: DEFAULT_VECTORIZE_OUTPUT,
    presetId: INITIAL_VECTORIZE_PRESET_ID,
    // 「汎用」の値 (= 既定値)。一覧を読み込むと、読み込んだプリセットの値に置き換わる
    presetParams: DEFAULT_VECTORIZE_PARAMS,
    backdrop: 'checker',
    sync: true,
};

export const useVectorizerStore = create<VectorizerState>(set => ({
    ...INITIAL_STATE,
    setImage(imagePath, imageUrl) {
        set({ imagePath, imageUrl, svg: null });
    },
    setSvg(svg) {
        set({ svg });
    },
    patchParams(patch) {
        set(state => ({ params: { ...state.params, ...patch } }));
    },
    patchPreprocess(patch) {
        set(state => ({ preprocess: { ...state.preprocess, ...patch } }));
    },
    patchOutput(patch) {
        set(state => ({ output: { ...state.output, ...patch } }));
    },
    setPresetId(presetId) {
        set({ presetId });
    },
    setPresetParams(presetParams) {
        set({ presetParams });
    },
    setBackdrop(backdrop) {
        set({ backdrop });
    },
    setSync(sync) {
        set({ sync });
    },
    reset() {
        set(INITIAL_STATE);
    },
}));
