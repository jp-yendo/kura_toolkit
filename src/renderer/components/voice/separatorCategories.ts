import type { SeparationCategory } from '@shared/voice/types';

// 分離モデルのまとまり (分離の種類) の並びと、まとまりの中の並び。ダウンロード画面と分離の画面で同じものを使う

export const SEPARATION_CATEGORIES: SeparationCategory[] = ['vocals', 'multi', 'karaoke', 'cleanup', 'other'];

// 分離の品質 (出力のうち最も高い値)
function bestQuality(sdr: Record<string, number | null> | undefined): number {
    const values = Object.values(sdr ?? {}).filter((value): value is number => value !== null);
    return values.length > 0 ? Math.max(...values) : -Infinity;
}

// 並べる順: 分離の品質が高いモデル、名前の順
export function compareSeparatorModels(
    a: { name: string; sdr?: Record<string, number | null> },
    b: { name: string; sdr?: Record<string, number | null> }
): number {
    const qualityOrder = bestQuality(b.sdr) - bestQuality(a.sdr);
    if (qualityOrder !== 0 && !Number.isNaN(qualityOrder)) return qualityOrder;
    return a.name.localeCompare(b.name);
}
