import { useConversionStore } from './conversionStore';
import { useConversionSeparationStore, useSeparationWorkStore } from './separationWorkStore';
import { timedSnapshot, useTtsStore } from './ttsStore';

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

// 保存していない入力を持つ機能の、入力の有無と破棄 (別の機能へ移る前に確認するため)
type UnsavedInput = {
    hasUnsaved(): boolean;
    discard(): void;
};

const UNSAVED_INPUTS: Record<string, UnsavedInput> = {
    // 読み上げの文章 (通常の入力とタイミング指定のどちらか、または両方)
    'audio/tts': {
        hasUnsaved() {
            const tts = useTtsStore.getState();
            return (
                tts.normal.text !== tts.normal.savedText || timedSnapshot(tts.timed.rows) !== tts.timed.savedSnapshot
            );
        },
        discard() {
            const tts = useTtsStore.getState();
            tts.loadNormal('', null);
            tts.loadTimed([], null, true);
        },
    },
};

export function unsavedInputOf(feature: string): UnsavedInput | undefined {
    return UNSAVED_INPUTS[feature];
}

// どれかの機能に保存していない入力があるか (アプリを閉じる前の確認に使う)
export function hasAnyUnsavedInput(): boolean {
    return Object.values(UNSAVED_INPUTS).some(input => input.hasUnsaved());
}
