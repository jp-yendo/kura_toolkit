import React from 'react';
import { create } from 'zustand';
import type { VoicePlatformInfo } from '@shared/voice/types';
import { useSettingsStore } from './settingsStore';

// 音声機能を動かす環境 (OS・CPU)。ナビゲーションのメニューとダッシュボードで、その環境で使えない機能を示すのに使う。
// アプリの起動中に変わらないため、最初に使うときに 1 回だけ取得する。
// 機能ごと・処理ごとに使えなくなるのは macOS (PyTorch の配布物が無い Intel 版 Mac・macOS 13 以前) だけなので、
// ほかの OS では取得しない (どの機能も使える扱いのまま)

type VoicePlatformState = {
    platform: VoicePlatformInfo | null;
    load(): void;
};

let requested = false;

export const useVoicePlatformStore = create<VoicePlatformState>(set => ({
    platform: null,
    load() {
        if (requested) return;
        requested = true;
        window.kuraToolkit.voice.library.getStatus().then(
            status => set({ platform: status.platform }),
            error => {
                // 取得できなかった場合は、次に使うときに取得し直す (取得できるまでは、どの機能も使える扱いで示す)
                requested = false;
                console.warn('failed to read the voice platform', error);
            }
        );
    },
}));

// 音声機能を動かす環境 (取得できるまでは null)
export function useVoicePlatform(): VoicePlatformInfo | null {
    const platform = useVoicePlatformStore(state => state.platform);
    const load = useVoicePlatformStore(state => state.load);
    const os = useSettingsStore(state => state.appInfo?.os);
    React.useEffect(() => {
        if (os === 'darwin') load();
    }, [os, load]);
    return platform;
}

// 分離のモデル (PyTorch を使う処理) を使えない理由の翻訳キー (使える場合と、環境がまだ分からない場合は null)
export function useSeparationModelsUnavailableKey(): string | null {
    const platform = useVoicePlatform();
    if (!platform?.supported || !platform.torchUnavailableReason) return null;
    return `voice.platform.modelsUnavailable.${platform.torchUnavailableReason}`;
}
