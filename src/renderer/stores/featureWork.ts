import { useAudioStore } from './audioStore';
import { useChapterStore } from './chapterStore';
import { useConversionStore } from './conversionStore';
import { useConversionSeparationStore, useSeparationWorkStore } from './separationWorkStore';
import { useSvgAutoStore } from './svgAutoStore';
import { timedSnapshot, useTtsStore } from './ttsStore';
import { useVectorizerStore } from './vectorizerStore';

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
    // 音量の正規化・チャプターカットは、選んだファイルと結果・設定を初めの状態に戻す (一時ファイルは処理ごとに片付く)
    'audio/normalizer': () => {
        useAudioStore.getState().clearFiles();
    },
    'video/chapter-cut': () => {
        useChapterStore.getState().reset();
    },
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
    // SVG 変換・SVG 自動変換は、画像・変換結果・設定のすべてを初めの状態に戻す
    'image/svg-converter': () => {
        void window.kuraToolkit.vectorizer.discard();
        useVectorizerStore.getState().reset();
    },
    'image/svg-auto': () => {
        useSvgAutoStore.getState().reset();
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

function normalUnsaved(): boolean {
    const tts = useTtsStore.getState();
    return tts.normal.text !== tts.normal.savedText;
}

function timedUnsaved(): boolean {
    const tts = useTtsStore.getState();
    return timedSnapshot(tts.timed.rows) !== tts.timed.savedSnapshot;
}

const UNSAVED_INPUTS: Record<string, UnsavedInput> = {
    // 読み上げの文章 (通常の入力とタイミング指定のどちらか、または両方)
    'audio/tts': {
        hasUnsaved() {
            return normalUnsaved() || timedUnsaved();
        },
        // 保存していない変更だけを破棄する (最後に読み込んだ・保存した内容に戻す。保存済みの方の文章はそのまま残す)
        discard() {
            const tts = useTtsStore.getState();
            if (normalUnsaved()) tts.revertNormal();
            if (timedUnsaved()) tts.revertTimed();
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
