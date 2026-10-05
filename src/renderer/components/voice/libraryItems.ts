import type { TFunction } from 'i18next';
import {
    FEATURE_REQUIREMENTS,
    TTS_READY_PREFIX,
    type RequirementGroup,
    type RequirementNode,
} from '@shared/voice/requirements';
import type { LibraryItem, VoiceFeatureId } from '@shared/voice/types';

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

// ダウンロードの画面に並べる機能の順
export const VOICE_FEATURES: VoiceFeatureId[] = [
    'separation',
    'conversion',
    'conversionTraining',
    'tts',
    'ttsTraining',
];

// 機能の一覧の 1 行 (階層の深さと、その項目が必要になる条件、一覧の上位に無い前提項目を持つ)
export type RequirementRow = {
    // 表の中で行を区別する鍵 (同じ項目が複数の親の下に出ることがあるため、親からの経路で作る)
    key: string;
    item: LibraryItem;
    depth: number;
    conditionKey?: string;
    prerequisites: LibraryItem[];
};

// 機能の必要な項目のまとまりを、表示する行に展開する。前提項目のうち、階層の上位に置いたもの以外を
// prerequisites に入れる (前提項目はダウンロード時に自動で一緒に取得する)
export function requirementRows(group: RequirementGroup, items: LibraryItem[]): RequirementRow[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const rows: RequirementRow[] = [];
    const visit = (node: RequirementNode, ancestors: string[]) => {
        const item = byId.get(node.item);
        if (!item) return;
        const prerequisites = item.requires
            .filter(id => !ancestors.includes(id))
            .map(id => byId.get(id))
            .filter((entry): entry is LibraryItem => !!entry);
        const path = [...ancestors, node.item];
        rows.push({
            key: path.join('>'),
            item,
            depth: ancestors.length,
            conditionKey: node.conditionKey,
            prerequisites,
        });
        node.children?.forEach(child => visit(child, path));
        const language = node.readyModelsFor;
        if (language) {
            items
                .filter(entry => entry.id.startsWith(TTS_READY_PREFIX) && entry.readsLanguages?.includes(language))
                .forEach(entry =>
                    visit({ item: entry.id, conditionKey: 'voice.library.requirements.readyModelOption' }, path)
                );
        }
    };
    if (group.nodes) group.nodes.forEach(node => visit(node, []));
    if (group.itemPrefix) {
        const prefix = group.itemPrefix;
        items.filter(item => item.id.startsWith(prefix)).forEach(item => visit({ item: item.id }, []));
    }
    return rows;
}

// 機能の一覧に項目が含まれるか
function featureContains(feature: VoiceFeatureId, id: string): boolean {
    const inNodes = (nodes: RequirementNode[] | undefined): boolean =>
        !!nodes?.some(
            node =>
                node.item === id ||
                inNodes(node.children) ||
                (node.readyModelsFor !== undefined && id.startsWith(TTS_READY_PREFIX))
        );
    return FEATURE_REQUIREMENTS[feature].some(
        group => inNodes(group.nodes) || (!!group.itemPrefix && id.startsWith(group.itemPrefix))
    );
}

// 選んだ状態で開く項目を最も多く含む機能 (同数なら一覧の順で先のもの)
export function featureForItems(ids: string[]): VoiceFeatureId {
    let best: VoiceFeatureId = VOICE_FEATURES[0];
    let bestCount = 0;
    for (const feature of VOICE_FEATURES) {
        const count = ids.filter(id => featureContains(feature, id)).length;
        if (count > bestCount) {
            best = feature;
            bestCount = count;
        }
    }
    return best;
}
