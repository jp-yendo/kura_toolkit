import fs from 'fs';
import os from 'os';
import path from 'path';
import { isCancelledError, runFfmpeg } from '../ffmpeg/ffmpeg';
import { findKeyframeBefore, findNearestKeyframe } from './keyframe';
import { accurateStreamArgs, copyStreamArgs } from './encoders';
import { buildMetadata } from './metadata';
import {
    extractSubtitleRange,
    extractTextSubtitle,
    retimeSubtitleFile,
    TEXT_SUBTITLE_EXTRACT,
} from './subtitles';
import { findVideoStreamIndex, probeMedia, probeSubtitlePalette, type FfStream } from './probe';
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
        return { shift: 0, videoDuration: media.durationSec };
    }
    for (const stream of media.streams) {
        if (stream.index !== index) continue;
        const start = Number.parseFloat(stream.start_time ?? '');
        const duration = Number.parseFloat(stream.duration ?? '');
        return {
            shift: Number.isFinite(start) ? start : 0,
            // mkv はストリーム単位の長さを持たないため、コンテナ全体の長さで代用する
            videoDuration: Number.isFinite(duration) ? duration : media.durationSec,
        };
    }
    return { shift: 0, videoDuration: media.durationSec };
}

// 指定チャプター範囲をひとつ切り抜く共通処理。
// cut / split は範囲の指定方式が異なるだけで、ここからは同一処理となる。
export async function cutRange(options: CutRangeOptions): Promise<void> {
    const { inputPath, chapters, streams, first, last, output, accurate, jobId, log } = options;

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
    log(`output        : ${output}`);

    // 字幕は必ず pass1 から外し、範囲ごとに切り出してから pass2 で合流させる。
    // 字幕は切り出し開始より前から表示され続けているパケットを持つことがあり、
    // pass1 に含めるとその古い時刻が -avoid_negative_ts の基準になって、
    // 映像・音声を含む全体の時刻がずれてしまうため (再生時に字幕が出ない原因)。
    const subs: Array<{ relIndex: number; stream: FfStream; text: boolean }> = [];
    let subCount = 0;
    for (const stream of streams) {
        if (stream.codec_type !== 'subtitle') continue;
        subs.push({
            relIndex: subCount,
            stream,
            text: !!TEXT_SUBTITLE_EXTRACT[stream.codec_name ?? ''],
        });
        subCount += 1;
    }
    // 本編の映像の大きさ (字幕の表示領域を補うときに使う)
    const mainVideo = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    const canvas =
        mainVideo?.width && mainVideo?.height ? { width: mainVideo.width, height: mainVideo.height } : null;

    // カバーアート (本編ではない映像) も切り出し範囲外の時刻を持つため pass1 から外し、
    // mp4 系の出力では pass2 で picture として付け直す
    // (mkv は添付ファイルとして持つ形式で、ffmpeg では映像トラックになってしまうため付けない)
    const attachedPics: Array<{ videoIndex: number; codec: string }> = [];
    let videoCount = 0;
    for (const stream of streams) {
        if (stream.codec_type !== 'video') continue;
        if (stream.disposition?.attached_pic) {
            attachedPics.push({ videoIndex: videoCount, codec: stream.codec_name ?? '' });
        }
        videoCount += 1;
    }
    const outExtension = path.extname(output).toLowerCase();
    const keepAttachedPics = ['.mp4', '.m4v', '.mov'].includes(outExtension) ? attachedPics : [];

    // 字幕は pass1 に含めないため、コーデック指定も映像・音声だけを対象にする
    const videoAudio = streams.filter(stream => stream.codec_type !== 'subtitle');
    const { args: codecArgs, plan } = accurate ? accurateStreamArgs(videoAudio) : copyStreamArgs(videoAudio);
    for (const { relIndex, stream, text } of subs) {
        const name = stream.codec_name ?? '';
        plan.push(`  s:${relIndex}  ${name} -> ${text ? 'extract & retime' : 'extract range'}`);
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
    // 切り出した字幕ファイルと、pass2 で合流させるときに足す時刻のずれ
    const subTempPaths: Array<{ path: string; offset: number }> = [];
    // 取り出したカバーアートの画像
    const coverPaths: string[] = [];
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
        // 字幕とカバーアートは範囲外の時刻を持つため、時刻の基準を映像・音声だけにする
        pass1.push('-map', '-0:s');
        for (const { videoIndex } of attachedPics) {
            pass1.push('-map', `-0:v:${videoIndex}`);
        }
        pass1.push(...codecArgs, '-avoid_negative_ts', 'make_zero', tempOutput);

        await runFfmpeg(pass1, {
            jobId,
            totalSec: end - actualStart,
            onProgress: options.onProgress,
        });

        const { shift, videoDuration } = await probeOutputVideo(tempOutput, jobId);

        // -ss で指定した位置より前のキーフレームへデマルチプレクサが巻き戻ることがある
        // (mkv でよく起きる)。実際の開始位置を映像の長さから逆算し、
        // 内容は必ずキーフレームから始まるので近傍のキーフレームへ吸着させる。
        // ここがずれるとチャプター位置と字幕の時刻がまとめてずれる
        let contentStart = actualStart;
        if (videoDuration && end - videoDuration < actualStart - 0.05) {
            const videoIndex = findVideoStreamIndex(streams);
            const measured = end - videoDuration;
            contentStart =
                videoIndex === null ? measured : await findNearestKeyframe(inputPath, videoIndex, measured, jobId);
            log(`start moved   : ${formatTime(contentStart)} (demuxer keyframe)`);
        }
        if (shift > 0.0005) {
            log(`ts shift      : +${shift.toFixed(3)}s (chapters compensated)`);
        }

        // チャプター位置の基準は「出力上で元の時刻 T が現れる位置」に合わせる
        const base = contentStart - shift;

        // 実測後の基準で、各チャプターが出力上のどこに来るかを表示する
        for (const chapter of chapters.slice(first, last + 1)) {
            const label = chapter.title ? chapter.title : `(id ${chapter.id})`;
            log(`  ${formatTime(Math.max(0, chapter.start - base)).padStart(14)}  ${label}`);
        }

        // 字幕を範囲ごとに切り出す。テキスト字幕はこちらで時刻を書き換え、
        // それ以外 (PGS・VOBSUB・mov_text 等) は ffmpeg に範囲を切り出させる
        const delta = -base;
        const limit = end + delta;
        for (let order = 0; order < subs.length; order++) {
            const { relIndex, stream, text } = subs[order];
            const name = stream.codec_name ?? '';
            if (text) {
                const [, ext] = TEXT_SUBTITLE_EXTRACT[name];
                const subPath = `${tempOutput}.sub${order}.${ext}`;
                await extractTextSubtitle(inputPath, relIndex, name, subPath, jobId);
                retimeSubtitleFile(subPath, ext, delta, limit);
                subTempPaths.push({ path: subPath, offset: 0 });
            } else {
                const subPath = `${tempOutput}.sub${order}${outExt}`;
                // VOBSUB はコンテナ側にしか表示領域の大きさを持たないことがあり、
                // そのまま取り出すと大きさが失われて再生時に巨大化・色化けする。
                // その場合は映像と同じ大きさを指定して同じコーデックで作り直す
                const needsCanvas = name === 'dvd_subtitle' && !stream.width && canvas !== null;
                // 作り直す場合は元のパレットも引き継ぐ (指定しないと色が化ける)
                const palette = needsCanvas ? await probeSubtitlePalette(inputPath, relIndex, jobId) : null;
                await extractSubtitleRange(
                    inputPath,
                    relIndex,
                    actualStart,
                    end,
                    subPath,
                    jobId,
                    needsCanvas ? canvas : undefined,
                    palette
                );
                // 切り出した字幕は actualStart を 0 とした時刻になっているため、
                // pass1 の実測とのずれ (actualStart - base) を pass2 で足して映像に合わせる
                subTempPaths.push({ path: subPath, offset: actualStart - base });
            }
        }

        // カバーアートを画像として取り出す (pass2 で付け直すため)。
        // 取り出せない形式でも本編の切り出しは続けたいので、失敗しても中断しない
        for (let order = 0; order < keepAttachedPics.length; order++) {
            const { videoIndex, codec } = keepAttachedPics[order];
            const imagePath = `${tempOutput}.cover${order}.${codec === 'png' ? 'png' : 'jpg'}`;
            try {
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
                        `0:v:${videoIndex}`,
                        '-frames:v',
                        '1',
                        '-c',
                        'copy',
                        imagePath,
                    ],
                    { jobId }
                );
                coverPaths.push(imagePath);
            } catch (error) {
                if (isCancelledError(error)) throw error;
                log(`  note: cover art (v:${videoIndex}) could not be extracted; it is dropped`);
                try {
                    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                } catch {
                    // 削除失敗は無視
                }
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
        for (const sub of subTempPaths) {
            if (Math.abs(sub.offset) > 0.0005) {
                pass2.push('-itsoffset', sub.offset.toFixed(6));
            }
            pass2.push('-i', sub.path);
        }
        for (const coverPath of coverPaths) {
            pass2.push('-i', coverPath);
        }
        pass2.push('-map', '0', '-map', '-0:d');
        for (let j = 0; j < subTempPaths.length; j++) {
            // 字幕だけを取り込む (切り出した一時ファイルにも mp4 のチャプター用トラックが付くため)
            pass2.push('-map', `${2 + j}:s`);
        }
        // カバーアートは picture として付け直す (本編の映像の後ろに並ぶ)
        const mainVideoCount = videoCount - attachedPics.length;
        for (let j = 0; j < coverPaths.length; j++) {
            pass2.push('-map', `${2 + subTempPaths.length + j}:v`);
            pass2.push(`-disposition:v:${mainVideoCount + j}`, 'attached_pic');
        }
        pass2.push(
            // 全体のメタ情報 (タイトル・作者・説明など) は入力から引き継ぎ、
            // チャプターだけ FFMETADATA から取り込む。
            // -map_metadata 1 にすると FFMETADATA の内容で全体が置き換わり、元のタグが消える
            '-map_metadata',
            '0',
            '-map_chapters',
            '1',
            '-c',
            'copy',
            // 実測済みの時刻をそのまま保持させる
            '-copyts'
        );
        // 合流させた字幕の言語・タイトルと、既定/強制の指定を元ストリームから引き継ぐ。
        // 指定しないと ffmpeg が入力ごとに既定フラグを立て、既定の字幕が複数ある状態になる
        for (let j = 0; j < subs.length; j++) {
            const { stream } = subs[j];
            if (stream.tags?.language) pass2.push(`-metadata:s:s:${j}`, `language=${stream.tags.language}`);
            if (stream.tags?.title) pass2.push(`-metadata:s:s:${j}`, `title=${stream.tags.title}`);
            const flags: string[] = [];
            if (stream.disposition?.default) flags.push('default');
            if (stream.disposition?.forced) flags.push('forced');
            pass2.push(`-disposition:s:${j}`, flags.length > 0 ? flags.join('+') : '0');
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
        for (const tempPath of [metaPath, tempOutput, ...subTempPaths.map(sub => sub.path), ...coverPaths]) {
            try {
                if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch {
                // 一時ファイルの削除失敗は無視
            }
        }
    }
}
