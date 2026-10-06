// 読み上げのタイミング指定 (行ごとに開始時間・終了時間・テキストを持つ表) の時間の扱い・検証・字幕ファイルとの変換。
// 字幕ファイルは読み込むときに表へ展開し、元の形式は覚えない (保存は常に SRT)。

import type { TimedLine } from './types';

// --- 時間 ---

// 時間の入力を秒にする。「時:分:秒.ミリ秒」「分:秒.ミリ秒」「秒.ミリ秒」を受け付ける
// (小数点は「.」「,」のどちらでもよい。時・分のある形では、分と秒は 59 まで)。読めなければ null
export function parseTimeInput(value: string): number | null {
    const match = /^\s*(?:(?:(\d+):)?(\d+):)?(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(value);
    if (!match) return null;
    const [, hours, minutes, seconds, fraction] = match;
    if (minutes !== undefined && Number(seconds) > 59) return null;
    if (hours !== undefined && Number(minutes) > 59) return null;
    const total =
        Number(hours ?? 0) * 3600 +
        Number(minutes ?? 0) * 60 +
        Number(seconds) +
        Number((fraction ?? '').padEnd(3, '0')) / 1000;
    return Math.round(total * 1000) / 1000;
}

// 秒を「HH:MM:SS.mmm」で表す
export function formatTimestamp(seconds: number): string {
    const total = Math.max(0, Math.round(seconds * 1000));
    const ms = total % 1000;
    const s = Math.floor(total / 1000) % 60;
    const m = Math.floor(total / 60000) % 60;
    const h = Math.floor(total / 3600000);
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

// --- 検証 ---

// タイミング指定の行の誤り。row は 1 始まりの行番号
export type TimedLineIssueCode =
    // 開始・終了時間を時間として読めない
    | 'startFormat'
    | 'endFormat'
    // 終了時間が開始時間と同じか前
    | 'endBeforeStart'
    // 開始時間が、後ろの行の開始時間より後 (行の並びと時間の前後が逆転している)
    | 'startAfterLater'
    // テキストが空
    | 'emptyText';

export type TimedLineIssue = { row: number; code: TimedLineIssueCode };

// 行の時間 (読めない場合は null) とテキストを確かめ、行ごとの誤りを返す
export function validateTimedLines(
    lines: { start: number | null; end: number | null; text: string }[]
): TimedLineIssue[] {
    const issues: TimedLineIssue[] = [];
    // 各行より後ろの行の、最も早い開始時間
    const laterMin: number[] = new Array(lines.length).fill(Infinity);
    for (let i = lines.length - 2; i >= 0; i--) {
        const next = lines[i + 1].start;
        laterMin[i] = Math.min(laterMin[i + 1], next ?? Infinity);
    }
    lines.forEach((line, index) => {
        const row = index + 1;
        if (line.start === null) issues.push({ row, code: 'startFormat' });
        if (line.end === null) issues.push({ row, code: 'endFormat' });
        if (line.start !== null && line.end !== null && line.end <= line.start) {
            issues.push({ row, code: 'endBeforeStart' });
        }
        if (line.start !== null && line.start > laterMin[index]) issues.push({ row, code: 'startAfterLater' });
        if (!line.text.trim()) issues.push({ row, code: 'emptyText' });
    });
    return issues;
}

// --- 字幕ファイルの読み込み ---

// 読み込める字幕の形式 (拡張子)
export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa', 'sbv'];

type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'sbv';

export function subtitleFormatOf(filePath: string): SubtitleFormat | null {
    const ext = /\.([^.\\/]+)$/.exec(filePath)?.[1]?.toLowerCase() ?? '';
    if (ext === 'srt' || ext === 'vtt' || ext === 'sbv') return ext;
    if (ext === 'ass' || ext === 'ssa') return 'ass';
    return null;
}

// 字幕の時刻 (「00:01:02,345」「00:01:02.345」「1:02.345」、ASS の「0:01:02.34」)
const TIMESTAMP = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})`;
const TIMING_LINE = new RegExp(String.raw`^\s*${TIMESTAMP}\s*-->\s*${TIMESTAMP}`);
const SBV_TIMING_LINE = new RegExp(String.raw`^\s*${TIMESTAMP}\s*,\s*${TIMESTAMP}\s*$`);

function toSeconds(hours: string | undefined, minutes: string, seconds: string, fraction: string): number {
    const total =
        Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000;
    return Math.round(total * 1000) / 1000;
}

// 字幕の装飾 (SRT・WebVTT の書式タグと、WebVTT の文字の参照) を除く。読み上げの制御タグ (break・prosody・sub・phoneme) は残す
function stripFormatting(text: string): string {
    return text
        .replace(/<\/?(?:i|b|u|s|font|c|v|lang|ruby|rt|span)(?:[.\s][^>]*)?>/gi, '')
        .replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, '')
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

// 本文の行を整える (前後の空白と空の行を除く)
function cleanText(lines: string[]): string {
    return lines
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
}

export type SubtitleFileResult = {
    lines: TimedLine[];
    // 時刻を読めずに読み飛ばした区間の数
    skipped: number;
};

// 字幕ファイルの内容 (改行は LF) を、タイミング指定の行にする
export function parseSubtitleFile(text: string, format: SubtitleFormat): SubtitleFileResult {
    const content = text.replace(/^\uFEFF/, '');
    if (format === 'ass') return parseAss(content);
    return parseBlocks(content, format);
}

// SRT・WebVTT・SBV (空行で区切ったブロックごとに、時刻の行と本文)
function parseBlocks(text: string, format: 'srt' | 'vtt' | 'sbv'): SubtitleFileResult {
    const blocks = text.split(/\n\s*\n/);
    const lines: TimedLine[] = [];
    let skipped = 0;
    blocks.forEach((block, blockIndex) => {
        const rows = block.split('\n').filter(row => row.trim() !== '');
        if (rows.length === 0) return;
        // WebVTT のヘッダー (先頭のブロック) と、本文ではないブロックは読み飛ばす
        if (format === 'vtt' && blockIndex === 0 && rows[0].startsWith('WEBVTT')) return;
        if (format === 'vtt' && /^(NOTE|STYLE|REGION)(\s|$)/.test(rows[0])) return;
        const pattern = format === 'sbv' ? SBV_TIMING_LINE : TIMING_LINE;
        // 時刻の行の前に番号 (SRT) や識別子 (WebVTT) の行がある
        const timingIndex = rows.findIndex(row => pattern.test(row));
        if (timingIndex < 0 || timingIndex > 1) {
            skipped += 1;
            return;
        }
        const timing = pattern.exec(rows[timingIndex]);
        if (!timing) {
            skipped += 1;
            return;
        }
        const body = cleanText(stripFormatting(rows.slice(timingIndex + 1).join('\n')).split('\n'));
        lines.push({
            start: toSeconds(timing[1], timing[2], timing[3], timing[4]),
            end: toSeconds(timing[5], timing[6], timing[7], timing[8]),
            text: body,
        });
    });
    return { lines, skipped };
}

// ASS・SSA ([Events] の Format の並びに従って Dialogue の行を読む)
function parseAss(text: string): SubtitleFileResult {
    const lines: TimedLine[] = [];
    let skipped = 0;
    let inEvents = false;
    let fields: string[] = [];
    for (const raw of text.split('\n')) {
        const row = raw.trim();
        if (/^\[.*\]$/.test(row)) {
            inEvents = row.toLowerCase() === '[events]';
            continue;
        }
        if (!inEvents) continue;
        const separator = row.indexOf(':');
        if (separator < 0) continue;
        const kind = row.slice(0, separator).trim().toLowerCase();
        const value = row.slice(separator + 1).trim();
        if (kind === 'format') {
            fields = value.split(',').map(field => field.trim().toLowerCase());
            continue;
        }
        if (kind !== 'dialogue') continue;
        const startIndex = fields.indexOf('start');
        const endIndex = fields.indexOf('end');
        const textIndex = fields.indexOf('text');
        // 本文は最後の項目 (本文の中の「,」で分けないよう、項目の数で区切る)
        const values = value.split(',');
        const head = values.slice(0, fields.length - 1);
        const body = values.slice(fields.length - 1).join(',');
        const start = startIndex >= 0 ? new RegExp(`^${TIMESTAMP}$`).exec(head[startIndex]?.trim() ?? '') : null;
        const end = endIndex >= 0 ? new RegExp(`^${TIMESTAMP}$`).exec(head[endIndex]?.trim() ?? '') : null;
        if (!start || !end || textIndex !== fields.length - 1) {
            skipped += 1;
            continue;
        }
        const plain = stripFormatting(body)
            .replace(/\\[Nn]/g, '\n')
            .replace(/\\h/g, ' ');
        lines.push({
            start: toSeconds(start[1], start[2], start[3], start[4]),
            end: toSeconds(end[1], end[2], end[3], end[4]),
            text: cleanText(plain.split('\n')),
        });
    }
    return { lines, skipped };
}

// --- 保存 (SRT) ---

function srtTimestamp(seconds: number): string {
    return formatTimestamp(seconds).replace('.', ',');
}

// タイミング指定の行を SRT にする。本文の空の行は区間の区切りと解釈されるため除く
export function formatSrt(lines: TimedLine[]): string {
    return lines
        .map((line, index) =>
            [
                String(index + 1),
                `${srtTimestamp(line.start)} --> ${srtTimestamp(line.end)}`,
                cleanText(line.text.split('\n')),
            ].join('\n')
        )
        .join('\n\n')
        .concat(lines.length > 0 ? '\n' : '');
}
