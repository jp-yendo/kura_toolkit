import fs from 'fs';
import os from 'os';
import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { findKeyframeBefore } from './keyframe';
import { accurateStreamArgs, copyStreamArgs, TEXT_SUBTITLE_ENCODERS } from './encoders';
import { buildMetadata } from './metadata';
import { extractTextSubtitle, retimeSubtitleFile, TEXT_SUBTITLE_EXTRACT } from './subtitles';
import { findVideoStreamIndex, probeMedia, type FfStream } from './probe';
import type { ChapterInfo } from '../../../shared/types';

// チャプター範囲の切り抜き本体 (元: cut-chapter.py の cut_range)

export type CutRangeOptions = {
    inputPath: string;
    chapters: ChapterInfo[];
    streams: FfStream[];
    formatName: string;
    first: number;
    last: number;
    output: string;
    accurate: boolean;
    jobId: string;
    // 加工情報の表示用ログ (元 CLI の標準出力に相当)
    log: (line: string) => void;
    // pass1 の進捗 (0-100)
    onProgress?: (percent: number) => void;
};

// 秒数を HH:MM:SS.mmm 形式に整形する
export function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    const secText = s.toFixed(3).padStart(6, '0');
    return `${pad(h)}:${pad(m)}:${secText}`;
}

// 出力ファイルの主映像ストリームの開始時刻と長さを測る
async function probeOutputVideo(
    outputPath: string,
    jobId: string
): Promise<{ shift: number; videoDuration: number | null }> {
    const media = await probeMedia(outputPath, jobId);
    const index = findVideoStreamIndex(media.streams);
    if (index === null) {
        return { shift: 0, videoDuration: null };
    }
    for (const stream of media.streams) {
        if (stream.index !== index) continue;
        const start = Number.parseFloat(stream.start_time ?? '');
        const duration = Number.parseFloat(stream.duration ?? '');
        return {
            shift: Number.isFinite(start) ? start : 0,
            videoDuration: Number.isFinite(duration) ? duration : null,
        };
    }
    return { shift: 0, videoDuration: null };
}

// 指定チャプター範囲をひとつ切り抜く共通処理。
// cut / split は範囲の指定方式が異なるだけで、ここからは同一処理となる。
export async function cutRange(options: CutRangeOptions): Promise<void> {
    const { inputPath, chapters, streams, formatName, first, last, output, accurate, jobId, log } = options;

    if (path.resolve(output) === path.resolve(inputPath)) {
        throw new Error('OUTPUT_EQUALS_INPUT');
    }

    // 範囲は開始チャプターの先頭から終了チャプターの末尾まで
    const start = chapters[first].start;
    const end = chapters[last].end;

    // ストリームコピー時は開始点を直前のキーフレームへ吸着させる
    let actualStart = start;
    if (!accurate) {
        const videoIndex = findVideoStreamIndex(streams);
        if (videoIndex !== null) {
            actualStart = await findKeyframeBefore(inputPath, videoIndex, start, jobId);
        }
    }

    // 加工情報のサマリ
    log(`input range   : ${formatTime(start)} - ${formatTime(end)}`);
    if (accurate) {
        log('mode          : accurate (re-encode)');
    } else {
        log('mode          : stream copy (keyframe snap)');
        if (start - actualStart > 0.0005) {
            log(`start snapped : ${formatTime(actualStart)} (-${(start - actualStart).toFixed(3)}s)`);
        }
    }
    log(`duration      : ${formatTime(end - actualStart)}`);
    log(`chapters      : ${last - first + 1}`);
    for (const chapter of chapters.slice(first, last + 1)) {
        const label = chapter.title ? chapter.title : `(id ${chapter.id})`;
        log(`  ${formatTime(Math.max(0, chapter.start - actualStart)).padStart(14)}  ${label}`);
    }
    log(`output        : ${output}`);

    // mkv のストリームコピーではテキスト字幕を pass1 から除外し、
    // 別途抽出して時刻を合わせて pass2 で合流させる
    const textSubs: Array<{ relIndex: number; stream: FfStream }> = [];
    let subCount = 0;
    for (const stream of streams) {
        if (stream.codec_type !== 'subtitle') continue;
        if (TEXT_SUBTITLE_EXTRACT[stream.codec_name ?? '']) {
            textSubs.push({ relIndex: subCount, stream });
        }
        subCount += 1;
    }
    const retimeSubs = formatName.includes('matroska') && !accurate && textSubs.length > 0;

    let codecArgs: string[];
    let plan: string[];
    let hasBitmapSubs: boolean;
    if (accurate) {
        // 入力側 -ss と再エンコードの組み合わせはフレーム精度で切れる
        const result = accurateStreamArgs(streams);
        codecArgs = result.args;
        plan = result.plan;
        hasBitmapSubs = result.hasBitmapSubs;
    } else if (retimeSubs) {
        codecArgs = ['-c', 'copy'];
        hasBitmapSubs = false;
        plan = [];
        let idx = 0;
        for (const stream of streams) {
            if (stream.codec_type !== 'subtitle') continue;
            const name = stream.codec_name ?? '';
            if (TEXT_SUBTITLE_EXTRACT[name]) {
                plan.push(`  s:${idx}  ${name} -> extract & retime`);
            } else {
                hasBitmapSubs = true;
                plan.push(`  s:${idx}  ${name} -> copy (bitmap subtitle)`);
            }
            idx += 1;
        }
    } else {
        const result = copyStreamArgs(streams);
        codecArgs = result.args;
        plan = result.plan;
        hasBitmapSubs = result.hasBitmapSubs;
    }
    if (formatName.includes('matroska') && !accurate && hasBitmapSubs) {
        plan.push('  note: bitmap subtitle timing is unreliable with stream copy on mkv; consider accurate mode');
    }
    if (plan.length > 0) {
        log('streams       :');
        for (const line of plan) log(line);
    }

    // 2 パス構成で処理する
    //   pass1: チャプターなしで切り抜く
    //   pass2: 実測した開始時刻ずれで補正したチャプターを付けてリマックス
    const outExt = path.extname(output);
    const outBase = output.slice(0, output.length - outExt.length);
    const tempOutput = `${outBase}.tmp${outExt}`;
    let metaPath: string | null = null;
    let pass2Started = false;
    const subTempPaths: string[] = [];
    try {
        const pass1 = [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostats',
            '-y',
            '-ss',
            actualStart.toFixed(6),
            '-to',
            end.toFixed(6),
            '-i',
            inputPath,
            // データストリーム (チャプター用テキストトラック等) は除外する
            '-map',
            '0',
            '-map',
            '-0:d',
        ];
        if (retimeSubs) {
            for (const { relIndex } of textSubs) {
                pass1.push('-map', `-0:s:${relIndex}`);
            }
        }
        const hasTextSubs = streams.some(
            stream => stream.codec_type === 'subtitle' && TEXT_SUBTITLE_ENCODERS[stream.codec_name ?? '']
        );
        if (accurate && hasTextSubs && !hasBitmapSubs && !formatName.includes('matroska')) {
            // 出力側 -ss 0 で切り出し開始前にはみ出す字幕を破棄する
            pass1.push('-ss', '0');
        }
        pass1.push(...codecArgs, '-avoid_negative_ts', 'make_zero', tempOutput);

        await runFfmpeg(pass1, {
            jobId,
            totalSec: end - actualStart,
            onProgress: options.onProgress,
        });

        const { shift, videoDuration } = await probeOutputVideo(tempOutput, jobId);

        // mkv では -ss が要求位置より前のキーフレームへ巻き戻ることがあるため、
        // 実際の開始位置を映像の長さから逆算する
        let contentStart = actualStart;
        if (formatName.includes('matroska') && videoDuration) {
            contentStart = end - videoDuration;
        }
        if (contentStart < actualStart - 0.05) {
            log(`start moved   : ${formatTime(contentStart)} (demuxer keyframe)`);
        }
        if (shift > 0.0005) {
            log(`ts shift      : +${shift.toFixed(3)}s (chapters compensated)`);
        }

        // チャプター位置の基準は「出力上で元の時刻 T が現れる位置」に合わせる
        const base = contentStart - shift;

        // テキスト字幕を抽出し、同じ基準で時刻をずらして pass2 で合流させる
        if (retimeSubs) {
            const delta = -base;
            const limit = end + delta;
            for (let order = 0; order < textSubs.length; order++) {
                const { relIndex, stream } = textSubs[order];
                const name = stream.codec_name ?? '';
                const [, ext] = TEXT_SUBTITLE_EXTRACT[name];
                const subPath = `${tempOutput}.sub${order}.${ext}`;
                await extractTextSubtitle(inputPath, relIndex, name, subPath, jobId);
                retimeSubtitleFile(subPath, ext, delta, limit);
                subTempPaths.push(subPath);
            }
        }

        // メタデータは一時ファイル経由で渡す (書き込みを閉じてから ffmpeg を実行する)
        const metaText = buildMetadata(chapters, first, last, base);
        metaPath = path.join(os.tmpdir(), `kura-chapter-meta-${process.pid}-${Date.now()}.txt`);
        fs.writeFileSync(metaPath, metaText, 'utf-8');

        const pass2 = [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostats',
            '-y',
            '-i',
            tempOutput,
            '-f',
            'ffmetadata',
            '-i',
            metaPath,
        ];
        for (const subPath of subTempPaths) {
            pass2.push('-i', subPath);
        }
        pass2.push('-map', '0', '-map', '-0:d');
        for (let j = 0; j < subTempPaths.length; j++) {
            pass2.push('-map', String(2 + j));
        }
        pass2.push(
            '-map_metadata',
            '1',
            '-map_chapters',
            '1',
            '-c',
            'copy',
            // 実測済みの時刻をそのまま保持させる
            '-copyts'
        );
        if (retimeSubs) {
            // 合流させた字幕の言語タグを元ストリームから引き継ぐ
            const bitmapCount = subCount - textSubs.length;
            for (let j = 0; j < textSubs.length; j++) {
                const lang = textSubs[j].stream.tags?.language;
                if (lang) {
                    pass2.push(`-metadata:s:s:${bitmapCount + j}`, `language=${lang}`);
                }
            }
        }
        pass2.push(output);
        pass2Started = true;
        await runFfmpeg(pass2, { jobId });
        log('done');
    } catch (error) {
        // 失敗またはキャンセル時は書きかけの出力を削除する
        try {
            if (pass2Started && fs.existsSync(output)) fs.unlinkSync(output);
        } catch {
            // 削除失敗は無視
        }
        throw error;
    } finally {
        for (const tempPath of [metaPath, tempOutput, ...subTempPaths]) {
            try {
                if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch {
                // 一時ファイルの削除失敗は無視
            }
        }
    }
}
