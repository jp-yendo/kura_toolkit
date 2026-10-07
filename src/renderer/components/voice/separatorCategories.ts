import type { SeparationCategory } from '@shared/voice/types';

// 分離モデルのまとまり (分離の種類) の並びと、まとまりの中の並び。ダウンロード画面と分離の画面で同じものを使う

export const SEPARATION_CATEGORIES: SeparationCategory[] = [
    'vocals',
    'multi',
    'karaoke',
    'denoise',
    'dereverb',
    'other',
];

// 並べる順: 名前の順
export function compareSeparatorModels(a: { name: string }, b: { name: string }): number {
    return a.name.localeCompare(b.name);
}
