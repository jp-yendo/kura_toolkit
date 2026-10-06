import { create } from 'zustand';
import { newWorkKey } from '../components/voice/voiceFormat';
import { descendantsOf, outputKey, type SepNode } from '../components/voice/separationTree';
import type { PreparedInput, SeparationParams } from '@shared/voice/types';

// 分離の作業 (元の音源と、分離の結果の木)。音声分離の画面と、音声変換の画面の「入力と分離」で別々に持つ。
// 作業の結果は作業ディレクトリにあり、アプリを終了すると消える (作業をまたいで使うときは書き出したファイルを読む)。

// パラメーターの既定値 (結果の一覧では、既定から変えた値だけを示す)
export const DEFAULT_SEPARATION_PARAMS: SeparationParams = {
    mdx: { segmentSize: 256, overlap: 0.25, batchSize: 1, hopLength: 1024, enableDenoise: false },
    vr: {
        windowSize: 512,
        aggression: 5,
        enableTta: false,
        enablePostProcess: false,
        postProcessThreshold: 0.2,
        highEndProcess: false,
        batchSize: 1,
    },
    demucs: { segmentSize: null, shifts: 2, overlap: 0.25, segmentsEnabled: true },
    mdxc: { segmentSize: 256, overrideModelSegmentSize: false, batchSize: null, overlap: null, pitchShift: 0 },
};

type SeparationWorkState = {
    workKey: string;
    source: PreparedInput | null;
    sourceName: string;
    nodes: SepNode[];
    // 書き出す出力 (出力のキー)。最初はどれも選ばない
    saveTargets: string[];
    // 最後に分離したときの詳細な設定 (次に分離するときの初期値)
    params: SeparationParams;
    setSource(source: PreparedInput | null, name: string): void;
    reset(): void;
    addNode(node: SepNode): void;
    // 結果を作り直したものに置き換える (番号と、残っている出力の名前は引き継ぐ)
    replaceNode(node: SepNode): void;
    // 結果と、その下にある結果を取り除く。取り除いた結果を返す
    removeNode(nodeId: string): SepNode[];
    // 結果の下にある結果だけを取り除く。取り除いた結果を返す
    removeDescendants(nodeId: string): SepNode[];
    setLabel(nodeId: string, stemName: string, label: string | null): void;
    setSaveTarget(key: string, checked: boolean): void;
    setParams(params: SeparationParams): void;
};

// 取り除く結果の出力を、書き出す出力から外す
function withoutOutputsOf(targets: string[], removed: SepNode[]): string[] {
    const keys = new Set(removed.flatMap(node => node.result.stems.map(stem => outputKey(node.id, stem.name))));
    return targets.filter(key => !keys.has(key));
}

function createSeparationWorkStore() {
    return create<SeparationWorkState>((set, get) => ({
        workKey: newWorkKey(),
        source: null,
        sourceName: '',
        nodes: [],
        saveTargets: [],
        params: DEFAULT_SEPARATION_PARAMS,
        setSource(source, name) {
            set({ source, sourceName: name, nodes: [], saveTargets: [] });
        },
        reset() {
            set({ workKey: newWorkKey(), source: null, sourceName: '', nodes: [], saveTargets: [] });
        },
        addNode(node) {
            set({ nodes: [...get().nodes, node] });
        },
        replaceNode(node) {
            const nodes = get().nodes;
            const previous = nodes.find(item => item.id === node.id);
            if (!previous) return;
            const names = new Set(node.result.stems.map(stem => stem.name));
            const labels = Object.fromEntries(Object.entries(previous.labels).filter(([name]) => names.has(name)));
            const removedStems = previous.result.stems.filter(stem => !names.has(stem.name));
            set({
                nodes: nodes.map(item => (item.id === node.id ? { ...node, number: previous.number, labels } : item)),
                saveTargets: get().saveTargets.filter(
                    key => !removedStems.some(stem => key === outputKey(node.id, stem.name))
                ),
            });
        },
        removeNode(nodeId) {
            const nodes = get().nodes;
            const removed = [...nodes.filter(node => node.id === nodeId), ...descendantsOf(nodes, nodeId)];
            set({
                nodes: nodes.filter(node => !removed.includes(node)),
                saveTargets: withoutOutputsOf(get().saveTargets, removed),
            });
            return removed;
        },
        removeDescendants(nodeId) {
            const nodes = get().nodes;
            const removed = descendantsOf(nodes, nodeId);
            set({
                nodes: nodes.filter(node => !removed.includes(node)),
                saveTargets: withoutOutputsOf(get().saveTargets, removed),
            });
            return removed;
        },
        setLabel(nodeId, stemName, label) {
            set({
                nodes: get().nodes.map(node => {
                    if (node.id !== nodeId) return node;
                    const labels = { ...node.labels };
                    if (label) labels[stemName] = label;
                    else delete labels[stemName];
                    return { ...node, labels };
                }),
            });
        },
        setSaveTarget(key, checked) {
            const targets = get().saveTargets.filter(item => item !== key);
            set({ saveTargets: checked ? [...targets, key] : targets });
        },
        setParams(params) {
            set({ params });
        },
    }));
}

export const useSeparationWorkStore = createSeparationWorkStore();
export const useConversionSeparationStore = createSeparationWorkStore();

export type SeparationWorkStore = typeof useSeparationWorkStore;
