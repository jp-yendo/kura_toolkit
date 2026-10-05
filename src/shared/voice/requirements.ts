import type { VoiceLanguage } from './languages';
import type { VoiceFeatureId } from './types';

// 音声機能ごとに必要なダウンロード項目の構成 (main と renderer で共有する)。
// main は機能を使えるかの判定に、ダウンロードの画面は機能ごとの一覧の表示に使う。

// 項目と、その項目を前提とする項目 (Python 本体の下にパッケージ一式を置くなど)
export type RequirementNode = {
    item: string;
    // この項目が必要になる条件 (翻訳キー。「必要な場合のみ」の項目に付ける)
    conditionKey?: string;
    children?: RequirementNode[];
    // この言語を読めるすぐに使えるモデルを、この項目の下に (オプションとして) 並べる
    readyModelsFor?: VoiceLanguage;
};

// all: 必須 (機能を使えるかの判定に使う) / anyOf: いずれか 1 つ以上が必要 / optional: 必要な場合のみ (オプション)
export type RequirementKind = 'all' | 'anyOf' | 'optional';

export type RequirementGroup = {
    kind: RequirementKind;
    // まとまりの名前 (見出しには種別を添えて表示する)
    titleKey: string;
    noteKey?: string;
    // 固定の項目、または ID の先頭が一致する項目すべて (分離モデルのように数が変わるもの)
    nodes?: RequirementNode[];
    itemPrefix?: string;
};

export const SEPARATOR_MODEL_PREFIX = 'model:separator:';
export const TTS_READY_PREFIX = 'model:tts:ready:';

const python = (children: RequirementNode[]): RequirementNode => ({ item: 'python', children });

export const FEATURE_REQUIREMENTS: Record<VoiceFeatureId, RequirementGroup[]> = {
    separation: [
        {
            kind: 'all',
            titleKey: 'voice.library.requirements.separationRuntime',
            nodes: [python([{ item: 'component:separator' }])],
        },
        {
            kind: 'anyOf',
            titleKey: 'voice.library.requirements.separatorModels',
            noteKey: 'voice.library.requirements.separatorModelsNote',
            itemPrefix: SEPARATOR_MODEL_PREFIX,
        },
    ],
    conversion: [
        {
            kind: 'all',
            titleKey: 'voice.library.requirements.conversionRuntime',
            nodes: [
                python([{ item: 'component:converter' }]),
                { item: 'model:converter:rmvpe' },
                { item: 'model:converter:contentvec' },
            ],
        },
        {
            kind: 'optional',
            titleKey: 'voice.library.requirements.conversionExtras',
            nodes: [
                { item: 'model:converter:fcpe', conditionKey: 'voice.library.requirements.whenFcpe' },
                { item: 'component:separator', conditionKey: 'voice.library.requirements.whenSeparateInput' },
            ],
        },
        {
            kind: 'optional',
            titleKey: 'voice.library.requirements.importedEmbedders',
            noteKey: 'voice.library.requirements.importedEmbeddersNote',
            nodes: [
                { item: 'model:converter:embedder-spin' },
                { item: 'model:converter:embedder-spin-v2' },
                { item: 'model:converter:embedder-japanese-hubert-base' },
                { item: 'model:converter:embedder-chinese-hubert-base' },
                { item: 'model:converter:embedder-korean-hubert-base' },
            ],
        },
    ],
    conversionTraining: [
        {
            kind: 'all',
            titleKey: 'voice.library.requirements.conversionTrainingRuntime',
            nodes: [
                python([{ item: 'component:converter' }]),
                { item: 'model:converter:rmvpe' },
                { item: 'model:converter:contentvec' },
                { item: 'model:converter:pretrained-40k' },
            ],
        },
    ],
    tts: [
        {
            kind: 'all',
            titleKey: 'voice.library.requirements.ttsRuntime',
            nodes: [python([{ item: 'component:tts' }])],
        },
        // 読み上げる言語ごとに必要な言語モデル
        {
            kind: 'anyOf',
            titleKey: 'voice.library.requirements.ttsLanguageModels',
            noteKey: 'voice.library.requirements.ttsLanguageModelsNote',
            nodes: [
                {
                    item: 'model:tts:bert-ja',
                    conditionKey: 'voice.library.requirements.whenJapanese',
                    readyModelsFor: 'ja',
                },
                {
                    item: 'model:tts:bert-en',
                    conditionKey: 'voice.library.requirements.whenEnglish',
                    readyModelsFor: 'en',
                },
                {
                    item: 'model:tts:bert-zh',
                    conditionKey: 'voice.library.requirements.whenChinese',
                    readyModelsFor: 'zh',
                },
            ],
        },
    ],
    ttsTraining: [
        {
            kind: 'all',
            titleKey: 'voice.library.requirements.ttsTrainingRuntime',
            nodes: [python([{ item: 'component:tts', children: [{ item: 'component:tts-train' }] }])],
        },
        {
            kind: 'anyOf',
            titleKey: 'voice.library.requirements.trainingFormat',
            noteKey: 'voice.library.requirements.trainingFormatNote',
            nodes: [
                { item: 'model:tts:train-jp-extra', conditionKey: 'voice.library.requirements.whenTrainJpExtra' },
                {
                    item: 'model:tts:train-multilingual',
                    conditionKey: 'voice.library.requirements.whenTrainMultilingual',
                },
            ],
        },
        // 学習に使う文章の言語の言語モデル (音声ごとの特徴は、その言語の言語モデルだけで計算する)
        {
            kind: 'anyOf',
            titleKey: 'voice.library.requirements.trainingLanguageModels',
            noteKey: 'voice.library.requirements.trainingLanguageModelsNote',
            nodes: [
                { item: 'model:tts:bert-ja', conditionKey: 'voice.library.requirements.whenTrainJapanese' },
                { item: 'model:tts:bert-en', conditionKey: 'voice.library.requirements.whenTrainEnglish' },
                { item: 'model:tts:bert-zh', conditionKey: 'voice.library.requirements.whenTrainChinese' },
            ],
        },
    ],
};

// 機能を使うのに必ず必要な項目 (必須のまとまりの項目)
export function requiredItems(feature: VoiceFeatureId): string[] {
    const ids: string[] = [];
    const visit = (node: RequirementNode) => {
        ids.push(node.item);
        node.children?.forEach(visit);
    };
    FEATURE_REQUIREMENTS[feature].filter(group => group.kind === 'all').forEach(group => group.nodes?.forEach(visit));
    return ids;
}
