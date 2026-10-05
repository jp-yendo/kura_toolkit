import { useConversionStore } from './conversionStore';
import { useConversionSeparationStore, useSeparationWorkStore } from './separationWorkStore';
import { useTtsStore } from './ttsStore';

// メニューの機能ごとの作業。同じ機能の中 (機能のタブの移動など) では作業を残し、別の機能へ移ったときに、
// 前の機能の作業 (作業ディレクトリに置いた入力・候補など) を破棄する

// 機能 (パスの先頭 2 階層。/audio/conversion/models は /audio/conversion の機能の中)
export function featureOf(pathname: string): string {
    return pathname.split('/').filter(Boolean).slice(0, 2).join('/');
}

function discardWork(workKey: string): void {
    void window.kuraToolkit.voice.media.discardWork(workKey);
}

// 作業を持つ機能の、作業の破棄
const LEAVE_HANDLERS: Record<string, () => void> = {
    'audio/separation': () => {
        const separation = useSeparationWorkStore.getState();
        discardWork(separation.workKey);
        separation.reset();
    },
    'audio/conversion': () => {
        const separation = useConversionSeparationStore.getState();
        discardWork(separation.workKey);
        separation.reset();
        useConversionStore.getState().reset();
    },
    'audio/tts': () => {
        const tts = useTtsStore.getState();
        discardWork(tts.workKey);
        tts.clearWork();
    },
};

// 機能から離れる (その機能の作業を破棄する)
export function leaveFeature(feature: string): void {
    LEAVE_HANDLERS[feature]?.();
}
