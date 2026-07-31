import { create } from 'zustand';

export type NoticeSeverity = 'success' | 'info' | 'warning' | 'error';

export type Notice = {
    severity: NoticeSeverity;
    message: string;
    // 自動で閉じるまでの時間 (ミリ秒)
    autoHideDuration: number;
};

type NoticeState = {
    notice: Notice | null;
    show(severity: NoticeSeverity, message: string, autoHideDuration?: number): void;
    clear(): void;
};

// 画面をまたいで共有する一時通知。表示は NotificationArea が 1 か所で行うため、
// アップデート通知と重ならない。
export const useNoticeStore = create<NoticeState>(set => ({
    notice: null,
    show(severity, message, autoHideDuration = 6000) {
        set({ notice: { severity, message, autoHideDuration } });
    },
    clear() {
        set({ notice: null });
    },
}));

// コンポーネント外からも呼べるようにした簡易ヘルパー
export function showNotice(severity: NoticeSeverity, message: string, autoHideDuration?: number): void {
    useNoticeStore.getState().show(severity, message, autoHideDuration);
}
