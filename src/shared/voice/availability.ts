import type { VoiceFeatureId, VoicePlatformInfo } from './types';

// 音声機能を、その環境で使えるか (ライブラリの配布物の有無による。ダウンロードの状況は含めない)。
// main は機能を使えるかの判定に、renderer はナビゲーション・ダウンロードの画面の表示に使う

// 分離のモデル (PyTorch を使う処理) を使えるか
export function separationModelsAvailable(platform: VoicePlatformInfo): boolean {
    return platform.supported && !platform.torchUnavailableReason;
}

// 機能を使えるか。分離・加工は PyTorch を使えなくても、モデルを使わない処理を使える
export function isFeatureAvailable(platform: VoicePlatformInfo, feature: VoiceFeatureId): boolean {
    if (!platform.supported) return false;
    if (feature === 'separation') return true;
    if (platform.torchUnavailableReason) return false;
    if (feature === 'ttsTraining') return platform.ttsTrainingAvailable;
    return true;
}

// 機能を使えない理由の翻訳キー (使える場合は null)
export function featureUnavailableReasonKey(platform: VoicePlatformInfo, feature: VoiceFeatureId): string | null {
    if (!platform.supported) return `voice.platform.unsupported.${platform.unsupportedReason ?? 'os'}`;
    if (feature === 'separation') return null;
    if (platform.torchUnavailableReason) return `voice.platform.torchUnavailable.${platform.torchUnavailableReason}`;
    if (feature === 'ttsTraining' && !platform.ttsTrainingAvailable) return 'voice.library.ttsTrainingUnavailable';
    return null;
}

// その環境で確実に使えない機能か (ダウンロードの画面で、その機能のタブと項目を出さない)。
// PyTorch の配布物が無い環境の、PyTorch を使う機能だけが当てはまる
export function isFeatureHidden(platform: VoicePlatformInfo, feature: VoiceFeatureId): boolean {
    return platform.supported && !!platform.torchUnavailableReason && feature !== 'separation';
}
