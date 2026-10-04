// 言語定義と読み上げエンジンの定義 (main と renderer で共有する)。言語ごとの要素 (その言語を扱える読み上げエンジン、
// 学習用の読み上げ文、記号の読みの初期値) と、読み上げエンジンごとのダウンロード項目をここにまとめて持つ。
// 言語を追加するときはこの定義を足せば各画面に反映される。

export type VoiceLanguage = 'ja' | 'en';

// 読み上げエンジン (Style-Bert-VITS2 の 2 形式)
export type TtsEngineId = 'jp-extra' | 'multilingual';

// 読み上げエンジンに対応するダウンロード項目 (エンジンが使う BERT モデル)
export const TTS_ENGINE_ITEMS: Record<TtsEngineId, string> = {
    'jp-extra': 'model:tts:bert-ja',
    multilingual: 'model:tts:bert-en',
};

// 読み上げのモデルの学習で初期値に使う事前学習済みモデルのダウンロード項目 (エンジンごと)
export const TTS_PRETRAINED_ITEMS: Record<TtsEngineId, string> = {
    'jp-extra': 'model:tts:train-jp-extra',
    multilingual: 'model:tts:train-multilingual',
};

// 学習用の読み上げ文の種類 (簡易用 / 精度重視用)
export type CorpusSetId = 'quick' | 'accurate';

export type SymbolReading = {
    symbol: string;
    reading: string;
};

type CorpusDefinition = {
    // third_party/ からの相対パス (/ 区切り)
    file: string;
    // 簡易用に使う文の条件 (set の値と、先頭からの件数)
    quick: { set: string; count: number };
};

type LanguageDefinition = {
    // 読み上げに使えるエンジン (推奨順)
    engines: TtsEngineId[];
    // 学習に使えるエンジン (推奨順)
    trainingEngines: TtsEngineId[];
    corpus: CorpusDefinition;
    // phoneme タグで使える表記 (alphabet を省略したときもこの表記として扱う)
    phonemeAlphabet: 'x-kana' | 'ipa';
    // 常に読み上げの区切りとして扱う句読点 (記号の読み上げ設定の対象外)
    punctuation: string[];
    // 記号の読みの初期値。全角と半角は別の項目として持つ
    defaultSymbolReadings: SymbolReading[];
    // 記号の読みの前後に空白を補うか (単語を空白で区切る言語)
    spaceAroundReading: boolean;
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

export const LANGUAGE_DEFINITIONS: Record<VoiceLanguage, LanguageDefinition> = {
    ja: {
        // 日本語だけを扱う場合は JP-Extra 版が強く推奨されている
        engines: ['jp-extra', 'multilingual'],
        trainingEngines: ['jp-extra', 'multilingual'],
        corpus: { file: 'ita-corpus/ja-ita.json', quick: { set: 'emotion', count: 100 } },
        phonemeAlphabet: 'x-kana',
        punctuation: ['、', '。', '，', '．', ',', '.', '!', '?', '！', '？', '…', '‥'],
        defaultSymbolReadings: JA_SYMBOLS,
        spaceAroundReading: false,
    },
    en: {
        // 英語の読み上げには多言語版が必要
        engines: ['multilingual'],
        trainingEngines: ['multilingual'],
        corpus: { file: 'cmu-arctic/en-cmu-arctic.json', quick: { set: 'a', count: 100 } },
        phonemeAlphabet: 'ipa',
        punctuation: [',', '.', '!', '?', '…'],
        defaultSymbolReadings: EN_SYMBOLS,
        spaceAroundReading: true,
    },
};

export const VOICE_LANGUAGES: VoiceLanguage[] = ['ja', 'en'];

export function isVoiceLanguage(value: string): value is VoiceLanguage {
    return (VOICE_LANGUAGES as string[]).includes(value);
}

// エンジンが読み上げられる言語
export function languagesForEngine(engine: TtsEngineId): VoiceLanguage[] {
    return VOICE_LANGUAGES.filter(language => LANGUAGE_DEFINITIONS[language].engines.includes(engine));
}

// 読み上げのモデルの学習に必要なダウンロード項目のうち、エンジンと言語によって変わるもの
// (Python・読み上げと学習のパッケージ一式・日本語の BERT モデルなど、学習に常に必要な項目は含まない)。
// 多言語版のエンジンの学習と英語の学習には、英語の BERT モデルも使う
export function ttsTrainingItems(engine: TtsEngineId, language: VoiceLanguage): string[] {
    const englishBert = engine === 'multilingual' || language === 'en';
    return [...(englishBert ? [TTS_ENGINE_ITEMS.multilingual] : []), TTS_PRETRAINED_ITEMS[engine]];
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
