// 複数のファイルの ASS 字幕を 1 つにつなげる (時刻は呼び出す前に結合後の位置へずらしておく)。
// 1 つ目のファイルの見出し ([Script Info]) を使い、ほかのファイルの内容は次のように合わせて足す
// - 座標の基準 (PlayResX / PlayResY) が違う場合は、スタイルとイベントの大きさ・位置を 1 つ目の基準へ換算する
// - 同じ名前で中身の違うスタイルは、名前に「 (ファイルの番号)」を付けて別のスタイルとして残す
// - 埋め込みのフォント・画像 ([Fonts] / [Graphics]) も残す

export type AssPart = {
    // ファイルの番号 (1 から。名前を付け直すときに使う)
    file: number;
    content: string;
};

// name は小文字にそろえた見出し (探すため)、header は元の見出し (書き戻すため)
type Section = { name: string; header: string; lines: string[] };

// 座標の基準が書かれていない場合の既定 (libass と同じ)
const DEFAULT_PLAY_RES = { x: 384, y: 288 };

function parseSections(content: string): Section[] {
    const sections: Section[] = [];
    let current: Section = { name: '', header: '', lines: [] };
    sections.push(current);
    for (const line of content.split(/\r?\n/)) {
        const match = /^\[(.+)\]\s*$/.exec(line.trim());
        if (match) {
            current = { name: match[1].toLowerCase(), header: match[1], lines: [] };
            sections.push(current);
        } else {
            current.lines.push(line);
        }
    }
    return sections;
}

function section(sections: Section[], name: string): Section | undefined {
    return sections.find(item => item.name === name);
}

function stylesSection(sections: Section[]): Section | undefined {
    return section(sections, 'v4+ styles') ?? section(sections, 'v4 styles');
}

// 座標の基準。片方しか無い場合は 4:3 として補う (libass と同じ)
function playRes(sections: Section[]): { x: number; y: number } {
    const info = section(sections, 'script info');
    const value = (key: string) => {
        const line = info?.lines.find(item => item.toLowerCase().startsWith(`${key.toLowerCase()}:`));
        const number = line ? Number(line.slice(line.indexOf(':') + 1).trim()) : NaN;
        return Number.isFinite(number) && number > 0 ? number : null;
    };
    const x = value('PlayResX');
    const y = value('PlayResY');
    if (x && y) return { x, y };
    if (x) return { x, y: Math.round((x * 3) / 4) };
    if (y) return { x: Math.round((y * 4) / 3), y };
    return DEFAULT_PLAY_RES;
}

// Format 行の項目名 (小文字) の並び
function formatOf(lines: string[], fallback: string[]): string[] {
    const line = lines.find(item => item.startsWith('Format:'));
    return line
        ? line
              .slice('Format:'.length)
              .split(',')
              .map(item => item.trim().toLowerCase())
        : fallback;
}

// 「種類: 値,値,...」の行を項目に分ける (最後の項目 (Text) はカンマを含みうるため残りをすべて入れる)
function splitFields(line: string, count: number): { kind: string; fields: string[] } {
    const colon = line.indexOf(':');
    const kind = line.slice(0, colon);
    const rest = line.slice(colon + 1).replace(/^\s/, '');
    const fields: string[] = [];
    let remaining = rest;
    for (let i = 0; i < count - 1; i++) {
        const comma = remaining.indexOf(',');
        if (comma < 0) break;
        fields.push(remaining.slice(0, comma));
        remaining = remaining.slice(comma + 1);
    }
    fields.push(remaining);
    return { kind, fields };
}

const STYLE_FORMAT = [
    'name',
    'fontname',
    'fontsize',
    'primarycolour',
    'secondarycolour',
    'outlinecolour',
    'backcolour',
    'bold',
    'italic',
    'underline',
    'strikeout',
    'scalex',
    'scaley',
    'spacing',
    'angle',
    'borderstyle',
    'outline',
    'shadow',
    'alignment',
    'marginl',
    'marginr',
    'marginv',
    'encoding',
];
const EVENT_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

function scaleNumber(value: string, factor: number): string {
    const number = Number(value);
    if (!Number.isFinite(number) || factor === 1) return value;
    const scaled = Math.round(number * factor * 100) / 100;
    return String(scaled);
}

// 上書きタグとベクター描画の大きさ・位置を換算する
function scaleText(text: string, sx: number, sy: number): string {
    if (sx === 1 && sy === 1) return text;
    const num = (value: string, factor: number) => scaleNumber(value.trim(), factor);
    let drawing = false;
    // { } の中 (タグ) と外 (文字・描画) に分けて処理する
    return text.replace(/(\{[^}]*\})|([^{]+)/g, (_all, tags: string | undefined, plain: string | undefined) => {
        if (tags) {
            const scaled = tags
                .replace(/\\pos\(([^,]+),([^)]+)\)/g, (_m, x, y) => `\\pos(${num(x, sx)},${num(y, sy)})`)
                .replace(/\\org\(([^,]+),([^)]+)\)/g, (_m, x, y) => `\\org(${num(x, sx)},${num(y, sy)})`)
                .replace(
                    /\\move\(([^,]+),([^,]+),([^,]+),([^,)]+)((?:,[^,)]+){0,2})\)/g,
                    (_m, x1, y1, x2, y2, times) =>
                        `\\move(${num(x1, sx)},${num(y1, sy)},${num(x2, sx)},${num(y2, sy)}${times})`
                )
                .replace(
                    /\\(i?clip)\(([^,()]+),([^,()]+),([^,()]+),([^,()]+)\)/g,
                    (_m, name, x1, y1, x2, y2) =>
                        `\\${name}(${num(x1, sx)},${num(y1, sy)},${num(x2, sx)},${num(y2, sy)})`
                )
                .replace(/\\fs(\d+(?:\.\d+)?)/g, (_m, size) => `\\fs${num(size, sy)}`)
                .replace(/\\fsp(-?\d+(?:\.\d+)?)/g, (_m, size) => `\\fsp${num(size, sx)}`)
                .replace(/\\(x?bord|y?bord|x?shad|y?shad)(-?\d+(?:\.\d+)?)/g, (_m, name: string, size) => {
                    const factor = name.startsWith('x') ? sx : sy;
                    return `\\${name}${num(size, factor)}`;
                });
            const mode = /\\p(\d+)/.exec(tags);
            if (mode) drawing = Number(mode[1]) > 0;
            return scaled;
        }
        if (!plain || !drawing) return plain ?? '';
        // 描画の命令の座標は x, y の順に並ぶ
        let axis = 0;
        return plain.replace(/-?\d+(?:\.\d+)?/g, value => num(value, axis++ % 2 === 0 ? sx : sy));
    });
}

export function combineAss(parts: AssPart[]): string {
    const [base, ...rest] = parts.map(part => ({ file: part.file, sections: parseSections(part.content) }));
    const baseRes = playRes(base.sections);
    const baseStyles = stylesSection(base.sections);
    const styleFormat = formatOf(baseStyles?.lines ?? [], STYLE_FORMAT);
    const baseEvents = section(base.sections, 'events');
    const eventFormat = formatOf(baseEvents?.lines ?? [], EVENT_FORMAT);
    const index = (format: string[], key: string) => format.indexOf(key);

    // スタイルの名前と中身 (名前以外の項目)
    const definitions = new Map<string, string>();
    for (const line of baseStyles?.lines ?? []) {
        if (!line.startsWith('Style:')) continue;
        const { fields } = splitFields(line, styleFormat.length);
        definitions.set(
            fields[index(styleFormat, 'name')],
            fields.filter((_, i) => i !== index(styleFormat, 'name')).join(',')
        );
    }

    const addedStyles: string[] = [];
    const addedEvents: string[] = [];
    const extraSections: Section[] = [];
    for (const part of rest) {
        const res = playRes(part.sections);
        const sx = baseRes.x / res.x;
        const sy = baseRes.y / res.y;
        const partStyles = stylesSection(part.sections);
        const partStyleFormat = formatOf(partStyles?.lines ?? [], STYLE_FORMAT);
        // このファイルのスタイル名 -> 結合後のスタイル名
        const renamed = new Map<string, string>();
        for (const line of partStyles?.lines ?? []) {
            if (!line.startsWith('Style:')) continue;
            const { fields } = splitFields(line, partStyleFormat.length);
            // 1 つ目の項目の並びにそろえる
            const byKey = new Map(partStyleFormat.map((key, i) => [key, fields[i] ?? '']));
            for (const [key, factor] of [
                ['fontsize', sy],
                ['outline', sy],
                ['shadow', sy],
                ['spacing', sx],
                ['marginl', sx],
                ['marginr', sx],
                ['marginv', sy],
            ] as const) {
                if (byKey.has(key)) byKey.set(key, scaleNumber(byKey.get(key) as string, factor));
            }
            const name = byKey.get('name') ?? 'Default';
            const ordered = styleFormat.map(key => byKey.get(key) ?? '');
            const definition = ordered.filter((_, i) => i !== index(styleFormat, 'name')).join(',');
            const existing = definitions.get(name);
            if (existing === definition) {
                renamed.set(name, name);
                continue;
            }
            const finalName = existing === undefined ? name : `${name} (${part.file})`;
            definitions.set(finalName, definition);
            renamed.set(name, finalName);
            ordered[index(styleFormat, 'name')] = finalName;
            addedStyles.push(`Style: ${ordered.join(',')}`);
        }

        const partEvents = section(part.sections, 'events');
        const partEventFormat = formatOf(partEvents?.lines ?? [], EVENT_FORMAT);
        for (const line of partEvents?.lines ?? []) {
            if (!/^(Dialogue|Comment):/.test(line)) continue;
            const { kind, fields } = splitFields(line, partEventFormat.length);
            const byKey = new Map(partEventFormat.map((key, i) => [key, fields[i] ?? '']));
            const style = byKey.get('style') ?? 'Default';
            byKey.set('style', renamed.get(style) ?? style);
            for (const [key, factor] of [
                ['marginl', sx],
                ['marginr', sx],
                ['marginv', sy],
            ] as const) {
                if (byKey.has(key)) byKey.set(key, scaleNumber(byKey.get(key) as string, factor));
            }
            byKey.set('text', scaleText(byKey.get('text') ?? '', sx, sy));
            addedEvents.push(`${kind}: ${eventFormat.map(key => byKey.get(key) ?? '').join(',')}`);
        }

        // 埋め込みのフォント・画像は、そのまま後ろに足す
        for (const name of ['fonts', 'graphics']) {
            const embedded = section(part.sections, name);
            if (embedded && embedded.lines.some(line => line.trim())) extraSections.push(embedded);
        }
    }

    // 1 つ目の内容に足して書き戻す
    const out: string[] = [];
    for (const item of base.sections) {
        if (item.header) out.push(`[${item.header}]`);
        const lines = [...item.lines];
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
        if (item === baseStyles) lines.push(...addedStyles);
        if (item === baseEvents) lines.push(...addedEvents);
        out.push(...lines, '');
    }
    for (const name of ['fonts', 'graphics']) {
        const added = extraSections.filter(item => item.name === name);
        if (added.length === 0) continue;
        const existing = out.findIndex(line => line.toLowerCase() === `[${name}]`);
        const lines = added.flatMap(item => item.lines.filter(line => line.trim()));
        if (existing >= 0) {
            out.splice(existing + 1, 0, ...lines);
        } else {
            out.push(`[${added[0].header}]`, ...lines, '');
        }
    }
    return out.join('\n').replace(/\n+$/, '') + '\n';
}
