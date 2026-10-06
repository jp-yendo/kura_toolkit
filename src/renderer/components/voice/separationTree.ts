import type { SeparationCandidate, SeparationParams } from '@shared/voice/types';
import type { MethodSelection } from './SeparationMethodPicker';

// 分離の結果の木。元の音源を根にし、どの音 (元の音源・出力) からも何度でも分離でき、分離した結果をその音の下に置く。
// 出力の名前と順は、モデル (audio-separator) が返したものをそのまま使う (アプリは名前から意味を判断しない)。

// 元の音源の音のキー
export const SOURCE_KEY = 'source';

// 分離 1 回分 (木の節)
export type SepNode = {
    id: string;
    // 分離した音 (元の音源は SOURCE_KEY、出力は outputKey)
    parentKey: string;
    // 同じ音から分離した順の番号 (1 から。削除しても振り直さない。作り直しても変わらない)
    number: number;
    result: SeparationCandidate;
    // 作ったときの条件 (作り直すときにダイアログへ戻す)
    selection: MethodSelection;
    params: SeparationParams;
    // 利用者が付けた出力の名前 (出力の名前ごと)。無い出力はモデルが返した名前
    labels: Record<string, string>;
};

// 木に並べる出力 1 つ
export type TreeOutput = {
    key: string;
    node: SepNode;
    // モデルが返した出力の名前
    stemName: string;
    // 画面の名前 (番号-名前)
    label: string;
    // 根からの名前を「_」でつないだもの (書き出しのファイル名)
    path: string;
    // 深さ (元の音源から分離した出力は 0)
    depth: number;
    mediaPath: string;
    mediaUrl: string;
};

export function outputKey(nodeId: string, stemName: string): string {
    return `${nodeId}:${stemName}`;
}

// ある音から分離した結果 (番号の順)
export function childrenOf(nodes: SepNode[], parentKey: string): SepNode[] {
    return nodes.filter(node => node.parentKey === parentKey).sort((a, b) => a.number - b.number);
}

// ある音から次に分離するときの番号 (それまでの最大の次)
export function nextNumber(nodes: SepNode[], parentKey: string): number {
    return Math.max(0, ...nodes.filter(node => node.parentKey === parentKey).map(node => node.number)) + 1;
}

export function outputLabel(node: SepNode, stemName: string): string {
    return `${node.number}-${node.labels[stemName] ?? stemName}`;
}

// 結果の下にある結果 (その結果の出力から分離したもの。孫以降も含む)
export function descendantsOf(nodes: SepNode[], nodeId: string): SepNode[] {
    const found: SepNode[] = [];
    const visit = (id: string) => {
        for (const node of nodes) {
            if (node.parentKey.startsWith(`${id}:`) && !found.includes(node)) {
                found.push(node);
                visit(node.id);
            }
        }
    };
    visit(nodeId);
    return found;
}

// すべての出力を、木の順 (深さ優先。結果は番号の順、出力はモデルが返した順) に並べる
export function treeOutputs(nodes: SepNode[]): TreeOutput[] {
    const list: TreeOutput[] = [];
    const visit = (parentKey: string, depth: number, parentPath: string) => {
        for (const node of childrenOf(nodes, parentKey)) {
            for (const stem of node.result.stems) {
                const label = outputLabel(node, stem.name);
                const path = parentPath ? `${parentPath}_${label}` : label;
                const key = outputKey(node.id, stem.name);
                list.push({
                    key,
                    node,
                    stemName: stem.name,
                    label,
                    path,
                    depth,
                    mediaPath: stem.media.path,
                    mediaUrl: stem.media.url,
                });
                visit(key, depth + 1, path);
            }
        }
    };
    visit(SOURCE_KEY, 0, '');
    return list;
}

// 最初に選んでおく変換する音: 最後に作った結果の、モデルが「Vocals」と名付けた出力
export function defaultVocals(nodes: SepNode[], outputs: TreeOutput[]): TreeOutput | null {
    const order = (output: TreeOutput) => nodes.indexOf(output.node);
    return (
        [...outputs]
            .filter(output => output.stemName.toLowerCase() === 'vocals')
            .sort((a, b) => order(b) - order(a))[0] ?? null
    );
}

// 最初に選んでおく伴奏: その音から分離していない出力 (木の末端) のうち、変換する音以外のすべて
export function defaultAccompaniment(nodes: SepNode[], outputs: TreeOutput[], vocalsKey: string | null): string[] {
    return outputs
        .filter(output => output.key !== vocalsKey && !nodes.some(node => node.parentKey === output.key))
        .map(output => output.key);
}
