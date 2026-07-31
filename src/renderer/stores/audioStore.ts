import { create } from 'zustand';
import type { AudioAnalyzeItem } from '@shared/types';

export type AudioEntry = {
    path: string;
    channels: number | null;
    lufs: number | null;
    error?: string;
};

type AudioState = {
    files: AudioEntry[];
    addFiles(paths: string[]): void;
    clearFiles(): void;
    applyAnalysis(items: AudioAnalyzeItem[]): void;
};

export const useAudioStore = create<AudioState>((set, get) => ({
    files: [],
    addFiles(paths) {
        const existing = new Set(get().files.map(file => file.path));
        const added = paths
            .filter(filePath => !existing.has(filePath))
            .map(filePath => ({ path: filePath, channels: null, lufs: null }));
        if (added.length > 0) {
            set({ files: [...get().files, ...added] });
        }
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
                return { ...file, channels: item.channels, lufs: item.lufs, error: item.error };
            }),
        });
    },
}));
