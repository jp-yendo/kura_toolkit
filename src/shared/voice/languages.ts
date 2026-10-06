// 言語定義と読み上げの声の形式の定義 (main と renderer で共有する)。言語ごとの要素 (その言語を読める声の形式、
// 学習用の読み上げ文、記号の読みの初期値) と、言語ごとのダウンロード項目をここにまとめて持つ。
// 言語を追加するときはこの定義を足せば各画面に反映される。

export type VoiceLanguage = 'ja' | 'en' | 'zh';

// 読み上げの声のモデルの種類 (Style-Bert-VITS2 の 2 形式。画面では「モデルの種類」として選ぶ)
export type TtsModelType = 'jp-extra' | 'multilingual';

// 読み上げる言語ごとに必要な言語モデル (BERT) のダウンロード項目。どちらの形式の声でも、読む言語のものだけを使う
export const TTS_LANGUAGE_MODEL_ITEMS: Record<VoiceLanguage, string> = {
    ja: 'model:tts:bert-ja',
    en: 'model:tts:bert-en',
    zh: 'model:tts:bert-zh',
};

// 読み上げのモデルの学習で初期値に使う事前学習済みモデルのダウンロード項目 (声の形式ごと)
const TTS_PRETRAINED_ITEMS: Record<TtsModelType, string> = {
    'jp-extra': 'model:tts:train-jp-extra',
    multilingual: 'model:tts:train-multilingual',
};

export type SymbolReading = {
    symbol: string;
    reading: string;
};

type CorpusDefinition = {
    // third_party/ からの相対パス (/ 区切り)
    file: string;
};

// phoneme タグの表記 (日本語はアクセント記法のカナ、英語は IPA、中国語は声調の数字付きのピンイン)
export type PhonemeAlphabet = 'x-kana' | 'ipa' | 'x-pinyin';

type LanguageDefinition = {
    // 読み上げに使えるモデルの種類 (推奨順)
    modelTypes: TtsModelType[];
    // 学習に使えるモデルの種類 (推奨順)
    trainingModelTypes: TtsModelType[];
    corpus: CorpusDefinition;
    // phoneme タグで使える表記 (alphabet を省略したときもこの表記として扱う)
    phonemeAlphabet: PhonemeAlphabet;
    // 常に読み上げの区切りとして扱う句読点 (記号の読み上げ設定の対象外)
    punctuation: string[];
    // 記号の読みの初期値。全角と半角は別の項目として持つ
    defaultSymbolReadings: SymbolReading[];
    // 記号の読みの前後に空白を補うか (単語を空白で区切る言語)
    spaceAroundReading: boolean;
    // 読み上げのモデルの学習に使う、音声のある文の数。最低は録音の合計が約 5 分、推奨は約 15 分になる文数
    // (読み上げエンジンの FAQ にある「数分程度でも学習できる」「多くても 45 分程度で十分」を元にした目安)。
    // 1 文の長さは、その言語の読み上げ文の平均 (日本語はモーラ数を毎秒 7.5 モーラ、英語は単語数を毎秒 2.7 語、
    // 中国語は音節 (漢字) 数を毎秒 4.5 音節で割ったもの) から概算し、10 文単位で切り上げる
    trainingSentences: { minimum: number; recommended: number };
};

const JA_SYMBOLS: SymbolReading[] = [
    { symbol: '<', reading: 'しょうなり' },
    { symbol: '>', reading: 'だいなり' },
    { symbol: '=', reading: 'イコール' },
    { symbol: '+', reading: 'プラス' },
    { symbol: '-', reading: 'ハイフン' },
    { symbol: '*', reading: 'アスタリスク' },
    { symbol: '/', reading: 'スラッシュ' },
    { symbol: '\\', reading: 'バックスラッシュ' },
    { symbol: '%', reading: 'パーセント' },
    { symbol: '&', reading: 'アンド' },
    { symbol: '@', reading: 'アットマーク' },
    { symbol: '#', reading: 'シャープ' },
    { symbol: '$', reading: 'ドル' },
    { symbol: '~', reading: 'チルダ' },
    { symbol: '^', reading: 'キャレット' },
    { symbol: '_', reading: 'アンダースコア' },
    { symbol: '|', reading: 'たてせん' },
    { symbol: ':', reading: 'コロン' },
    { symbol: ';', reading: 'セミコロン' },
    { symbol: '＜', reading: 'しょうなり' },
    { symbol: '＞', reading: 'だいなり' },
    { symbol: '＝', reading: 'イコール' },
    { symbol: '＋', reading: 'プラス' },
    { symbol: '－', reading: 'マイナス' },
    { symbol: '＊', reading: 'アスタリスク' },
    { symbol: '／', reading: 'スラッシュ' },
    { symbol: '％', reading: 'パーセント' },
    { symbol: '＆', reading: 'アンド' },
    { symbol: '＠', reading: 'アットマーク' },
    { symbol: '＃', reading: 'シャープ' },
    { symbol: '＄', reading: 'ドル' },
    { symbol: '￥', reading: 'えん' },
    { symbol: '～', reading: 'から' },
    { symbol: '〜', reading: 'から' },
    { symbol: '※', reading: 'こめじるし' },
    { symbol: '→', reading: 'みぎやじるし' },
    { symbol: '←', reading: 'ひだりやじるし' },
];

const EN_SYMBOLS: SymbolReading[] = [
    { symbol: '<', reading: 'less than' },
    { symbol: '>', reading: 'greater than' },
    { symbol: '=', reading: 'equals' },
    { symbol: '+', reading: 'plus' },
    { symbol: '-', reading: 'hyphen' },
    { symbol: '*', reading: 'asterisk' },
    { symbol: '/', reading: 'slash' },
    { symbol: '\\', reading: 'backslash' },
    { symbol: '%', reading: 'percent' },
    { symbol: '&', reading: 'and' },
    { symbol: '@', reading: 'at' },
    { symbol: '#', reading: 'hash' },
    { symbol: '$', reading: 'dollar' },
    { symbol: '~', reading: 'tilde' },
    { symbol: '^', reading: 'caret' },
    { symbol: '_', reading: 'underscore' },
    { symbol: '|', reading: 'vertical bar' },
    { symbol: ':', reading: 'colon' },
    { symbol: ';', reading: 'semicolon' },
];

const ZH_SYMBOLS: SymbolReading[] = [
    { symbol: '<', reading: '小于' },
    { symbol: '>', reading: '大于' },
    { symbol: '=', reading: '等于' },
    { symbol: '+', reading: '加' },
    { symbol: '-', reading: '连字符' },
    { symbol: '*', reading: '星号' },
    { symbol: '/', reading: '斜杠' },
    { symbol: '\\', reading: '反斜杠' },
    { symbol: '%', reading: '百分号' },
    { symbol: '&', reading: '和' },
    { symbol: '@', reading: '艾特' },
    { symbol: '#', reading: '井号' },
    { symbol: '$', reading: '美元' },
    { symbol: '~', reading: '波浪号' },
    { symbol: '^', reading: '脱字符' },
    { symbol: '_', reading: '下划线' },
    { symbol: '|', reading: '竖线' },
    { symbol: '＜', reading: '小于' },
    { symbol: '＞', reading: '大于' },
    { symbol: '＝', reading: '等于' },
    { symbol: '＋', reading: '加' },
    { symbol: '－', reading: '减' },
    { symbol: '＊', reading: '星号' },
    { symbol: '／', reading: '斜杠' },
    { symbol: '％', reading: '百分号' },
    { symbol: '＆', reading: '和' },
    { symbol: '＠', reading: '艾特' },
    { symbol: '＃', reading: '井号' },
    { symbol: '＄', reading: '美元' },
    { symbol: '￥', reading: '元' },
    { symbol: '～', reading: '到' },
    { symbol: '→', reading: '右箭头' },
    { symbol: '←', reading: '左箭头' },
];

export const LANGUAGE_DEFINITIONS: Record<VoiceLanguage, LanguageDefinition> = {
    ja: {
        // 日本語だけを扱う場合は JP-Extra 版が強く推奨されている
        modelTypes: ['jp-extra', 'multilingual'],
        trainingModelTypes: ['jp-extra', 'multilingual'],
        corpus: { file: 'ita-corpus/ja-ita.json' },
        phonemeAlphabet: 'x-kana',
        punctuation: ['、', '。', '，', '．', ',', '.', '!', '?', '！', '？', '…', '‥'],
        defaultSymbolReadings: JA_SYMBOLS,
        spaceAroundReading: false,
        // 1 文の平均 約 3.2 秒 (24.0 モーラ)
        trainingSentences: { minimum: 100, recommended: 290 },
    },
    en: {
        // 英語の読み上げには多言語版が必要
        modelTypes: ['multilingual'],
        trainingModelTypes: ['multilingual'],
        corpus: { file: 'cmu-arctic/en-cmu-arctic.json' },
        phonemeAlphabet: 'ipa',
        punctuation: [',', '.', '!', '?', '…'],
        defaultSymbolReadings: EN_SYMBOLS,
        spaceAroundReading: true,
        // 1 文の平均 約 3.3 秒 (8.8 語)
        trainingSentences: { minimum: 100, recommended: 280 },
    },
    zh: {
        // 中国語を読めるのは多言語版の形式だけ (JP-Extra 版は日本語専用)
        modelTypes: ['multilingual'],
        trainingModelTypes: ['multilingual'],
        corpus: { file: 'common-voice-zh/zh-common-voice.json' },
        phonemeAlphabet: 'x-pinyin',
        punctuation: ['，', '。', '！', '？', '、', '；', '：', '…', ',', '.', '!', '?', ';', ':'],
        defaultSymbolReadings: ZH_SYMBOLS,
        spaceAroundReading: false,
        // 1 文の平均 約 5.4 秒 (24.4 音節)
        trainingSentences: { minimum: 60, recommended: 170 },
    },
};

export const VOICE_LANGUAGES: VoiceLanguage[] = ['ja', 'en', 'zh'];

export function isVoiceLanguage(value: string): value is VoiceLanguage {
    return (VOICE_LANGUAGES as string[]).includes(value);
}

// モデルの種類ごとの、読み上げられる言語
export function languagesForModelType(modelType: TtsModelType): VoiceLanguage[] {
    return VOICE_LANGUAGES.filter(language => LANGUAGE_DEFINITIONS[language].modelTypes.includes(modelType));
}

// 読み上げのモデルの学習に必要なダウンロード項目のうち、声の形式と言語によって変わるもの
// (Python と読み上げ・学習のパッケージ一式は含まない)。学習する言語の言語モデルと、形式の事前学習モデル
export function ttsTrainingItems(modelType: TtsModelType, language: VoiceLanguage): string[] {
    return [TTS_LANGUAGE_MODEL_ITEMS[language], TTS_PRETRAINED_ITEMS[modelType]];
}

// 記号の読みを文章に適用する。長い記号から順に照合し、句読点は対象外とする
export function applySymbolReadings(text: string, language: VoiceLanguage, readings: SymbolReading[]): string {
    const definition = LANGUAGE_DEFINITIONS[language];
    const usable = readings
        .filter(item => item.symbol.length > 0 && !definition.punctuation.includes(item.symbol))
        .sort((a, b) => b.symbol.length - a.symbol.length);
    if (usable.length === 0) return text;
    let result = '';
    let index = 0;
    while (index < text.length) {
        const match = usable.find(item => text.startsWith(item.symbol, index));
        if (!match) {
            result += text[index];
            index += 1;
            continue;
        }
        result += definition.spaceAroundReading ? ` ${match.reading} ` : match.reading;
        index += match.symbol.length;
    }
    return definition.spaceAroundReading ? result.replace(/ {2,}/g, ' ') : result;
}
