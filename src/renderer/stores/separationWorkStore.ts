import { create } from 'zustand';
import { newWorkKey } from '../components/voice/voiceFormat';
import { SOURCE_KEY, stageRoles, type SepStage } from '../components/voice/separationTracks';
import type { PreparedInput, SeparationCandidate, SeparationCategory, SeparationParams } from '@shared/voice/types';

// 分離の作業 (元音源・段階・候補・採用)。音声分離の画面と、音声変換の画面の「入力と分離」で別々に持つ。
// 作業の結果は作業ディレクトリにあり、アプリを終了すると消える (作業をまたいで使うときは書き出したファイルを読む)。

const DEFAULT_SEPARATION_PARAMS: SeparationParams = {
    mdx: { segmentSize: 256, overlap: 0.25, batchSize: 1, hopLength: 1024, enableDenoise: false },
    vr: {
        windowSize: 512,
        aggression: 5,
        enableTta: false,
        enablePostProcess: false,
        postProcessThreshold: 0.2,
        highEndProcess: false,
        batchSize: 1,
    },
    demucs: { segmentSize: null, shifts: 2, overlap: 0.25, segmentsEnabled: true },
    mdxc: { segmentSize: 256, overrideModelSegmentSize: false, batchSize: null, overlap: null, pitchShift: 0 },
};

type SeparationWorkState = {
    workKey: string;
    source: PreparedInput | null;
    sourceName: string;
    stages: SepStage[];
    activeStage: number;
    // 画面で編集中のパラメーター (段階をまたいで引き継ぐ)
    params: SeparationParams;
    setSource(source: PreparedInput | null, name: string): void;
    reset(): void;
    setActiveStage(index: number): void;
    addStage(inputKey: string, category: SeparationCategory): void;
    // 指定の段階より後ろを取り除く (前の段階の採用をやり直したとき)。取り除いた候補を返す
    truncateAfter(index: number): SeparationCandidate[];
    updateStage(index: number, patch: Partial<SepStage>): void;
    addCandidate(index: number, candidate: SeparationCandidate): void;
    removeCandidate(index: number, candidateId: string): void;
    setParams(params: SeparationParams): void;
};

function newStage(inputKey: string, category: SeparationCategory): SepStage {
    return {
        id: crypto.randomUUID(),
        inputKey,
        category,
        candidates: [],
        adoptionMode: 'same',
        sameCandidate: null,
        perRole: {},
        removedToAccompaniment: false,
    };
}

function createSeparationWorkStore() {
    return create<SeparationWorkState>((set, get) => ({
        workKey: newWorkKey(),
        source: null,
        sourceName: '',
        stages: [],
        activeStage: 0,
        params: DEFAULT_SEPARATION_PARAMS,
        setSource(source, name) {
            set({ source, sourceName: name, stages: source ? [newStage(SOURCE_KEY, 'vocals')] : [], activeStage: 0 });
        },
        reset() {
            set({
                workKey: newWorkKey(),
                source: null,
                sourceName: '',
                stages: [],
                activeStage: 0,
            });
        },
        setActiveStage(index) {
            set({ activeStage: index });
        },
        addStage(inputKey, category) {
            const stages = [...get().stages, newStage(inputKey, category)];
            set({ stages, activeStage: stages.length - 1 });
        },
        truncateAfter(index) {
            const stages = get().stages;
            const removed = stages.slice(index + 1).flatMap(stage => stage.candidates);
            set({ stages: stages.slice(0, index + 1), activeStage: Math.min(get().activeStage, index) });
            return removed;
        },
        updateStage(index, patch) {
            set({ stages: get().stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)) });
        },
        addCandidate(index, candidate) {
            set({
                stages: get().stages.map((stage, i) => {
                    if (i !== index) return stage;
                    const next = { ...stage, candidates: [...stage.candidates, candidate] };
                    // 最初の候補は採用済みにしておく (比較のために候補を足しても採用は変えない)
                    if (!next.sameCandidate) next.sameCandidate = candidate.id;
                    for (const role of stageRoles(next)) {
                        if (!next.perRole[role]) next.perRole = { ...next.perRole, [role]: candidate.id };
                    }
                    return next;
                }),
            });
        },
        removeCandidate(index, candidateId) {
            set({
                stages: get().stages.map((stage, i) => {
                    if (i !== index) return stage;
                    const candidates = stage.candidates.filter(item => item.id !== candidateId);
                    const fallback = candidates[0]?.id ?? null;
                    const perRole: Record<string, string | null> = {};
                    for (const [role, id] of Object.entries(stage.perRole))
                        perRole[role] = id === candidateId ? fallback : id;
                    return {
                        ...stage,
                        candidates,
                        sameCandidate: stage.sameCandidate === candidateId ? fallback : stage.sameCandidate,
                        perRole,
                    };
                }),
            });
        },
        setParams(params) {
            set({ params });
        },
    }));
}

export const useSeparationWorkStore = createSeparationWorkStore();
export const useConversionSeparationStore = createSeparationWorkStore();

export type SeparationWorkStore = typeof useSeparationWorkStore;
