import { create } from 'zustand';
import type { AppInfo, AppSettings, DeepPartial } from '@shared/types';

type SettingsState = {
    settings: AppSettings | null;
    appInfo: AppInfo | null;
    initialized: boolean;
    // 設定ファイルへの保存に失敗した場合の理由 (通知後に clearSaveError で消す)
    saveError: string | null;
    init(): Promise<void>;
    update(patch: DeepPartial<AppSettings>): Promise<void>;
    clearSaveError(): void;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
    settings: null,
    appInfo: null,
    initialized: false,
    saveError: null,
    async init() {
        if (get().initialized) return;
        const [settings, appInfo] = await Promise.all([
            window.kuraToolkit.settings.get(),
            window.kuraToolkit.getAppInfo(),
        ]);
        set({ settings, appInfo, initialized: true });
    },
    async update(patch) {
        const result = await window.kuraToolkit.settings.update(patch);
        set({ settings: result.settings, saveError: result.saveError });
    },
    clearSaveError() {
        set({ saveError: null });
    },
}));
