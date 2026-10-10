import { create } from 'zustand';
import type {
    JobEvent,
    SvgAutoJobResult,
    SvgAutoProgressPayload,
    SvgAutoResult,
    VectorizeOutput,
    VectorizePreprocess,
} from '@shared/types';
import { DEFAULT_SVG_AUTO_TRIALS } from '@shared/svg-auto';
import { DEFAULT_VECTORIZE_OUTPUT, DEFAULT_VECTORIZE_PREPROCESS } from '@shared/vectorizer';
import type { ImageBackdrop } from '../components/image/backdrop';
import { nextPhase, type PhaseState } from '../hooks/useJobRunner';

// SVG 自動変換の画面の状態。変換の進み具合と結果もここに持つ (画面を移って戻っても、進み具合と結果が見えるように)

// 実行中の自動変換
export type SvgAutoJob = {
    jobId: string;
    // 今の手順の中の進み具合 (0-100。分からないときは undefined)
    percent?: number;
    phase?: PhaseState;
    // これまでに得た最も高い再現度
    bestFidelity: number | null;
};

type SvgAutoState = {
    imagePath: string | null;
    imageUrl: string | null;
    // 前処理・出力・試す回数 (設定ファイルには保存せず、同じ機能の中では保つ)
    preprocess: VectorizePreprocess;
    output: VectorizeOutput;
    trials: number;
    job: SvgAutoJob | null;
    // 結果 (版のファイルは main が作業ディレクトリに持つ)
    result: SvgAutoResult | null;
    // 選んでいる版
    selectedId: string | null;
    // 比較の背景と、上下の表示を同期するか
    backdrop: ImageBackdrop;
    sync: boolean;
    setImage(imagePath: string, imageUrl: string): void;
    patchPreprocess(patch: Partial<VectorizePreprocess>): void;
    patchOutput(patch: Partial<VectorizeOutput>): void;
    setTrials(trials: number): void;
    selectVersion(id: string): void;
    setBackdrop(backdrop: ImageBackdrop): void;
    setSync(sync: boolean): void;
    // 自動変換を始め、終わるまで待つ (失敗したときは投げる)。始められないとき (画像が無い・実行中) は null
    start(): Promise<SvgAutoJobResult | null>;
    cancel(): void;
    // 結果を破棄して設定に戻る
    discardResult(): void;
    // 結果を破棄し、初めの状態に戻す (別の機能へ移ったとき)
    reset(): void;
};

type SvgAutoData = Pick<
    SvgAutoState,
    | 'imagePath'
    | 'imageUrl'
    | 'preprocess'
    | 'output'
    | 'trials'
    | 'job'
    | 'result'
    | 'selectedId'
    | 'backdrop'
    | 'sync'
>;

const INITIAL_STATE: SvgAutoData = {
    imagePath: null,
    imageUrl: null,
    preprocess: DEFAULT_VECTORIZE_PREPROCESS,
    output: DEFAULT_VECTORIZE_OUTPUT,
    trials: DEFAULT_SVG_AUTO_TRIALS,
    job: null,
    result: null,
    selectedId: null,
    backdrop: 'checker',
    sync: true,
};

export const useSvgAutoStore = create<SvgAutoState>((set, get) => ({
    ...INITIAL_STATE,
    setImage(imagePath, imageUrl) {
        set({ imagePath, imageUrl });
    },
    patchPreprocess(patch) {
        set(state => ({ preprocess: { ...state.preprocess, ...patch } }));
    },
    patchOutput(patch) {
        set(state => ({ output: { ...state.output, ...patch } }));
    },
    setTrials(trials) {
        set({ trials });
    },
    selectVersion(id) {
        set({ selectedId: id });
    },
    setBackdrop(backdrop) {
        set({ backdrop });
    },
    setSync(sync) {
        set({ sync });
    },
    async start() {
        const { imagePath, preprocess, output, trials, job } = get();
        if (!imagePath || job) return null;
        const jobId = crypto.randomUUID();
        // 前の結果を画面から外す
        set({ job: { jobId, bestFidelity: null }, result: null, selectedId: null });
        // 開始の直後に届く知らせを取りこぼさないよう、始める前に購読する
        const unsubscribe = window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== jobId || event.kind !== 'progress') return;
            set(state => {
                const current = state.job;
                if (!current || current.jobId !== jobId) return {};
                const payload = event.payload as SvgAutoProgressPayload | undefined;
                return {
                    job: {
                        ...current,
                        // null は、進み具合が分からない状態に戻す (不定の進捗バーにする)
                        percent: event.percent === null ? undefined : (event.percent ?? current.percent),
                        phase: event.phase ? nextPhase(current.phase, event.phase) : current.phase,
                        bestFidelity: payload?.bestFidelity ?? current.bestFidelity,
                    },
                };
            });
        });
        try {
            const response = await window.kuraToolkit.svgAuto.start(jobId, imagePath, { preprocess, output, trials });
            if (response.result) set({ result: response.result, selectedId: response.result.bestId });
            return response;
        } finally {
            unsubscribe();
            set(state => (state.job?.jobId === jobId ? { job: null } : {}));
        }
    },
    cancel() {
        const job = get().job;
        if (job) void window.kuraToolkit.jobs.cancel(job.jobId);
    },
    discardResult() {
        void window.kuraToolkit.svgAuto.discard();
        set({ result: null, selectedId: null });
    },
    reset() {
        get().cancel();
        void window.kuraToolkit.svgAuto.discard();
        set(INITIAL_STATE);
    },
}));
