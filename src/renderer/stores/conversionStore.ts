import { create } from 'zustand';
import type { ConversionCandidate, ConversionParams, MediaRef, MixParams } from '@shared/voice/types';

// 音声変換の作業 (入力と分離の後の段階)。入力と分離は useConversionSeparationStore が持つ

export type ConversionInputMode = 'separate' | 'direct';

const DEFAULT_CONVERSION_PARAMS: ConversionParams = {
    pitch: 0,
    f0Method: 'rmvpe',
    indexRate: 0.75,
    volumeEnvelope: 1,
    protect: 0.5,
};

const DEFAULT_MIX_PARAMS: MixParams = {
    vocalGainDb: 0,
    accompanimentGainDb: 0,
    masterGainDb: 0,
    reverb: { enabled: true, roomSize: 0.3, damping: 0.5, wetLevel: 0.12, dryLevel: 0.9, width: 1 },
    limiter: true,
};

type ConversionState = {
    step: number;
    inputMode: ConversionInputMode;
    voiceId: string;
    params: ConversionParams;
    candidates: ConversionCandidate[];
    // 候補を作ったときの入力 (ボーカルと伴奏)。入力が変わったら候補は無効になる
    candidatesInput: string | null;
    adoptedId: string | null;
    mixParams: MixParams;
    mix: MediaRef | null;
    // 合成結果を作ったときの入力 (採用やパラメーターが変わったら作り直しが必要)
    mixSignature: string | null;
    setStep(step: number): void;
    setInputMode(mode: ConversionInputMode): void;
    setVoiceId(id: string): void;
    setParams(params: ConversionParams): void;
    addCandidate(candidate: ConversionCandidate, inputKey: string): void;
    removeCandidate(id: string): void;
    setAdopted(id: string | null): void;
    setMixParams(params: MixParams): void;
    setMix(mix: MediaRef | null, signature: string | null): void;
    // 入力が変わったので変換以降の結果を捨てる (捨てた候補を返す)
    clearResults(): ConversionCandidate[];
    reset(): void;
};

export const useConversionStore = create<ConversionState>((set, get) => ({
    step: 0,
    inputMode: 'separate',
    voiceId: '',
    params: DEFAULT_CONVERSION_PARAMS,
    candidates: [],
    candidatesInput: null,
    adoptedId: null,
    mixParams: DEFAULT_MIX_PARAMS,
    mix: null,
    mixSignature: null,
    setStep(step) {
        set({ step });
    },
    setInputMode(inputMode) {
        set({ inputMode });
    },
    setVoiceId(voiceId) {
        set({ voiceId });
    },
    setParams(params) {
        set({ params });
    },
    addCandidate(candidate, inputKey) {
        set({
            candidates: [...get().candidates, candidate],
            candidatesInput: inputKey,
            adoptedId: get().adoptedId ?? candidate.id,
        });
    },
    removeCandidate(id) {
        const candidates = get().candidates.filter(item => item.id !== id);
        set({ candidates, adoptedId: get().adoptedId === id ? (candidates[0]?.id ?? null) : get().adoptedId });
    },
    setAdopted(adoptedId) {
        set({ adoptedId });
    },
    setMixParams(mixParams) {
        set({ mixParams });
    },
    setMix(mix, mixSignature) {
        set({ mix, mixSignature });
    },
    clearResults() {
        const removed = get().candidates;
        set({ candidates: [], candidatesInput: null, adoptedId: null, mix: null, mixSignature: null });
        return removed;
    },
    reset() {
        set({
            step: 0,
            inputMode: 'separate',
            candidates: [],
            candidatesInput: null,
            adoptedId: null,
            mix: null,
            mixSignature: null,
        });
    },
}));
