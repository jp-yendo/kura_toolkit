import { create } from 'zustand';
import type { AppInfo, AppSettings, DeepPartial, SettingsLoadError } from '@shared/types';

type SettingsState = {
    settings: AppSettings | null;
    appInfo: AppInfo | null;
    initialized: boolean;
    // 設定ファイルを読み込めなかった場合の内容。利用者が既定の設定で続けるまで、ほかの画面を出さない
    loadError: SettingsLoadError | null;
    // 設定ファイルへの保存に失敗した場合の理由 (通知後に clearSaveError で消す)
    saveError: string | null;
    init(): Promise<void>;
    // 読み込めなかった設定ファイルを別の名前で残し、既定の設定で続ける。残した場所を返す
    resetBroken(): Promise<string>;
    // main 側で設定が書き換わった場合 (ライブラリディレクトリの移動など) に読み直す
    reload(): Promise<void>;
    update(patch: DeepPartial<AppSettings>): Promise<void>;
    clearSaveError(): void;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
    settings: null,
    appInfo: null,
    initialized: false,
    loadError: null,
    saveError: null,
    async init() {
        if (get().initialized) return;
        const [settings, appInfo, loadError] = await Promise.all([
            window.kuraToolkit.settings.get(),
            window.kuraToolkit.getAppInfo(),
            window.kuraToolkit.settings.getLoadError(),
        ]);
        set({ settings, appInfo, loadError, initialized: true });
    },
    async resetBroken() {
        const kept = await window.kuraToolkit.settings.resetBroken();
        set({ settings: await window.kuraToolkit.settings.get(), loadError: null });
        return kept;
    },
    async reload() {
        set({ settings: await window.kuraToolkit.settings.get() });
    },
    async update(patch) {
        const result = await window.kuraToolkit.settings.update(patch);
        set({ settings: result.settings, saveError: result.saveError });
    },
    clearSaveError() {
        set({ saveError: null });
    },
}));
