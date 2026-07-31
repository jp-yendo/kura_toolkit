import { create } from 'zustand';
import type { CleanupItem, CleanupTargetId } from '@shared/types';

type CleanupState = {
    selectedTargets: CleanupTargetId[];
    selectedRoots: string[];
    items: CleanupItem[];
    checked: string[];
    toggleTarget(id: CleanupTargetId): void;
    setAllTargets(ids: CleanupTargetId[]): void;
    toggleRoot(path: string): void;
    setAllRoots(paths: string[]): void;
    setItems(items: CleanupItem[]): void;
    toggleChecked(path: string): void;
    setChecked(paths: string[]): void;
};

function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

export const useCleanupStore = create<CleanupState>((set, get) => ({
    selectedTargets: [],
    selectedRoots: [],
    items: [],
    checked: [],
    toggleTarget(id) {
        set({ selectedTargets: toggle(get().selectedTargets, id) });
    },
    setAllTargets(ids) {
        set({ selectedTargets: ids });
    },
    toggleRoot(path) {
        set({ selectedRoots: toggle(get().selectedRoots, path) });
    },
    setAllRoots(paths) {
        set({ selectedRoots: paths });
    },
    setItems(items) {
        set({ items, checked: [] });
    },
    toggleChecked(path) {
        set({ checked: toggle(get().checked, path) });
    },
    setChecked(paths) {
        set({ checked: paths });
    },
}));
