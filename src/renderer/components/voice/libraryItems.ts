import type { TFunction } from 'i18next';
import type { LibraryItem } from '@shared/voice/types';

// ダウンロード項目の表示名
export function itemLabel(t: TFunction, item: LibraryItem): string {
    if (item.nameKey) return t(item.nameKey);
    return item.name ?? item.id;
}

// 選んだ項目に、まだ取得していない前提項目を足す (main 側の取得順の決め方と同じ)。
// 取得できない項目 (この環境で使えないもの) と取得済みの項目は除く
export function withPrerequisites(ids: string[], items: LibraryItem[]): string[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const result = new Set<string>();
    const visit = (id: string) => {
        const item = byId.get(id);
        if (!item || result.has(id) || !item.available || item.status === 'installed') return;
        for (const required of item.requires) visit(required);
        result.add(id);
    };
    ids.forEach(visit);
    return [...result];
}

// 取得する項目の合計の大きさ (大きさが分からない項目は数えない)
export function totalSize(ids: string[], items: LibraryItem[]): number {
    const byId = new Map(items.map(item => [item.id, item]));
    return ids.reduce((sum, id) => sum + (byId.get(id)?.sizeBytes ?? 0), 0);
}
