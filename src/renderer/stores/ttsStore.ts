import { create } from 'zustand';
import { newWorkKey } from '../components/voice/voiceFormat';
import type { TtsEngineId, VoiceLanguage } from '@shared/voice/languages';
import type { TimelineOverflowMode, TtsCandidate, TtsInputKind, TtsParams } from '@shared/voice/types';

// 読み上げの作業 (編集中の文章・設定・候補)。読み込んだファイルの内容は画面上でだけ編集し、
// ディスク上のファイルへの反映は利用者が保存したときだけ行う。

const DEFAULT_TTS_PARAMS: TtsParams = {
    style: 'Neutral',
    styleWeight: 1,
    speed: 1,
    pitchScale: 1,
    intonationScale: 1,
    sdpRatio: 0.2,
    noise: 0.6,
    noiseW: 0.8,
    speakerId: 0,
    paragraphPause: 0.5,
};

type TtsState = {
    workKey: string;
    text: string;
    // 最後に読み込んだ・保存した内容 (変更があるかの判定に使う)
    savedText: string;
    inputKind: TtsInputKind;
    filePath: string | null;
    language: VoiceLanguage | null;
    engine: TtsEngineId | null;
    voiceId: string;
    params: TtsParams;
    readSymbols: boolean;
    overflowMode: TimelineOverflowMode;
    cueOverflowModes: Record<number, TimelineOverflowMode>;
    candidates: TtsCandidate[];
    selectedId: string | null;
    setText(text: string): void;
    loadDocument(text: string, kind: TtsInputKind, filePath: string | null): void;
    markSaved(filePath: string): void;
    setInputKind(kind: TtsInputKind): void;
    setLanguage(language: VoiceLanguage): void;
    setEngine(engine: TtsEngineId | null): void;
    setVoiceId(id: string): void;
    setParams(params: TtsParams): void;
    setReadSymbols(value: boolean): void;
    setOverflowMode(mode: TimelineOverflowMode): void;
    setCueOverflowModes(modes: Record<number, TimelineOverflowMode>): void;
    addCandidate(candidate: TtsCandidate): void;
    removeCandidate(id: string): void;
    select(id: string | null): void;
};

export const useTtsStore = create<TtsState>((set, get) => ({
    workKey: newWorkKey('tts'),
    text: '',
    savedText: '',
    inputKind: 'text',
    filePath: null,
    language: null,
    engine: null,
    voiceId: '',
    params: DEFAULT_TTS_PARAMS,
    readSymbols: false,
    overflowMode: 'speedup',
    cueOverflowModes: {},
    candidates: [],
    selectedId: null,
    setText(text) {
        set({ text });
    },
    loadDocument(text, inputKind, filePath) {
        set({ text, savedText: text, inputKind, filePath, cueOverflowModes: {} });
    },
    markSaved(filePath) {
        set({ filePath, savedText: get().text });
    },
    setInputKind(inputKind) {
        set({ inputKind });
    },
    setLanguage(language) {
        set({ language });
    },
    setEngine(engine) {
        set({ engine });
    },
    setVoiceId(voiceId) {
        set({ voiceId });
    },
    setParams(params) {
        set({ params });
    },
    setReadSymbols(readSymbols) {
        set({ readSymbols });
    },
    setOverflowMode(overflowMode) {
        set({ overflowMode });
    },
    setCueOverflowModes(cueOverflowModes) {
        set({ cueOverflowModes });
    },
    addCandidate(candidate) {
        set({ candidates: [...get().candidates, candidate], selectedId: candidate.id });
    },
    removeCandidate(id) {
        const candidates = get().candidates.filter(item => item.id !== id);
        set({
            candidates,
            selectedId: get().selectedId === id ? (candidates[candidates.length - 1]?.id ?? null) : get().selectedId,
        });
    },
    select(selectedId) {
        set({ selectedId });
    },
}));
