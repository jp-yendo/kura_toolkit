import { create } from 'zustand';
import type { AudioAnalyzeItem, AudioNormalizeItem, AudioProbeItem } from '@shared/types';

export type AudioEntry = {
    path: string;
    // 長さ (秒) とチャンネル数は一覧に加えたときに調べる。ラウドネス (LUFS) と True Peak は解析で求める
    // (解析していないファイルは正規化の中で測る。正規化で使う)
    durationSec: number | null;
    channels: number | null;
    lufs: number | null;
    truePeak: number | null;
    error?: string;
};

type AudioState = {
    files: AudioEntry[];
    // 一覧に加え、加えたファイルを返す (既にあるものは加えない)
    addFiles(paths: string[]): string[];
    applyProbe(items: AudioProbeItem[]): void;
    clearFiles(): void;
    applyAnalysis(items: AudioAnalyzeItem[]): void;
    // 正規化の結果を反映する (正規化の中で測った実測値を入れ、入力を置き換えたファイルは実測値を消す)
    applyNormalize(items: AudioNormalizeItem[]): void;
};

export const useAudioStore = create<AudioState>((set, get) => ({
    files: [],
    addFiles(paths) {
        const existing = new Set(get().files.map(file => file.path));
        const added = paths
            .filter(filePath => !existing.has(filePath))
            .map(filePath => ({ path: filePath, durationSec: null, channels: null, lufs: null, truePeak: null }));
        if (added.length > 0) {
            set({ files: [...get().files, ...added] });
        }
        return added.map(file => file.path);
    },
    applyProbe(items) {
        const byPath = new Map(items.map(item => [item.path, item]));
        set({
            files: get().files.map(file => {
                const item = byPath.get(file.path);
                return item ? { ...file, durationSec: item.durationSec, channels: item.channels } : file;
            }),
        });
    },
    clearFiles() {
        set({ files: [] });
    },
    applyAnalysis(items) {
        const byPath = new Map(items.map(item => [item.path, item]));
        set({
            files: get().files.map(file => {
                const item = byPath.get(file.path);
                if (!item) return file;
                return {
                    ...file,
                    channels: item.channels,
                    lufs: item.lufs,
                    truePeak: item.truePeak,
                    error: item.error,
                };
            }),
        });
    },
    applyNormalize(items) {
        const byPath = new Map(items.map(item => [item.path, item]));
        set({
            files: get().files.map(file => {
                const item = byPath.get(file.path);
                if (!item) return file;
                // 元のファイルを上書きした場合は、測った値は前のファイルのものになるため消す (次の正規化で測り直す)
                if (item.inputReplaced) return { ...file, lufs: null, truePeak: null };
                if (item.lufs !== undefined) return { ...file, lufs: item.lufs, truePeak: item.truePeak ?? null };
                return file;
            }),
        });
    },
}));
