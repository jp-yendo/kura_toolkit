import { create } from 'zustand';
import type { LibraryItemGroup } from '@shared/voice/types';

// 音声機能のダウンロード (Python 本体・パッケージ一式・モデル) のダイアログ。
// 必要になった箇所 (各機能の画面・不足の案内・ライブラリディレクトリの移動後) から呼び出す。

type VoiceLibraryOptions = {
    // 選んだ状態で開く項目 (不足している項目など)
    select?: string[];
    // 開いたときに表示する区分
    focus?: LibraryItemGroup;
};

type VoiceLibraryState = {
    open: boolean;
    select: string[];
    focus: LibraryItemGroup | null;
    // ダウンロード・削除・ライブラリの移動で中身が変わるたびに増える。
    // 取得状況を表示している画面は、この値が変わったら読み直す
    version: number;
    show(options?: VoiceLibraryOptions): void;
    close(): void;
    changed(): void;
};

export const useVoiceLibraryStore = create<VoiceLibraryState>(set => ({
    open: false,
    select: [],
    focus: null,
    version: 0,
    show(options = {}) {
        set({ open: true, select: options.select ?? [], focus: options.focus ?? null });
    },
    close() {
        set({ open: false });
    },
    changed() {
        set(state => ({ version: state.version + 1 }));
    },
}));

export function openVoiceLibrary(options?: VoiceLibraryOptions): void {
    useVoiceLibraryStore.getState().show(options);
}

export function notifyVoiceLibraryChanged(): void {
    useVoiceLibraryStore.getState().changed();
}
