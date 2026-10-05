// SRT / WebVTT の解析。読み上げのタイムライン入力に使う。
// 編集画面上の文章 (改行は LF に統一済み) をそのまま解析し、各区間の本文が文書中のどこにあるかを返す
// (制御タグの誤りの位置を文書全体の行と文字位置で示すため)。
// 書式の誤りは制御タグの誤りと同じ形 (TagIssue) で返し、制御タグの誤りとまとめて扱えるようにする。

import type { TagErrorCode, TagIssue } from './control-tags';

type SubtitleFormat = 'srt' | 'vtt';

export type SubtitleCue = {
    // 1 始まりの通し番号 (表示用。ファイル中の番号ではなく並び順)
    index: number;
    // 秒
    start: number;
    end: number;
    // 本文 (複数行の場合は改行を含む)
    text: string;
    // 本文の文書中の位置
    textOffset: number;
    // 時刻行の 1 始まりの行番号
    line: number;
};

type SubtitleParseResult = {
    cues: SubtitleCue[];
    errors: TagIssue[];
};

// 「00:01:02,345」「00:01:02.345」「01:02.345」のいずれも受け付ける
const TIMESTAMP = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})`;
const TIMING_LINE = new RegExp(`^\\s*${TIMESTAMP}\\s*-->\\s*${TIMESTAMP}(.*)$`);

function toSeconds(hours: string | undefined, minutes: string, seconds: string, fraction: string): number {
    return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000;
}

export function parseSubtitles(text: string, format: SubtitleFormat): SubtitleParseResult {
    const cues: SubtitleCue[] = [];
    const errors: TagIssue[] = [];
    const lines = text.split('\n');
    // 各行の文書中の開始位置
    const lineOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        lineOffsets.push(offset);
        offset += line.length + 1;
    }
    // 書式の誤りは行単位で示す (lineIndex は 0 始まりの行番号。位置は行頭)
    const issue = (code: TagErrorCode, lineIndex: number, length: number) => {
        errors.push({
            code,
            offset: lineOffsets[lineIndex] ?? 0,
            length: Math.max(1, length),
            line: lineIndex + 1,
            column: 1,
        });
    };

    let index = 0;
    if (format === 'vtt') {
        // 先頭の BOM と空行を除いた最初の行が WEBVTT で始まること
        while (index < lines.length && lines[index].trim() === '') index += 1;
        if (index >= lines.length || !lines[index].replace(/^\uFEFF/, '').startsWith('WEBVTT')) {
            issue('subtitleHeader', Math.min(index, lines.length - 1), 1);
            return { cues, errors };
        }
        // ヘッダーの行 (Kind: / Language: など) は最初の空行まで続く
        while (index < lines.length && lines[index].trim() !== '') index += 1;
    }

    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === '') {
            index += 1;
            continue;
        }
        // VTT の NOTE / STYLE / REGION ブロックは本文ではないため読み飛ばす
        if (format === 'vtt' && /^(NOTE|STYLE|REGION)(\s|$)/.test(line)) {
            while (index < lines.length && lines[index].trim() !== '') index += 1;
            continue;
        }
        let timingIndex = index;
        if (!line.includes('-->')) {
            // 番号 (SRT) や識別子 (VTT) の行。次の行が時刻行
            timingIndex = index + 1;
        }
        const timing = timingIndex < lines.length ? TIMING_LINE.exec(lines[timingIndex]) : null;
        if (!timing) {
            const errorLine = timingIndex < lines.length ? timingIndex : index;
            issue('subtitleTimestamp', errorLine, lines[errorLine]?.length ?? 1);
            // 次の空行まで読み飛ばして続きを解析する
            index = timingIndex + 1;
            while (index < lines.length && lines[index].trim() !== '') index += 1;
            continue;
        }
        const start = toSeconds(timing[1], timing[2], timing[3], timing[4]);
        const end = toSeconds(timing[5], timing[6], timing[7], timing[8]);
        if (end <= start) {
            issue('subtitleOrder', timingIndex, lines[timingIndex].length);
        }
        // 区間は開始時刻の順に並んでいること (重なりの扱いを並び順で決めるため)
        const previous = cues[cues.length - 1];
        if (previous && start < previous.start) {
            issue('subtitleSequence', timingIndex, lines[timingIndex].length);
        }
        // 本文は時刻行の次から空行の手前まで
        const bodyStart = timingIndex + 1;
        let bodyEnd = bodyStart;
        while (bodyEnd < lines.length && lines[bodyEnd].trim() !== '') bodyEnd += 1;
        const body = lines.slice(bodyStart, bodyEnd).join('\n');
        cues.push({
            index: cues.length + 1,
            start,
            end,
            text: body,
            textOffset: bodyStart < lines.length ? lineOffsets[bodyStart] : text.length,
            line: timingIndex + 1,
        });
        index = bodyEnd;
    }
    if (cues.length === 0 && errors.length === 0) {
        issue('subtitleEmpty', 0, 1);
    }
    return { cues, errors };
}

// 秒を「HH:MM:SS.mmm」で表す (確認ダイアログなどの表示用)
export function formatTimestamp(seconds: number): string {
    const total = Math.max(0, Math.round(seconds * 1000));
    const ms = total % 1000;
    const s = Math.floor(total / 1000) % 60;
    const m = Math.floor(total / 60000) % 60;
    const h = Math.floor(total / 3600000);
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
