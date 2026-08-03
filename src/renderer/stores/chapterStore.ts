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
    // 切り出しモードの出力ファイル名 (空文字 = チャプター名から自動生成)。
    // ディレクトリは含まず、出力先は outputDir が決める
    outputName: string;
    // 出力設定。設定ファイルには保存しないため、起動のたびに既定値へ戻る
    // (空文字 = 入力と同じディレクトリ)
    outputDir: string;
    accurate: boolean;
    logs: string[];
    setInput(input: string | null, probe: ChapterProbeResult | null): void;
    setOutputName(outputName: string): void;
    setOutputDir(outputDir: string): void;
    setAccurate(accurate: boolean): void;
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
    outputName: '',
    outputDir: '',
    accurate: false,
    logs: [],
    setInput(input, probe) {
        // 出力先ディレクトリと accurate はファイルを変えても引き継ぐ (出力ファイル名のみ入力ごとに破棄)
        set({ input, probe, fromIndex: 0, toIndex: -1, boundaries: [], outputName: '', logs: [] });
    },
    setOutputName(outputName) {
        set({ outputName });
    },
    setOutputDir(outputDir) {
        set({ outputDir });
    },
    setAccurate(accurate) {
        set({ accurate });
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
