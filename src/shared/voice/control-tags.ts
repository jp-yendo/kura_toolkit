// 読み上げの制御タグ (W3C SSML のサブセット + 日本語アクセント記法) の解析と構文チェック。
// renderer の入力中チェックと main の合成準備の両方から使うため、Node / DOM に依存させない。
//
// 制御タグとして扱うのは半角の「<」「>」で書かれたものだけで、「<」(閉じタグは「</」) の直後が
// 既知のタグ名で、その後に空白・「/」・「>」のいずれかが続くものを候補とする。
// それ以外の「<～>」と全角の「＜」「＞」は本文として扱う。本文に既知のタグと同じ文字列を書くときは
// XML の置き換え表記 (&lt; など) を使う。

import { accentReading, accentToKataTone, parseAccentNotation, type AccentErrorCode } from './accent';
import { parseIpa } from './ipa';
import { LANGUAGE_DEFINITIONS, type VoiceLanguage } from './languages';

type ControlTagName = 'break' | 'prosody' | 'sub' | 'phoneme';

const CONTROL_TAG_NAMES: ControlTagName[] = ['break', 'prosody', 'sub', 'phoneme'];

// 各タグが受け付ける属性
const TAG_ATTRIBUTES: Record<ControlTagName, string[]> = {
    break: ['time', 'strength'],
    prosody: ['rate', 'pitch', 'volume'],
    sub: ['alias'],
    phoneme: ['alphabet', 'ph'],
};

// 単独で完結するタグ (終端の「/」が省略されていても補って受け入れる)
const EMPTY_TAGS = new Set<ControlTagName>(['break']);
// 内容に文章だけを持つタグ (タグの入れ子を許さない)
const TEXT_ONLY_TAGS = new Set<ControlTagName>(['sub', 'phoneme']);

// 話速・音高・音量の状態。入れ子の prosody は話速を掛け合わせ、音高と音量は足し合わせる
type ProsodyState = {
    // 話速の倍率 (1 = 既定)
    rate: number;
    // 音高の変化 (半音)
    pitch: number;
    // 音量の変化 (dB)。SILENT_DB 以下は無音
    volume: number;
};

const DEFAULT_PROSODY: ProsodyState = { rate: 1, pitch: 0, volume: 0 };
// volume="silent" を表す値 (JSON で受け渡せるよう -Infinity ではなく有限値にする)
const SILENT_DB = -200;

const RATE_MIN = 0.25;
const RATE_MAX = 4;
const PITCH_MIN = -24;
const PITCH_MAX = 24;
const VOLUME_MIN = -40;
const VOLUME_MAX = 20;
const BREAK_MAX_MS = 30000;

const RATE_LABELS: Record<string, number> = {
    'x-slow': 0.5,
    slow: 0.75,
    medium: 1,
    fast: 1.25,
    'x-fast': 1.5,
    default: 1,
};
const PITCH_LABELS: Record<string, number> = {
    'x-low': -4,
    low: -2,
    medium: 0,
    high: 2,
    'x-high': 4,
    default: 0,
};
const VOLUME_LABELS: Record<string, number> = {
    silent: SILENT_DB,
    'x-soft': -12,
    soft: -6,
    medium: 0,
    loud: 4,
    'x-loud': 8,
    default: 0,
};
const BREAK_STRENGTHS: Record<string, number> = {
    none: 0,
    'x-weak': 100,
    weak: 250,
    medium: 500,
    strong: 750,
    'x-strong': 1000,
};

// 合成の単位。text の改行は段落の区切りとして合成側で扱う
export type SpeechRun =
    | { kind: 'text'; text: string; prosody: ProsodyState; start: number; end: number }
    | { kind: 'break'; ms: number; start: number; end: number }
    | { kind: 'sub'; alias: string; surface: string; prosody: ProsodyState; start: number; end: number }
    | {
          kind: 'phoneme';
          alphabet: 'x-kana';
          surface: string;
          // 拍ごとの (カタカナ, 高低)。高低は東京式アクセントの規則で求めたもの (1 = 高、0 = 低)
          kataTone: [string, number][];
          // 区切り記号を除いた読み
          reading: string;
          prosody: ProsodyState;
          start: number;
          end: number;
      }
    | {
          kind: 'phoneme';
          alphabet: 'ipa';
          surface: string;
          // 単語ごとの ARPAbet (母音には強勢の数字が付く)
          words: string[][];
          prosody: ProsodyState;
          start: number;
          end: number;
      };

export type TagErrorCode =
    | 'unclosedQuote'
    | 'unclosedTag'
    | 'unexpectedChar'
    | 'missingEquals'
    | 'unquotedValue'
    | 'unknownAttribute'
    | 'duplicateAttribute'
    | 'missingAttribute'
    | 'invalidValue'
    | 'attributeOnClosingTag'
    | 'missingClosingTag'
    | 'unmatchedClosingTag'
    | 'misnested'
    | 'emptyContent'
    | 'nestedTagNotAllowed'
    | 'accentNotJapanese'
    | 'ipaNotEnglish'
    | 'accentSyntax'
    | 'ipaSymbol'
    | 'ipaWordCount'
    // 字幕 (SRT / WebVTT) の書式の誤り (parseSubtitles が報告する)
    | 'subtitleTimestamp'
    | 'subtitleOrder'
    | 'subtitleHeader'
    | 'subtitleEmpty';

// 値の書式の種類 (エラー表示で期待する書式を示すため)
type ValueFormat = 'time' | 'strength' | 'rate' | 'pitch' | 'volume' | 'alphabet' | 'nonEmpty';

export type TagIssue = {
    code: TagErrorCode;
    // 文書中の位置 (0 始まりの文字数) と長さ
    offset: number;
    length: number;
    // 1 始まりの行と文字位置
    line: number;
    column: number;
    tag?: string;
    attribute?: string;
    value?: string;
    expected?: string;
    format?: ValueFormat;
    accentCode?: AccentErrorCode;
};

type TagFixCode = 'tagNameCase' | 'attributeNameCase' | 'curlyQuote';

// 一括で直せる注意 (大文字小文字の違いと向き付き引用符)
export type TagFix = {
    code: TagFixCode;
    offset: number;
    length: number;
    line: number;
    column: number;
    original: string;
    replacement: string;
};

type ControlTagParseResult = {
    runs: SpeechRun[];
    errors: TagIssue[];
    fixes: TagFix[];
};

type OpenElement = {
    name: ControlTagName;
    start: number;
    // 開始タグの終わり (内容の始まり)
    contentStart: number;
    prosody: ProsodyState;
    attributes: Record<string, string>;
    // sub / phoneme の内容
    content: string;
    // 属性の誤りがあった要素は内容の検証を省く (同じ問題を重ねて報告しないため)
    invalid: boolean;
    // ph 属性値の文書中の位置 (アクセント記法の誤りの位置を示すため)
    phOffset: number;
};

type ParsedAttribute = {
    name: string;
    value: string;
    nameOffset: number;
    valueOffset: number;
};

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const OPEN_CURLY = '“';
const CLOSE_CURLY = '”';

function isNameChar(char: string): boolean {
    return /[A-Za-z0-9_:.-]/.test(char);
}

function isSpace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '　';
}

// 「&lt;」などの置き換え表記を戻す。既知の表記以外の「&」はそのまま残す
function decodeEntities(text: string): string {
    return text.replace(/&(lt|gt|amp|quot|apos);/g, (_match, name: string) => ENTITIES[name]);
}

function parseBreakTime(value: string): number | null {
    const match = /^(\d+(?:\.\d+)?)\s*(ms|s)$/i.exec(value.trim());
    if (!match) return null;
    const ms = Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1);
    return ms >= 0 && ms <= BREAK_MAX_MS ? Math.round(ms) : null;
}

// 話速: ラベル、「120%」(既定に対する割合)、「+20%」「-20%」(既定からの増減)
function parseRate(value: string): number | null {
    const text = value.trim().toLowerCase();
    if (text in RATE_LABELS) return RATE_LABELS[text];
    const match = /^([+-]?)(\d+(?:\.\d+)?)%$/.exec(text);
    if (!match) return null;
    const amount = Number(match[2]) / 100;
    const rate = match[1] === '+' ? 1 + amount : match[1] === '-' ? 1 - amount : amount;
    return rate >= RATE_MIN && rate <= RATE_MAX ? rate : null;
}

// 音高: ラベル、「+2st」「-3st」(半音)、「+10%」「-10%」(周波数の増減)。半音に換算して返す
function parsePitch(value: string): number | null {
    const text = value.trim().toLowerCase();
    if (text in PITCH_LABELS) return PITCH_LABELS[text];
    const semitone = /^([+-])(\d+(?:\.\d+)?)st$/.exec(text);
    if (semitone) {
        const amount = Number(semitone[2]) * (semitone[1] === '-' ? -1 : 1);
        return amount >= PITCH_MIN && amount <= PITCH_MAX ? amount : null;
    }
    const percent = /^([+-])(\d+(?:\.\d+)?)%$/.exec(text);
    if (percent) {
        const ratio = 1 + (Number(percent[2]) / 100) * (percent[1] === '-' ? -1 : 1);
        if (ratio <= 0) return null;
        const amount = 12 * Math.log2(ratio);
        return amount >= PITCH_MIN && amount <= PITCH_MAX ? amount : null;
    }
    return null;
}

// 音量: ラベル、「+6dB」「-3dB」
function parseVolume(value: string): number | null {
    const text = value.trim().toLowerCase();
    if (text in VOLUME_LABELS) return VOLUME_LABELS[text];
    const match = /^([+-])(\d+(?:\.\d+)?)db$/.exec(text);
    if (!match) return null;
    const amount = Number(match[2]) * (match[1] === '-' ? -1 : 1);
    return amount >= VOLUME_MIN && amount <= VOLUME_MAX ? amount : null;
}

// 文書中の位置から行と文字位置 (いずれも 1 始まり) を求めるための索引
function buildLineIndex(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '\n') starts.push(index + 1);
    }
    return starts;
}

function locate(lineStarts: number[], offset: number): { line: number; column: number } {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lineStarts[middle] <= offset) low = middle;
        else high = middle - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
}

// 制御タグの候補かどうかを判定する。候補ならタグ名の位置と閉じタグかどうかを返す
function matchTagCandidate(
    text: string,
    index: number
): { closing: boolean; name: string; nameStart: number; nameEnd: number } | null {
    if (text[index] !== '<') return null;
    let cursor = index + 1;
    const closing = text[cursor] === '/';
    if (closing) cursor += 1;
    const nameStart = cursor;
    while (cursor < text.length && /[A-Za-z]/.test(text[cursor])) cursor += 1;
    if (cursor === nameStart) return null;
    const name = text.slice(nameStart, cursor);
    if (!CONTROL_TAG_NAMES.includes(name.toLowerCase() as ControlTagName)) return null;
    const next = text[cursor];
    if (next === undefined || !(isSpace(next) || next === '/' || next === '>')) return null;
    return { closing, name, nameStart, nameEnd: cursor };
}

type ParseOptions = {
    language: VoiceLanguage;
    // 文書中の位置を補正する量 (字幕の各区間を文書全体の位置で報告するため)
    baseOffset?: number;
    // 行と文字位置を求めるための文書全体 (省略時は text 自身)
    documentText?: string;
};

// 文章を解析して合成の単位に分け、誤りと一括で直せる注意を返す
export function parseControlTags(text: string, options: ParseOptions): ControlTagParseResult {
    const baseOffset = options.baseOffset ?? 0;
    const lineStarts = buildLineIndex(options.documentText ?? text);
    const errors: TagIssue[] = [];
    const fixes: TagFix[] = [];
    const runs: SpeechRun[] = [];
    const stack: OpenElement[] = [];

    const issue = (code: TagErrorCode, offset: number, length: number, extra: Partial<TagIssue> = {}) => {
        const absolute = offset + baseOffset;
        errors.push({ code, offset: absolute, length: Math.max(1, length), ...locate(lineStarts, absolute), ...extra });
    };
    const fix = (code: TagFixCode, offset: number, original: string, replacement: string) => {
        const absolute = offset + baseOffset;
        fixes.push({
            code,
            offset: absolute,
            length: original.length,
            original,
            replacement,
            ...locate(lineStarts, absolute),
        });
    };

    const currentProsody = (): ProsodyState => {
        for (let index = stack.length - 1; index >= 0; index--) {
            if (stack[index].name === 'prosody') return stack[index].prosody;
        }
        return DEFAULT_PROSODY;
    };
    const textOnlyParent = (): OpenElement | null => {
        const top = stack[stack.length - 1];
        return top && TEXT_ONLY_TAGS.has(top.name) ? top : null;
    };

    // 本文の蓄積。タグに出会った時点で合成の単位へ確定する
    let pending = '';
    let pendingStart = 0;
    const flushText = (end: number) => {
        if (pending.length === 0) return;
        const parent = textOnlyParent();
        if (parent) {
            parent.content += pending;
        } else {
            runs.push({ kind: 'text', text: pending, prosody: currentProsody(), start: pendingStart, end });
        }
        pending = '';
    };

    let index = 0;
    // 構文が壊れて以降を解析できない場合に打ち切る
    let aborted = false;

    while (index < text.length && !aborted) {
        const candidate = matchTagCandidate(text, index);
        if (!candidate) {
            if (pending.length === 0) pendingStart = index;
            if (text[index] === '&') {
                const entity = /^&(lt|gt|amp|quot|apos);/.exec(text.slice(index, index + 6));
                if (entity) {
                    pending += ENTITIES[entity[1]];
                    index += entity[0].length;
                    continue;
                }
            }
            pending += text[index];
            index += 1;
            continue;
        }

        flushText(index);
        const tagStart = index;
        const name = candidate.name.toLowerCase() as ControlTagName;
        if (candidate.name !== name) fix('tagNameCase', candidate.nameStart, candidate.name, name);

        // 開始タグ・閉じタグの残り (属性と終端) を読む
        const attributes: ParsedAttribute[] = [];
        let cursor = candidate.nameEnd;
        let selfClosing = false;
        let tagEnd = -1;
        let tagBroken = false;

        while (cursor < text.length) {
            const char = text[cursor];
            if (isSpace(char)) {
                cursor += 1;
                continue;
            }
            if (char === '>') {
                tagEnd = cursor + 1;
                break;
            }
            if (char === '/') {
                if (text[cursor + 1] === '>' && !candidate.closing) {
                    selfClosing = true;
                    tagEnd = cursor + 2;
                    break;
                }
                issue('unexpectedChar', cursor, 1, { tag: name, value: char });
                tagBroken = true;
                cursor += 1;
                continue;
            }
            if (!isNameChar(char)) {
                issue('unexpectedChar', cursor, 1, { tag: name, value: char });
                tagBroken = true;
                cursor += 1;
                continue;
            }
            // 属性名
            const nameOffset = cursor;
            while (cursor < text.length && isNameChar(text[cursor])) cursor += 1;
            const attributeName = text.slice(nameOffset, cursor);
            while (cursor < text.length && isSpace(text[cursor])) cursor += 1;
            if (text[cursor] !== '=') {
                issue('missingEquals', nameOffset, attributeName.length, { tag: name, attribute: attributeName });
                tagBroken = true;
                continue;
            }
            cursor += 1;
            while (cursor < text.length && isSpace(text[cursor])) cursor += 1;
            const quote = text[cursor];
            if (quote !== '"' && quote !== "'" && quote !== OPEN_CURLY && quote !== CLOSE_CURLY) {
                // 引用符の無い値。次の空白か終端までを値として読み飛ばす
                const valueStart = cursor;
                while (cursor < text.length && !isSpace(text[cursor]) && text[cursor] !== '>') cursor += 1;
                issue('unquotedValue', valueStart, Math.max(1, cursor - valueStart), {
                    tag: name,
                    attribute: attributeName,
                });
                tagBroken = true;
                continue;
            }
            const curly = quote === OPEN_CURLY || quote === CLOSE_CURLY;
            if (curly) fix('curlyQuote', cursor, quote, '"');
            const valueOffset = cursor + 1;
            let valueEnd = valueOffset;
            const isClosingQuote = (value: string) =>
                curly ? value === CLOSE_CURLY || value === OPEN_CURLY || value === '"' : value === quote;
            while (valueEnd < text.length && !isClosingQuote(text[valueEnd])) valueEnd += 1;
            if (valueEnd >= text.length) {
                // 引用符が閉じられていないため、以降を解析できない
                issue('unclosedQuote', cursor, 1, { tag: name, attribute: attributeName });
                aborted = true;
                break;
            }
            const closingQuote = text[valueEnd];
            if (closingQuote === OPEN_CURLY || closingQuote === CLOSE_CURLY)
                fix('curlyQuote', valueEnd, closingQuote, '"');
            attributes.push({
                name: attributeName,
                value: decodeEntities(text.slice(valueOffset, valueEnd)),
                nameOffset,
                valueOffset,
            });
            cursor = valueEnd + 1;
        }
        if (aborted) break;
        if (tagEnd < 0) {
            issue('unclosedTag', tagStart, candidate.nameEnd - tagStart, { tag: name });
            aborted = true;
            break;
        }
        index = tagEnd;
        if (tagBroken) continue;

        if (candidate.closing) {
            if (attributes.length > 0) {
                issue('attributeOnClosingTag', tagStart, tagEnd - tagStart, { tag: name });
            }
            closeElement(name, tagStart, tagEnd);
            continue;
        }

        const validated = validateAttributes(name, attributes);
        const parent = textOnlyParent();
        if (parent) {
            issue('nestedTagNotAllowed', tagStart, tagEnd - tagStart, { tag: parent.name, value: name });
        }

        if (EMPTY_TAGS.has(name)) {
            // 単独で完結するタグ。終端の「/」が無くても補って受け入れる
            if (validated && !parent) {
                runs.push({ kind: 'break', ms: breakMilliseconds(validated), start: tagStart, end: tagEnd });
            }
            continue;
        }
        if (selfClosing) {
            issue('emptyContent', tagStart, tagEnd - tagStart, { tag: name });
            continue;
        }
        const prosody =
            name === 'prosody' && validated ? combineProsody(currentProsody(), validated) : currentProsody();
        const phAttribute = attributes.find(attribute => attribute.name.toLowerCase() === 'ph');
        stack.push({
            name,
            start: tagStart,
            contentStart: tagEnd,
            prosody,
            attributes: validated ?? {},
            content: '',
            invalid: validated === null || parent !== null,
            phOffset: phAttribute ? phAttribute.valueOffset : tagStart,
        });
    }

    if (!aborted) {
        flushText(text.length);
        for (const element of stack) {
            issue('missingClosingTag', element.start, element.contentStart - element.start, { tag: element.name });
        }
    }

    return { runs, errors, fixes };

    // --- 内部関数 (解析の状態を共有するためクロージャで定義する) ---

    function validateAttributes(tag: ControlTagName, attributes: ParsedAttribute[]): Record<string, string> | null {
        const allowed = TAG_ATTRIBUTES[tag];
        const result: Record<string, string> = {};
        let valid = true;
        for (const attribute of attributes) {
            const lower = attribute.name.toLowerCase();
            if (!allowed.includes(lower)) {
                issue('unknownAttribute', attribute.nameOffset, attribute.name.length, {
                    tag,
                    attribute: attribute.name,
                });
                valid = false;
                continue;
            }
            if (attribute.name !== lower) fix('attributeNameCase', attribute.nameOffset, attribute.name, lower);
            if (lower in result) {
                issue('duplicateAttribute', attribute.nameOffset, attribute.name.length, { tag, attribute: lower });
                valid = false;
                continue;
            }
            const format = checkValue(tag, lower, attribute.value);
            if (format) {
                issue('invalidValue', attribute.valueOffset, Math.max(1, attribute.value.length), {
                    tag,
                    attribute: lower,
                    value: attribute.value,
                    format,
                });
                valid = false;
                continue;
            }
            result[lower] = attribute.value;
        }
        // 必須属性
        const required: Partial<Record<ControlTagName, string>> = { sub: 'alias', phoneme: 'ph' };
        const requiredName = required[tag];
        const tagOffset = attributes.length > 0 ? attributes[0].nameOffset : 0;
        if (requiredName && !(requiredName in result) && !attributes.some(a => a.name.toLowerCase() === requiredName)) {
            issue('missingAttribute', tagOffset, 1, { tag, attribute: requiredName });
            valid = false;
        }
        if (tag === 'prosody' && attributes.length === 0) {
            issue('missingAttribute', tagOffset, 1, { tag, attribute: 'rate / pitch / volume' });
            valid = false;
        }
        if (tag === 'phoneme' && valid) {
            // 受け付ける表記は言語定義の表記だけで、alphabet を省略した場合もその表記として扱う
            const languageAlphabet = LANGUAGE_DEFINITIONS[options.language].phonemeAlphabet;
            const alphabet = result.alphabet ?? languageAlphabet;
            const alphabetAttribute = attributes.find(a => a.name.toLowerCase() === 'alphabet');
            const alphabetOffset = alphabetAttribute ? alphabetAttribute.valueOffset : tagOffset;
            if (alphabet !== languageAlphabet) {
                issue(alphabet === 'x-kana' ? 'accentNotJapanese' : 'ipaNotEnglish', alphabetOffset, alphabet.length, {
                    tag,
                });
                valid = false;
            } else {
                result.alphabet = alphabet;
            }
        }
        return valid ? result : null;
    }

    // 属性値の書式を確かめる。誤りがあれば期待する書式の種類を返す
    function checkValue(tag: ControlTagName, attribute: string, value: string): ValueFormat | null {
        switch (`${tag}.${attribute}`) {
            case 'break.time':
                return parseBreakTime(value) === null ? 'time' : null;
            case 'break.strength':
                return value.trim().toLowerCase() in BREAK_STRENGTHS ? null : 'strength';
            case 'prosody.rate':
                return parseRate(value) === null ? 'rate' : null;
            case 'prosody.pitch':
                return parsePitch(value) === null ? 'pitch' : null;
            case 'prosody.volume':
                return parseVolume(value) === null ? 'volume' : null;
            case 'phoneme.alphabet':
                return value === 'x-kana' || value === 'ipa' ? null : 'alphabet';
            case 'sub.alias':
            case 'phoneme.ph':
                return value.trim().length === 0 ? 'nonEmpty' : null;
            default:
                return null;
        }
    }

    function breakMilliseconds(attributes: Record<string, string>): number {
        // time と strength の両方がある場合は time を優先する (SSML の規定)
        if (attributes.time !== undefined) return parseBreakTime(attributes.time) ?? 0;
        if (attributes.strength !== undefined) return BREAK_STRENGTHS[attributes.strength.trim().toLowerCase()];
        return BREAK_STRENGTHS.medium;
    }

    function combineProsody(base: ProsodyState, attributes: Record<string, string>): ProsodyState {
        const rate = attributes.rate !== undefined ? (parseRate(attributes.rate) ?? 1) : 1;
        const pitch = attributes.pitch !== undefined ? (parsePitch(attributes.pitch) ?? 0) : 0;
        const volume = attributes.volume !== undefined ? (parseVolume(attributes.volume) ?? 0) : 0;
        return {
            rate: base.rate * rate,
            pitch: base.pitch + pitch,
            volume: base.volume <= SILENT_DB || volume <= SILENT_DB ? SILENT_DB : base.volume + volume,
        };
    }

    function closeElement(name: ControlTagName, tagStart: number, tagEnd: number) {
        const position = findOpen(name);
        if (position < 0) {
            issue('unmatchedClosingTag', tagStart, tagEnd - tagStart, { tag: name });
            return;
        }
        if (position !== stack.length - 1) {
            // 入れ子の不整合。内側の要素を閉じ忘れたものとして扱い、対応する要素まで閉じる
            const inner = stack[stack.length - 1];
            issue('misnested', tagStart, tagEnd - tagStart, { tag: name, expected: inner.name });
            stack.length = position + 1;
        }
        const element = stack.pop() as OpenElement;
        finishElement(element, tagEnd);
    }

    function findOpen(name: ControlTagName): number {
        for (let index = stack.length - 1; index >= 0; index--) {
            if (stack[index].name === name) return index;
        }
        return -1;
    }

    function finishElement(element: OpenElement, end: number) {
        if (!TEXT_ONLY_TAGS.has(element.name)) return;
        const surface = element.content;
        const parentInvalid = element.invalid;
        if (surface.trim().length === 0) {
            issue('emptyContent', element.start, element.contentStart - element.start, { tag: element.name });
            return;
        }
        if (parentInvalid) return;
        if (element.name === 'sub') {
            runs.push({
                kind: 'sub',
                alias: element.attributes.alias,
                surface,
                prosody: element.prosody,
                start: element.start,
                end,
            });
            return;
        }
        const ph = element.attributes.ph;
        if (element.attributes.alphabet === 'x-kana') {
            const parsed = parseAccentNotation(ph.trim());
            if (!parsed.ok) {
                const leading = ph.length - ph.trimStart().length;
                issue('accentSyntax', element.phOffset + leading + parsed.error.offset, parsed.error.length, {
                    tag: 'phoneme',
                    value: parsed.error.text,
                    accentCode: parsed.error.code,
                });
                return;
            }
            runs.push({
                kind: 'phoneme',
                alphabet: 'x-kana',
                surface,
                kataTone: accentToKataTone(parsed.phrases),
                reading: accentReading(ph.trim()),
                prosody: element.prosody,
                start: element.start,
                end,
            });
            return;
        }
        const parsed = parseIpa(ph);
        if (!parsed.ok) {
            issue('ipaSymbol', element.phOffset + parsed.offset, 1, { tag: 'phoneme', value: parsed.symbol });
            return;
        }
        const surfaceWords = surface.trim().split(/\s+/);
        if (surfaceWords.length !== parsed.words.length) {
            issue('ipaWordCount', element.phOffset, Math.max(1, ph.length), {
                tag: 'phoneme',
                value: String(parsed.words.length),
                expected: String(surfaceWords.length),
            });
            return;
        }
        runs.push({
            kind: 'phoneme',
            alphabet: 'ipa',
            surface,
            words: parsed.words,
            prosody: element.prosody,
            start: element.start,
            end,
        });
    }
}

// 一括修正を適用した文章を返す (後ろから置き換えて位置がずれないようにする)
export function applyTagFixes(text: string, fixes: TagFix[], baseOffset = 0): string {
    const sorted = [...fixes].sort((a, b) => b.offset - a.offset);
    let result = text;
    for (const item of sorted) {
        const offset = item.offset - baseOffset;
        if (offset < 0 || offset + item.length > result.length) continue;
        result = result.slice(0, offset) + item.replacement + result.slice(offset + item.length);
    }
    return result;
}

// 制御タグとして解釈される範囲 (エディタの色分け用)。誤りの有無にかかわらず候補の範囲を返す
export function findTagRanges(text: string): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    let index = 0;
    while (index < text.length) {
        const candidate = matchTagCandidate(text, index);
        if (!candidate) {
            index += 1;
            continue;
        }
        let cursor = candidate.nameEnd;
        let quote: string | null = null;
        while (cursor < text.length) {
            const char = text[cursor];
            if (quote) {
                if (char === quote || (quote === OPEN_CURLY && char === CLOSE_CURLY)) quote = null;
            } else if (char === '"' || char === "'" || char === OPEN_CURLY) {
                quote = char;
            } else if (char === '>') {
                break;
            }
            cursor += 1;
        }
        const end = Math.min(text.length, cursor + 1);
        ranges.push({ start: index, end });
        index = end;
    }
    return ranges;
}
