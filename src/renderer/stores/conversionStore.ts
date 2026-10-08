import { create } from 'zustand';
import {
    dereverbOption,
    loudnessOption,
    noiseRemovalOption,
    SEPARATION_LOUDNESS_DEFAULT_LUFS,
    silenceOption,
} from '@shared/voice/audio-filters';
import { effectsDefaults } from '@shared/voice/audio-effects';
import type { CandidateFilters, ConversionCandidate, ConversionParams, MediaRef, MixParams } from '@shared/voice/types';

// 音声変換の作業 (入力の選び方・変換する音と伴奏の選択・候補・合成)。元の音源と分離の結果の木は
// useConversionSeparationStore が持つ

export type ConversionInputMode = 'separate' | 'direct';

export const DEFAULT_CONVERSION_PARAMS: ConversionParams = {
    pitch: 0,
    f0Method: 'rmvpe',
    indexRate: 0.75,
    volumeEnvelope: 1,
    protect: 0.5,
};

export const DEFAULT_MIX_PARAMS: MixParams = {
    vocalGainDb: 0,
    accompanimentGainDb: 0,
    masterGainDb: 0,
};

// 候補のフィルターの初期値。除去・調整は分岐の「除去・調整」と、エフェクトは分岐の「エフェクト」と同じ
export function defaultCandidateFilters(): CandidateFilters {
    return {
        process: {
            dereverb: dereverbOption(false),
            noiseRemoval: noiseRemovalOption(false),
            muteSilence: silenceOption(false),
            loudness: loudnessOption(false, SEPARATION_LOUDNESS_DEFAULT_LUFS),
        },
        effects: effectsDefaults(),
    };
}

type ConversionState = {
    step: number;
    inputMode: ConversionInputMode;
    // 分離した音のうち、変換する音 (出力のキー。null は最初に選んでおく音)
    vocalsTrack: string | null;
    // 伴奏として重ねる音 (出力のキー。null は最初に選んでおく音)
    accompanimentTracks: string[] | null;
    voiceId: string;
    params: ConversionParams;
    candidates: ConversionCandidate[];
    // 候補を作ったときの入力 (ボーカルと伴奏)。入力が変わったら候補は無効になる
    candidatesInput: string | null;
    selectedId: string | null;
    mixParams: MixParams;
    // 候補のフィルターで最後に使った値 (ダイアログはチェックをすべて外した状態で開き、値だけを引き継ぐ)
    candidateFilters: CandidateFilters;
    mix: MediaRef | null;
    // 合成結果を作ったときの入力 (選んだ候補・入力 (伴奏)・パラメーターが変わったら作り直しが必要)
    mixSignature: string | null;
    setStep(step: number): void;
    setInputMode(mode: ConversionInputMode): void;
    setVocalsTrack(key: string): void;
    setAccompanimentTracks(keys: string[]): void;
    setVoiceId(id: string): void;
    setParams(params: ConversionParams): void;
    // 候補を加える。フィルターをかけて作った候補は、元にした候補のすぐ下に置く
    addCandidate(candidate: ConversionCandidate, inputKey: string): void;
    setCandidateFilters(filters: CandidateFilters): void;
    // 候補の、伴奏と重ねた試聴用の音を設定する
    setCandidatePreview(id: string, media: MediaRef): void;
    removeCandidate(id: string): void;
    selectCandidate(id: string | null): void;
    setMixParams(params: MixParams): void;
    setMix(mix: MediaRef | null, signature: string | null): void;
    // 入力が変わったので変換以降の結果を捨てる (捨てた候補を返す)
    clearResults(): ConversionCandidate[];
    reset(): void;
};

export const useConversionStore = create<ConversionState>((set, get) => ({
    step: 0,
    inputMode: 'separate',
    vocalsTrack: null,
    accompanimentTracks: null,
    voiceId: '',
    params: DEFAULT_CONVERSION_PARAMS,
    candidates: [],
    candidatesInput: null,
    selectedId: null,
    mixParams: DEFAULT_MIX_PARAMS,
    candidateFilters: defaultCandidateFilters(),
    mix: null,
    mixSignature: null,
    setStep(step) {
        set({ step });
    },
    setInputMode(inputMode) {
        set({ inputMode });
    },
    setVocalsTrack(vocalsTrack) {
        set({ vocalsTrack });
    },
    setAccompanimentTracks(accompanimentTracks) {
        set({ accompanimentTracks });
    },
    setVoiceId(voiceId) {
        set({ voiceId });
    },
    setParams(params) {
        set({ params });
    },
    addCandidate(candidate, inputKey) {
        const candidates = [...get().candidates];
        const parent = candidate.parentId ? candidates.findIndex(item => item.id === candidate.parentId) : -1;
        if (parent >= 0) candidates.splice(parent + 1, 0, candidate);
        else candidates.push(candidate);
        set({
            candidates,
            candidatesInput: inputKey,
            selectedId: get().selectedId ?? candidate.id,
        });
    },
    setCandidateFilters(candidateFilters) {
        set({ candidateFilters });
    },
    setCandidatePreview(id, media) {
        set({
            candidates: get().candidates.map(item => (item.id === id ? { ...item, withAccompaniment: media } : item)),
        });
    },
    removeCandidate(id) {
        const candidates = get().candidates.filter(item => item.id !== id);
        set({ candidates, selectedId: get().selectedId === id ? (candidates[0]?.id ?? null) : get().selectedId });
    },
    selectCandidate(selectedId) {
        set({ selectedId });
    },
    setMixParams(mixParams) {
        set({ mixParams });
    },
    setMix(mix, mixSignature) {
        set({ mix, mixSignature });
    },
    clearResults() {
        const removed = get().candidates;
        set({ candidates: [], candidatesInput: null, selectedId: null, mix: null, mixSignature: null });
        return removed;
    },
    reset() {
        set({
            step: 0,
            inputMode: 'separate',
            vocalsTrack: null,
            accompanimentTracks: null,
            candidates: [],
            candidatesInput: null,
            selectedId: null,
            mix: null,
            mixSignature: null,
        });
    },
}));
