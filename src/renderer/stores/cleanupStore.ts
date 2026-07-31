import { create } from 'zustand';
import type { CleanupItem, CleanupTargetId } from '@shared/types';

type CleanupState = {
    selectedTargets: CleanupTargetId[];
    selectedRoots: string[];
    items: CleanupItem[];
    checked: string[];
    // 保存済みの検索条件を復元済みかどうか (起動後 1 回だけ復元する)
    restored: boolean;
    toggleTarget(id: CleanupTargetId): void;
    setAllTargets(ids: CleanupTargetId[]): void;
    toggleRoot(path: string): void;
    setAllRoots(paths: string[]): void;
    setItems(items: CleanupItem[]): void;
    toggleChecked(path: string): void;
    setChecked(paths: string[]): void;
    restore(targets: CleanupTargetId[], roots: string[]): void;
    pruneRoots(availablePaths: string[]): void;
};

function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

export const useCleanupStore = create<CleanupState>((set, get) => ({
    selectedTargets: [],
    selectedRoots: [],
    items: [],
    checked: [],
    restored: false,
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
    restore(targets, roots) {
        // 起動後の最初の 1 回だけ適用する (画面を行き来しても選択が巻き戻らないようにする)
        if (get().restored) return;
        set({ selectedTargets: targets, selectedRoots: roots, restored: true });
    },
    pruneRoots(availablePaths) {
        // 取り外したドライブなど、現在は存在しない検索対象を選択から外す
        const current = get().selectedRoots;
        const next = current.filter(path => availablePaths.includes(path));
        if (next.length !== current.length) {
            set({ selectedRoots: next });
        }
    },
}));
