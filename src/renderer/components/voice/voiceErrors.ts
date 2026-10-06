import type { TFunction } from 'i18next';
import { errorMessage, parseError } from '../common/errorMessage';

// main / Python から届くエラーコード (「CODE: 詳細」) を利用者向けの文言にする (音声機能のエラーの翻訳を使う)。
// 翻訳の無いエラーは、表示言語の「失敗しました」の文に詳細として添える

export const parseVoiceError = parseError;

export function isCancelledError(error: unknown): boolean {
    return parseVoiceError(error).code === 'KURA_CANCELLED';
}

export function voiceErrorMessage(t: TFunction, error: unknown): string {
    return errorMessage(t, error, ['voice.errors']);
}

// 「MODEL_REQUIRED: 項目 ID, 項目 ID」から、ダウンロードが必要な項目を取り出す
export function missingItemsFromError(error: unknown): string[] {
    const parsed = parseVoiceError(error);
    if (parsed.code !== 'MODEL_REQUIRED' && parsed.code !== 'MODEL_NOT_INSTALLED') return [];
    return parsed.detail
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}
