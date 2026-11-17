import path from 'path';

// クリーンアップの対象外パターン (利用者が指定するディレクトリ・ファイル) の判定。
// 走査ワーカー (worker_threads) からも読み込むため、このモジュールは electron に依存しない。
//
// パターンは 1 個ずつ次のように扱う。
// - 区切り文字 (/。Windows では \ も) を含まないものは、エントリの名前と照合する (どの階層でも一致する)
// - 区切り文字を含むものは、エントリのフルパスと照合する (末尾の区切り文字は無視する)
// - ワイルドカード: * は区切り文字を除く任意の文字列、** は区切り文字を含む任意の文字列、? は区切り文字を除く任意の 1 文字
// - 大文字と小文字は、ファイルシステムの既定に合わせて Windows と macOS では区別せず、それ以外では区別する
// - ディレクトリのパターンに限り、末尾に「/(?=名前)」「/(?!名前)」を 1 個以上続けて、直下の中身を条件にできる
//   (例: vendor/(?=autoload.php)(?!hogehoge))。(?=名前) はその名前のファイルかディレクトリが直下にあること、
//   (?!名前) は無いことを表し、すべてを満たすときだけ一致する。名前にはワイルドカードを使える

const IS_WINDOWS = process.platform === 'win32';
const CASE_INSENSITIVE = IS_WINDOWS || process.platform === 'darwin';
const REGEXP_FLAGS = CASE_INSENSITIVE ? 'iu' : 'u';

// 直下の中身を条件にする対象外 (例: vendor/(?=autoload.php))
export type ContentsCondition = {
    // 対象外にするディレクトリ自体のパターン
    target: RegExp;
    // target をフルパスと照合するか (false は名前と照合する)
    byPath: boolean;
    // 直下にあるべきもの (すべて必要) と、直下にあってはならないもの
    present: RegExp[];
    absent: RegExp[];
};

// 照合用にまとめた正規表現。走査ワーカーへ渡す設定に含めるため、構造化複製できるデータと RegExp だけで構成する
export type ExclusionRule = {
    // 名前と照合するパターンをまとめたもの (無ければ null)
    names: RegExp | null;
    // フルパス (区切り文字を / にそろえたもの) と照合するパターンをまとめたもの (無ければ null)
    paths: RegExp | null;
    // 直下の中身を条件にするもの (ディレクトリのパターンのみ)
    contents: ContentsCondition[];
};

// 区切り文字を / にそろえる
function toSlashes(value: string): string {
    return IS_WINDOWS ? value.replace(/\\/g, '/') : value;
}

// ワイルドカードを正規表現の断片へ変換する。ワイルドカード以外の文字はすべて文字どおりに一致させる
function wildcardToRegExpSource(pattern: string): string {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                // 3 個以上続く * も ** と同じに扱う
                while (pattern[i + 1] === '*') i++;
                source += '.*';
            } else {
                source += '[^/]*';
            }
        } else if (ch === '?') {
            source += '[^/]';
        } else {
            source += ch.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
        }
    }
    return source;
}

function combine(sources: string[]): RegExp | null {
    if (sources.length === 0) return null;
    return new RegExp(`^(?:${sources.join('|')})$`, REGEXP_FLAGS);
}

function wildcardToRegExp(pattern: string): RegExp {
    return new RegExp(`^${wildcardToRegExpSource(pattern)}$`, REGEXP_FLAGS);
}

// 区切り文字を含むかどうかで、名前とフルパスのどちらと照合するかを決める
function isPathPattern(pattern: string): boolean {
    return pattern.includes('/');
}

// 末尾の区切り文字は無視する (ルートだけを表す "/" はそのまま残す)
function trimTrailingSlashes(pattern: string): string {
    return pattern.length > 1 ? pattern.replace(/\/+$/, '') : pattern;
}

// 中身の条件の始まり ("/(?=" か "/(?!")
const CONTENTS_START = /\/\(\?[=!]/;
// 中身の条件 1 個。名前は次の条件の始まりか末尾の直前の ")" までとし、名前の中の括弧 (例: f(1).txt) も受け付ける
const CONTENTS_GROUP = /\(\?([=!])(.+?)\)(?=\(\?[=!]|$)/y;

// "対象/(?=名前)(?!名前)..." の形なら中身の条件として分解する。形が崩れているものは null (通常のパターンとして扱う)
function parseContentsCondition(pattern: string): ContentsCondition | null {
    const start = pattern.search(CONTENTS_START);
    if (start <= 0) return null;
    const target = trimTrailingSlashes(pattern.slice(0, start));
    const conditions = pattern.slice(start + 1);
    const present: RegExp[] = [];
    const absent: RegExp[] = [];
    let index = 0;
    while (index < conditions.length) {
        CONTENTS_GROUP.lastIndex = index;
        const match = CONTENTS_GROUP.exec(conditions);
        if (!match) return null;
        const name = match[2].trim();
        // 条件にできるのは直下にあるものだけ
        if (name.length === 0 || name.includes('/')) return null;
        (match[1] === '=' ? present : absent).push(wildcardToRegExp(name));
        index = CONTENTS_GROUP.lastIndex;
    }
    return { target: wildcardToRegExp(target), byPath: isPathPattern(target), present, absent };
}

// 対象外パターンの並びを照合用にまとめる。有効なパターンが無ければ null を返す。
// allowContents はディレクトリのパターンのとき true にする (中身の条件を受け付ける)
export function buildExclusionRule(
    patterns: readonly unknown[] | undefined,
    allowContents: boolean
): ExclusionRule | null {
    const names: string[] = [];
    const paths: string[] = [];
    const contents: ContentsCondition[] = [];
    for (const raw of patterns ?? []) {
        if (typeof raw !== 'string') continue;
        const pattern = toSlashes(raw.trim());
        if (pattern.length === 0) continue;
        const condition = allowContents ? parseContentsCondition(pattern) : null;
        if (condition) {
            contents.push(condition);
        } else if (isPathPattern(pattern)) {
            paths.push(wildcardToRegExpSource(trimTrailingSlashes(pattern)));
        } else {
            names.push(wildcardToRegExpSource(pattern));
        }
    }
    if (names.length === 0 && paths.length === 0 && contents.length === 0) return null;
    return { names: combine(names), paths: combine(paths), contents };
}

// エントリが対象外かどうか (中身の条件は除く)。name はエントリの名前、entryPath はフルパス
export function isExcludedEntry(rule: ExclusionRule | null, name: string, entryPath: string): boolean {
    if (!rule) return false;
    if (rule.names?.test(name)) return true;
    return rule.paths !== null && rule.paths.test(toSlashes(entryPath));
}

// ディレクトリが直下の中身によって対象外になるかどうか。entries はそのディレクトリを読んだ結果
export function isExcludedByContents(
    rule: ExclusionRule | null,
    dirPath: string,
    entries: readonly { name: string }[]
): boolean {
    if (!rule || rule.contents.length === 0) return false;
    let dirName: string | undefined;
    let slashedPath: string | undefined;
    const hasEntry = (pattern: RegExp) => entries.some(entry => pattern.test(entry.name));
    for (const condition of rule.contents) {
        const subject = condition.byPath ? (slashedPath ??= toSlashes(dirPath)) : (dirName ??= path.basename(dirPath));
        if (!condition.target.test(subject)) continue;
        if (condition.present.every(hasEntry) && !condition.absent.some(hasEntry)) return true;
    }
    return false;
}
