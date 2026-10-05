import { create } from 'zustand';
import { useConversionStore } from './conversionStore';
import type { MediaRef } from '@shared/voice/types';

// 機能間の結果の受け渡し (分離から変換へ、読み上げから変換へ)。同じ作業 (アプリの起動中) の中に限る。
// 受け取る側の画面が取り出したら消す。

export type VoiceHandoff = {
    from: 'separation' | 'tts';
    // 渡したファイルがある、送り元の作業
    workKey: string;
    // 表示名と、書き出し時のファイル名の元
    name: string;
    sourcePath: string;
    // 元の音源 (作業ディレクトリ内の再生できるもの)
    sourceMedia: MediaRef;
    // ボーカル (重ねて 1 つにするもの)
    vocals: string[];
    // 伴奏 (重ねて 1 つにするもの)。読み上げや伴奏の無い入力では空
    accompaniment: string[];
    channels: number;
};

type HandoffState = {
    handoff: VoiceHandoff | null;
    send(handoff: VoiceHandoff): void;
    take(): VoiceHandoff | null;
};

export const useVoiceHandoffStore = create<HandoffState>((set, get) => ({
    handoff: null,
    send(handoff) {
        set({ handoff });
    },
    take() {
        const handoff = get().handoff;
        set({ handoff: null });
        return handoff;
    },
}));

// 渡した音声 (受け取り前のものと、変換の画面が入力にしているもの)
function activeHandoffs(): VoiceHandoff[] {
    return [useVoiceHandoffStore.getState().handoff, useConversionStore.getState().external].filter(
        (item): item is VoiceHandoff => item !== null
    );
}

function usedPaths(): Set<string> {
    return new Set(activeHandoffs().flatMap(item => [item.sourceMedia.path, ...item.vocals, ...item.accompaniment]));
}

// 送り元の画面で破棄したが、渡した音声が使っているため消さずにいる作業とファイル。
// 渡した音声を使い終わった時点 (変換の画面が別の入力に変えた・作業を破棄したなど) で消す
const deferredWorks = new Set<string>();
const deferredPaths = new Set<string>();

function releaseDeferred(): void {
    const handoffs = activeHandoffs();
    for (const workKey of [...deferredWorks]) {
        if (handoffs.some(item => item.workKey === workKey)) continue;
        deferredWorks.delete(workKey);
        void window.kuraToolkit.voice.media.discardWork(workKey);
    }
    const used = usedPaths();
    const released = [...deferredPaths].filter(item => !used.has(item));
    if (released.length === 0) return;
    for (const item of released) deferredPaths.delete(item);
    void window.kuraToolkit.voice.media.discard(released);
}

useVoiceHandoffStore.subscribe(releaseDeferred);
useConversionStore.subscribe(releaseDeferred);

// 作業を破棄する。渡した音声が使っている間は残し、使い終わった時点で消す
export function discardWorkAfterHandoff(workKey: string): void {
    deferredWorks.add(workKey);
    releaseDeferred();
}

// ファイルを破棄する。渡した音声が使っているものは残し、使い終わった時点で消す
export function discardPathsAfterHandoff(paths: string[]): void {
    for (const item of paths) deferredPaths.add(item);
    releaseDeferred();
}
