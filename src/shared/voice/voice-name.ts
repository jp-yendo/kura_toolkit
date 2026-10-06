import type { VoiceModelInfo } from './types';

// 声のモデルの表示名 (一覧・選択欄・書き出しのファイル名で同じ名前を使う)
export function voiceDisplayName(voice: Pick<VoiceModelInfo, 'id' | 'name' | 'distributedName'>): string {
    if (voice.name) return voice.name;
    // 名前を付けていないダウンロードしたモデルは、配布時の名前で表示する (ほかのモデルと同じく名前だけを示す)
    if (voice.distributedName) return voice.distributedName.replace(/-jp$/, '');
    return voice.id;
}
