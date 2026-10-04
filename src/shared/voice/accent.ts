// 日本語アクセント記法 (phoneme タグの独自拡張) の解析。
// renderer の入力チェックと main の合成準備の両方から使うため、Node / DOM に依存させない。
//
// 記法: 対象の語のカタカナ読みを書き、音が下がる直前の拍 (アクセント核) の直後に半角の「'」を置く。
// 「'」が無い句は平板型。複数のアクセント句にまたがる場合は半角の「/」で句を区切る。
// 例: 「キョ'ウワ/イ'イ/テンキ」
//
// 高低は東京式アクセントの規則で求める (1 = 高、0 = 低)。
// - 核が 1 拍目: 1 拍目が高く、以降は低い
// - 核がそれ以外: 1 拍目が低く、2 拍目から核まで高く、その後は低い
// - 平板型: 1 拍目が低く、2 拍目以降は高い (1 拍だけの句は低)

// 音声合成エンジン (Style-Bert-VITS2) が受け付けるモーラの一覧 (カタカナ -> [子音, 母音])。
// エンジン側の mora_list.py と同じ内容で、子音の無いモーラは null。「ン」は母音 N、「ッ」は母音 q 扱い。
// 1 項目 1 行に展開すると 200 行を超えて対応表として読みにくくなるため、整形の対象から外す
// prettier-ignore
const MORA_TABLE: Record<string, [string | null, string]> = {
    ヴォ: ['v', 'o'], ヴェ: ['v', 'e'], ヴィ: ['v', 'i'], ヴァ: ['v', 'a'], ヴ: ['v', 'u'], ン: [null, 'N'],
    ワ: ['w', 'a'], ロ: ['r', 'o'], レ: ['r', 'e'], ル: ['r', 'u'], リョ: ['ry', 'o'], リュ: ['ry', 'u'],
    リャ: ['ry', 'a'], リェ: ['ry', 'e'], リ: ['r', 'i'], ラ: ['r', 'a'], ヨ: ['y', 'o'], ユ: ['y', 'u'],
    ヤ: ['y', 'a'], モ: ['m', 'o'], メ: ['m', 'e'], ム: ['m', 'u'], ミョ: ['my', 'o'], ミュ: ['my', 'u'],
    ミャ: ['my', 'a'], ミェ: ['my', 'e'], ミ: ['m', 'i'], マ: ['m', 'a'], ポ: ['p', 'o'], ボ: ['b', 'o'],
    ホ: ['h', 'o'], ペ: ['p', 'e'], ベ: ['b', 'e'], ヘ: ['h', 'e'], プ: ['p', 'u'], ブ: ['b', 'u'],
    フュ: ['fy', 'u'], フォ: ['f', 'o'], フェ: ['f', 'e'], フィ: ['f', 'i'], ファ: ['f', 'a'], フ: ['f', 'u'],
    ピョ: ['py', 'o'], ピュ: ['py', 'u'], ピャ: ['py', 'a'], ピェ: ['py', 'e'], ピ: ['p', 'i'],
    ビョ: ['by', 'o'], ビュ: ['by', 'u'], ビャ: ['by', 'a'], ビェ: ['by', 'e'], ビ: ['b', 'i'],
    ヒョ: ['hy', 'o'], ヒュ: ['hy', 'u'], ヒャ: ['hy', 'a'], ヒェ: ['hy', 'e'], ヒ: ['h', 'i'],
    パ: ['p', 'a'], バ: ['b', 'a'], ハ: ['h', 'a'], ノ: ['n', 'o'], ネ: ['n', 'e'], ヌ: ['n', 'u'],
    ニョ: ['ny', 'o'], ニュ: ['ny', 'u'], ニャ: ['ny', 'a'], ニェ: ['ny', 'e'], ニ: ['n', 'i'], ナ: ['n', 'a'],
    ドゥ: ['d', 'u'], ド: ['d', 'o'], トゥ: ['t', 'u'], ト: ['t', 'o'], デョ: ['dy', 'o'], デュ: ['dy', 'u'],
    デャ: ['dy', 'a'], デェ: ['dy', 'e'], ディ: ['d', 'i'], デ: ['d', 'e'], テョ: ['ty', 'o'], テュ: ['ty', 'u'],
    テャ: ['ty', 'a'], ティ: ['t', 'i'], テ: ['t', 'e'], ツォ: ['ts', 'o'], ツェ: ['ts', 'e'], ツィ: ['ts', 'i'],
    ツァ: ['ts', 'a'], ツ: ['ts', 'u'], ッ: [null, 'q'], チョ: ['ch', 'o'], チュ: ['ch', 'u'], チャ: ['ch', 'a'],
    チェ: ['ch', 'e'], チ: ['ch', 'i'], ダ: ['d', 'a'], タ: ['t', 'a'], ゾ: ['z', 'o'], ソ: ['s', 'o'],
    ゼ: ['z', 'e'], セ: ['s', 'e'], ズィ: ['z', 'i'], ズ: ['z', 'u'], スィ: ['s', 'i'], ス: ['s', 'u'],
    ジョ: ['j', 'o'], ジュ: ['j', 'u'], ジャ: ['j', 'a'], ジェ: ['j', 'e'], ジ: ['j', 'i'], ショ: ['sh', 'o'],
    シュ: ['sh', 'u'], シャ: ['sh', 'a'], シェ: ['sh', 'e'], シ: ['sh', 'i'], ザ: ['z', 'a'], サ: ['s', 'a'],
    ゴ: ['g', 'o'], コ: ['k', 'o'], ゲ: ['g', 'e'], ケ: ['k', 'e'], グヮ: ['gw', 'a'], グォ: ['gw', 'o'],
    グェ: ['gw', 'e'], グゥ: ['gw', 'u'], グィ: ['gw', 'i'], グ: ['g', 'u'], クヮ: ['kw', 'a'], クォ: ['kw', 'o'],
    クェ: ['kw', 'e'], クゥ: ['kw', 'u'], クィ: ['kw', 'i'], ク: ['k', 'u'], ギョ: ['gy', 'o'], ギュ: ['gy', 'u'],
    ギャ: ['gy', 'a'], ギェ: ['gy', 'e'], ギ: ['g', 'i'], キョ: ['ky', 'o'], キュ: ['ky', 'u'], キャ: ['ky', 'a'],
    キェ: ['ky', 'e'], キ: ['k', 'i'], ガ: ['g', 'a'], カ: ['k', 'a'], オ: [null, 'o'], エ: [null, 'e'],
    ウォ: ['w', 'o'], ウェ: ['w', 'e'], ウィ: ['w', 'i'], ウ: [null, 'u'], イェ: ['y', 'e'], イ: [null, 'i'],
    ア: [null, 'a'],
    // 同じ音に対応する別表記
    ヴョ: ['by', 'o'], ヴュ: ['by', 'u'], ヴャ: ['by', 'a'], ヲ: [null, 'o'], ヱ: [null, 'e'], ヰ: [null, 'i'],
    ヮ: ['w', 'a'], ョ: ['y', 'o'], ュ: ['y', 'u'], ヅ: ['z', 'u'], ヂョ: ['j', 'o'], ヂュ: ['j', 'u'],
    ヂャ: ['j', 'a'], ヂェ: ['j', 'e'], ヂ: ['j', 'i'], シィ: ['s', 'i'], グァ: ['gw', 'a'], クァ: ['kw', 'a'],
    ヶ: ['k', 'e'], ャ: ['y', 'a'], ォ: [null, 'o'], ェ: [null, 'e'], ゥ: [null, 'u'], ィ: [null, 'i'], ァ: [null, 'a'],
};

// 長音「ー」を直前の拍の母音に置き換えるための表
const VOWEL_KANA: Record<string, string> = { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ', N: 'ン' };

const NUCLEUS_MARK = "'";
const PHRASE_SEPARATOR = '/';
const LONG_VOWEL = 'ー';

type AccentPhrase = {
    // 拍 (モーラ) のカタカナ表記。長音は直前の母音に置き換え済み
    moras: string[];
    // アクセント核の位置 (1 始まり)。0 は平板型
    nucleus: number;
};

export type AccentErrorCode =
    | 'empty'
    | 'emptyPhrase'
    | 'invalidChar'
    | 'unknownMora'
    | 'markAtStart'
    | 'multipleMarks'
    | 'longVowelAtStart'
    | 'longVowelAfterSokuon';

type AccentError = {
    code: AccentErrorCode;
    // ph 属性値の中での位置 (0 始まり) と長さ
    offset: number;
    length: number;
    // 問題の文字列 (表示用)
    text: string;
};

type AccentParseResult = { ok: true; phrases: AccentPhrase[] } | { ok: false; error: AccentError };

// 句ごとの高低 (1 = 高、0 = 低) を東京式アクセントの規則で求める
function phraseTones(moraCount: number, nucleus: number): number[] {
    const tones: number[] = [];
    for (let index = 1; index <= moraCount; index++) {
        if (nucleus === 1) {
            tones.push(index === 1 ? 1 : 0);
        } else if (nucleus === 0) {
            tones.push(index === 1 ? 0 : 1);
        } else {
            tones.push(index === 1 || index > nucleus ? 0 : 1);
        }
    }
    return tones;
}

// ph 属性値を解析する。位置情報は属性値の先頭からの文字数
export function parseAccentNotation(source: string): AccentParseResult {
    if (source.length === 0) {
        return { ok: false, error: { code: 'empty', offset: 0, length: 0, text: '' } };
    }
    const phrases: AccentPhrase[] = [];
    let phraseStart = 0;
    let moras: string[] = [];
    let nucleus = 0;
    let lastVowel: string | null = null;
    let index = 0;

    const closePhrase = (endOffset: number): AccentError | null => {
        if (moras.length === 0) {
            return { code: 'emptyPhrase', offset: phraseStart, length: Math.max(1, endOffset - phraseStart), text: '' };
        }
        phrases.push({ moras, nucleus });
        moras = [];
        nucleus = 0;
        lastVowel = null;
        return null;
    };

    while (index < source.length) {
        const char = source[index];
        if (char === PHRASE_SEPARATOR) {
            const error = closePhrase(index);
            if (error) return { ok: false, error };
            index += 1;
            phraseStart = index;
            continue;
        }
        if (char === NUCLEUS_MARK) {
            if (moras.length === 0) {
                return { ok: false, error: { code: 'markAtStart', offset: index, length: 1, text: char } };
            }
            if (nucleus !== 0) {
                return { ok: false, error: { code: 'multipleMarks', offset: index, length: 1, text: char } };
            }
            nucleus = moras.length;
            index += 1;
            continue;
        }
        if (char === LONG_VOWEL) {
            if (lastVowel === null) {
                return { ok: false, error: { code: 'longVowelAtStart', offset: index, length: 1, text: char } };
            }
            if (lastVowel === 'q') {
                return { ok: false, error: { code: 'longVowelAfterSokuon', offset: index, length: 1, text: char } };
            }
            moras.push(VOWEL_KANA[lastVowel]);
            index += 1;
            continue;
        }
        // 2 文字のモーラ (拗音など) を優先して照合する
        const pair = source.slice(index, index + 2);
        const key = pair.length === 2 && MORA_TABLE[pair] ? pair : char;
        const mora = MORA_TABLE[key];
        if (!mora) {
            const isKatakana = /[ァ-ヺ]/.test(char);
            return {
                ok: false,
                error: { code: isKatakana ? 'unknownMora' : 'invalidChar', offset: index, length: 1, text: char },
            };
        }
        moras.push(key);
        lastVowel = mora[1];
        index += key.length;
    }
    const error = closePhrase(source.length);
    if (error) return { ok: false, error };
    return { ok: true, phrases };
}

// 解析結果を (カタカナ, 高低) の並びにする。エンジンへはこの形で渡す
export function accentToKataTone(phrases: AccentPhrase[]): [string, number][] {
    const result: [string, number][] = [];
    for (const phrase of phrases) {
        const tones = phraseTones(phrase.moras.length, phrase.nucleus);
        phrase.moras.forEach((mora, index) => result.push([mora, tones[index]]));
    }
    return result;
}

// 記法から句の区切りとアクセント核の記号を除いた読み (長音はそのまま残す)
export function accentReading(source: string): string {
    return source.split(NUCLEUS_MARK).join('').split(PHRASE_SEPARATOR).join('');
}
