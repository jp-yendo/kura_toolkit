import { create } from 'zustand';
import type { ChapterProbeResult } from '@shared/types';

export type ChapterMode = 'cut' | 'split';

type ChapterState = {
    input: string | null;
    probe: ChapterProbeResult | null;
    mode: ChapterMode;
    fromIndex: number;
    // -1 = 最終チャプターまで
    toIndex: number;
    boundaries: number[];
    // 切り出しモードの出力ファイルパス (空文字 = チャプター名から自動生成)
    outputPath: string;
    logs: string[];
    setInput(input: string | null, probe: ChapterProbeResult | null): void;
    setOutputPath(outputPath: string): void;
    setMode(mode: ChapterMode): void;
    setFromIndex(index: number): void;
    setToIndex(index: number): void;
    toggleBoundary(index: number): void;
    appendLog(line: string): void;
    clearLogs(): void;
};

export const useChapterStore = create<ChapterState>((set, get) => ({
    input: null,
    probe: null,
    mode: 'cut',
    fromIndex: 0,
    toIndex: -1,
    boundaries: [],
    outputPath: '',
    logs: [],
    setInput(input, probe) {
        set({ input, probe, fromIndex: 0, toIndex: -1, boundaries: [], outputPath: '', logs: [] });
    },
    setOutputPath(outputPath) {
        set({ outputPath });
    },
    setMode(mode) {
        set({ mode });
    },
    setFromIndex(index) {
        set({ fromIndex: index });
    },
    setToIndex(index) {
        set({ toIndex: index });
    },
    toggleBoundary(index) {
        const current = get().boundaries;
        set({
            boundaries: current.includes(index)
                ? current.filter(value => value !== index)
                : [...current, index].sort((a, b) => a - b),
        });
    },
    appendLog(line) {
        set({ logs: [...get().logs, line] });
    },
    clearLogs() {
        set({ logs: [] });
    },
}));
