import fs from 'fs';
import { runFfmpeg } from '../ffmpeg/ffmpeg';

// mkv テキスト字幕の抽出とリタイム (元: cut-chapter.py の字幕処理群)
// mkv のストリームコピーでは ffmpeg が字幕の時刻を正しくリベースしない
// (挙動がシーク位置に依存して不定) ため、テキスト字幕はいったん単体で
// 抽出し、こちら側で時刻をずらしてから合流させる。

// codec_name -> [抽出時のフォーマット, 拡張子]
export const TEXT_SUBTITLE_EXTRACT: Record<string, [string, string]> = {
    subrip: ['srt', 'srt'],
    ass: ['ass', 'ass'],
    ssa: ['ass', 'ass'],
    webvtt: ['webvtt', 'vtt'],
};

// 元実装は re.match による先頭一致のため、行頭に固定する
// (固定しないと ASS のコメント行など、行の途中に一致する行まで書き換えてしまう)
const SUB_TIMELINE_RE = /^((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})(.*)/;
const ASS_EVENT_RE = /^(Dialogue|Comment):\s*([^,]*),([^,]*),([^,]*),(.*)$/;

// "HH:MM:SS,mmm" / "H:MM:SS.cc" / "MM:SS.mmm" を秒に変換する
function parseSubTime(text: string): number {
    let seconds = 0;
    for (const part of text.replace(/,/g, '.').split(':')) {
        seconds = seconds * 60 + Number.parseFloat(part);
    }
    return seconds;
}

// 秒を各形式の時刻表記に変換する
// style: "srt" -> HH:MM:SS,mmm  "vtt" -> HH:MM:SS.mmm  "ass" -> H:MM:SS.cc
function formatSubTime(secondsInput: number, style: string): string {
    const seconds = secondsInput < 0 ? 0 : secondsInput;
    const pad = (value: number, length: number) => String(value).padStart(length, '0');
    if (style === 'ass') {
        const cs = Math.round(seconds * 100);
        return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60, 2)}:${pad(Math.floor(cs / 100) % 60, 2)}.${pad(cs % 100, 2)}`;
    }
    const ms = Math.round(seconds * 1000);
    const sep = style === 'srt' ? ',' : '.';
    return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}${sep}${pad(ms % 1000, 3)}`;
}

// 字幕テキスト全体の時刻を delta 秒ずらし、範囲外のイベントを除去する。
// 開始点をまたぐイベントは開始時刻を 0 に丸めて残す。
export function shiftTextSubtitles(content: string, style: string, delta: number, limit: number): string {
    if (style === 'ass') {
        const lines: string[] = [];
        for (const line of content.split(/\r?\n/)) {
            const match = ASS_EVENT_RE.exec(line);
            if (match) {
                const start = parseSubTime(match[3]) + delta;
                const end = parseSubTime(match[4]) + delta;
                if (end <= 0 || start >= limit) continue;
                lines.push(
                    `${match[1]}: ${match[2]},${formatSubTime(start, 'ass')},${formatSubTime(end, 'ass')},${match[5]}`
                );
                continue;
            }
            lines.push(line);
        }
        return lines.join('\n') + '\n';
    }

    // srt / vtt はブロック単位で処理する
    const blocks = content.split(/\r?\n\r?\n/);
    const kept: string[] = [];
    let number = 0;
    for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let timeIndex: number | null = null;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('-->')) {
                timeIndex = i;
                break;
            }
        }
        if (timeIndex === null) {
            // ヘッダや NOTE 等はそのまま残す
            if (lines.length > 0 && lines.some(line => line.length > 0)) {
                kept.push(lines.join('\n'));
            }
            continue;
        }
        const match = SUB_TIMELINE_RE.exec(lines[timeIndex].trim());
        if (!match) {
            kept.push(lines.join('\n'));
            continue;
        }
        const start = parseSubTime(match[1]) + delta;
        const end = parseSubTime(match[2]) + delta;
        if (end <= 0 || start >= limit) continue;
        lines[timeIndex] = `${formatSubTime(start, style)} --> ${formatSubTime(end, style)}${match[3]}`;
        if (style === 'srt') {
            number += 1;
            if (timeIndex > 0 && /^\d+$/.test(lines[timeIndex - 1].trim())) {
                lines[timeIndex - 1] = String(number);
            }
        }
        kept.push(lines.join('\n'));
    }
    return kept.join('\n\n') + '\n';
}

// 字幕ストリームを単体で抽出する (シークを伴わないため時刻は元のまま保たれる)
export async function extractTextSubtitle(
    inputPath: string,
    subRelIndex: number,
    codecName: string,
    outPath: string,
    jobId?: string
): Promise<void> {
    const [format] = TEXT_SUBTITLE_EXTRACT[codecName];
    const codec = codecName === 'ssa' ? 'ass' : 'copy';
    await runFfmpeg(
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostats',
            '-y',
            '-i',
            inputPath,
            '-map',
            `0:s:${subRelIndex}`,
            '-c:s',
            codec,
            '-f',
            format,
            outPath,
        ],
        { jobId }
    );
}

// テキストとして編集できない字幕 (PGS・VOBSUB・mov_text 等) を切り出す。
// 入力側 -ss で範囲の先頭へ飛びつつ、-copyts と出力側 -ss で
// 「切り出し開始より前から表示され続けているパケット」を捨てる。
// これを pass1 に含めたまま処理すると、その古いパケットが -avoid_negative_ts の基準になり、
// 映像・音声の時刻がまとめてずれてしまう。
export async function extractSubtitleRange(
    inputPath: string,
    subRelIndex: number,
    start: number,
    end: number,
    outPath: string,
    jobId?: string,
    // 表示領域の大きさ。VOBSUB のようにコンテナ側にしか大きさを持たない字幕で指定する。
    // 指定した場合はコピーではなく同じコーデックで再エンコードし、大きさを字幕自身に持たせる
    canvas?: { width: number; height: number },
    // 元のパレット。指定しないとエンコーダの既定色 (青・緑など) になり色が化ける
    palette?: string | null
): Promise<void> {
    await runFfmpeg(
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostats',
            '-y',
            ...(canvas ? ['-canvas_size', `${canvas.width}x${canvas.height}`] : []),
            '-copyts',
            '-ss',
            start.toFixed(6),
            '-to',
            end.toFixed(6),
            '-i',
            inputPath,
            '-map',
            `0:s:${subRelIndex}`,
            '-c:s',
            canvas ? 'dvdsub' : 'copy',
            ...(canvas && palette ? ['-palette', palette] : []),
            '-ss',
            start.toFixed(6),
            // コピー時は切り出し開始が 0 になるが、再エンコード時は元の時刻のまま残るため、
            // 同じ基準 (切り出し開始 = 0) に揃える
            ...(canvas ? ['-output_ts_offset', (-start).toFixed(6)] : []),
            outPath,
        ],
        { jobId }
    );
}

// 抽出済み字幕ファイルをリタイムして書き戻す
export function retimeSubtitleFile(subPath: string, ext: string, delta: number, limit: number): void {
    const content = fs.readFileSync(subPath, 'utf-8');
    const style = ext === 'ass' ? 'ass' : ext;
    fs.writeFileSync(subPath, shiftTextSubtitles(content, style, delta, limit), 'utf-8');
}
