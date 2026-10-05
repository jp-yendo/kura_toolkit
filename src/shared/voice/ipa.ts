// 英語の phoneme タグ (alphabet="ipa") で書かれた IPA を ARPAbet に変換する。
// 読み上げエンジンの英語の発音表現は CMU 発音辞書と同じ ARPAbet (母音に強勢の数字を付ける) のため、
// 一般米語の音素に対応する IPA だけを受け付け、それ以外は記号の誤りとして扱う。

// 2 文字以上の記号を先に照合するため、長い順に並べて使う
const VOWELS: Record<string, string> = {
    aɪ: 'AY',
    aʊ: 'AW',
    eɪ: 'EY',
    oʊ: 'OW',
    əʊ: 'OW',
    ɔɪ: 'OY',
    'ɜ˞': 'ER',
    ɝ: 'ER',
    ɚ: 'ER',
    ɑ: 'AA',
    ɒ: 'AA',
    a: 'AA',
    æ: 'AE',
    ʌ: 'AH',
    ə: 'AH',
    ɔ: 'AO',
    ɛ: 'EH',
    e: 'EH',
    ɜ: 'ER',
    ɪ: 'IH',
    ɨ: 'IH',
    i: 'IY',
    o: 'OW',
    ʊ: 'UH',
    u: 'UW',
};

const CONSONANTS: Record<string, string> = {
    tʃ: 'CH',
    t͡ʃ: 'CH',
    t͜ʃ: 'CH',
    dʒ: 'JH',
    d͡ʒ: 'JH',
    d͜ʒ: 'JH',
    b: 'B',
    d: 'D',
    ð: 'DH',
    f: 'F',
    ɡ: 'G',
    g: 'G',
    h: 'HH',
    k: 'K',
    l: 'L',
    ɫ: 'L',
    m: 'M',
    n: 'N',
    ŋ: 'NG',
    p: 'P',
    ɹ: 'R',
    r: 'R',
    s: 'S',
    ʃ: 'SH',
    t: 'T',
    ɾ: 'D',
    θ: 'TH',
    v: 'V',
    w: 'W',
    j: 'Y',
    z: 'Z',
    ʒ: 'ZH',
};

const SYMBOLS = [...Object.keys(VOWELS), ...Object.keys(CONSONANTS)].sort((a, b) => b.length - a.length);

const PRIMARY_STRESS = 'ˈ';
const SECONDARY_STRESS = 'ˌ';
// 読みに影響しない記号 (長音・音節区切り・連結記号・音素の囲み)
const IGNORED = new Set(['ː', 'ˑ', '.', '͡', '͜', '/', '[', ']']);

type IpaParseResult = { ok: true; words: string[][] } | { ok: false; symbol: string; offset: number };

// IPA を単語 (空白区切り) ごとの ARPAbet 列に変換する。
// 強勢記号は直後の母音に付け、強勢の無い母音は 0 とする (英語の辞書と同じ表記)
export function parseIpa(source: string): IpaParseResult {
    const words: string[][] = [];
    let current: string[] = [];
    let pendingStress: '1' | '2' | null = null;
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        if (/\s/.test(char)) {
            if (current.length > 0) words.push(current);
            current = [];
            pendingStress = null;
            index += 1;
            continue;
        }
        if (char === PRIMARY_STRESS || char === SECONDARY_STRESS || char === "'") {
            pendingStress = char === SECONDARY_STRESS ? '2' : '1';
            index += 1;
            continue;
        }
        if (IGNORED.has(char)) {
            index += 1;
            continue;
        }
        const symbol = SYMBOLS.find(candidate => source.startsWith(candidate, index));
        if (!symbol) return { ok: false, symbol: char, offset: index };
        if (VOWELS[symbol]) {
            current.push(`${VOWELS[symbol]}${pendingStress ?? '0'}`);
            pendingStress = null;
        } else {
            current.push(CONSONANTS[symbol]);
        }
        index += symbol.length;
    }
    if (current.length > 0) words.push(current);
    if (words.length === 0) return { ok: false, symbol: '', offset: 0 };
    return { ok: true, words };
}
