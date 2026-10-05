import { create } from 'zustand';
import { useConversionSeparationStore } from './separationWorkStore';
import type { MediaRef } from '@shared/voice/types';

// 機能間の結果の受け渡し (分離から変換へ、読み上げから変換へ)。受け取る側の画面が取り出したら消す。
// 渡す音声は、渡す時点で変換の画面の作業の置き場へ移す (渡した元の機能の作業は、別の機能へ移ったときに消えるため)

export type VoiceHandoff = {
    from: 'separation' | 'tts';
    // 表示名と、書き出し時のファイル名の元
    name: string;
    sourcePath: string;
    // 元の音源 (変換の画面の作業の置き場にある、再生できるもの)
    sourceMedia: MediaRef;
    // ボーカル (重ねて 1 つにするもの)
    vocals: string[];
    // 伴奏 (重ねて 1 つにするもの)。読み上げや伴奏の無い入力では空
    accompaniment: string[];
    channels: number;
};

type HandoffState = {
    handoff: VoiceHandoff | null;
    take(): VoiceHandoff | null;
};

export const useVoiceHandoffStore = create<HandoffState>((set, get) => ({
    handoff: null,
    take() {
        const handoff = get().handoff;
        set({ handoff: null });
        return handoff;
    },
}));

// 変換の画面へ渡す。渡す音声 (元の音源・ボーカル・伴奏) を、送り元の作業から変換の画面の作業の置き場へ移してから渡す
export async function sendToConversion(fromWorkKey: string, handoff: VoiceHandoff): Promise<void> {
    const toWorkKey = useConversionSeparationStore.getState().workKey;
    const paths = [handoff.sourceMedia.path, ...handoff.vocals, ...handoff.accompaniment];
    const moved = await window.kuraToolkit.voice.media.transfer(fromWorkKey, toWorkKey, paths);
    const vocalsEnd = 1 + handoff.vocals.length;
    useVoiceHandoffStore.setState({
        handoff: {
            ...handoff,
            sourceMedia: moved[0],
            vocals: moved.slice(1, vocalsEnd).map(media => media.path),
            accompaniment: moved.slice(vocalsEnd).map(media => media.path),
        },
    });
}
