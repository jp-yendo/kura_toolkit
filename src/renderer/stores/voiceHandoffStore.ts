import { create } from 'zustand';
import type { MediaRef } from '@shared/voice/types';

// 機能間の結果の受け渡し (分離から変換へ、読み上げから変換へ)。同じ作業 (アプリの起動中) の中に限る。
// 受け取る側の画面が取り出したら消す。

export type VoiceHandoff = {
    from: 'separation' | 'tts';
    // 表示名と、書き出し時のファイル名の元
    name: string;
    sourcePath: string;
    // 元の音源 (作業ディレクトリ内の再生できるもの)
    sourceMedia: MediaRef;
    vocals: string;
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
