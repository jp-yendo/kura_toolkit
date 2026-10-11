import fs from 'fs';
import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import {
    copyStartSeek,
    findAudioPacketStart,
    findCopyEnd,
    findKeyframeBefore,
    boundaryFrame,
    countFrames,
    firstFrameFrom,
    hasLeadingFrames,
    FRAME_TOLERANCE,
} from './keyframe';
import { smartCutVideo } from './smart-cut';
import { accurateAudioEncoder, accurateStreamArgs, copyStreamArgs } from './encoders';
import { availableEncoders } from '../audio-formats';
import { buildMetadata, chaptersInOutput } from './metadata';
import { extractSubtitleRange, extractTextSubtitle, retimeSubtitleFile, TEXT_SUBTITLE_EXTRACT } from './subtitles';
import {
    findVideoStreamIndex,
    hasAlphaLayer,
    probeHdrMetadata,
    probeMedia,
    probeSubtitlePalette,
    type FfStream,
} from './probe';
import { hdrArgs } from './hdr';
import { streamMetadataArgs } from './stream-metadata';
import { shiftTimecode } from './timecode';
import { HDR_METADATA_ENCODERS, VIDEO_ENCODERS } from '../../../shared/video-codecs';
import type { ChapterInfo, VideoCutBoundary, VideoCutMethod } from '../../../shared/types';
import { newTempDir, produceFile, discardLater } from '../work-dir';

// チャプター範囲の切り抜き本体

export type CutRangeOptions = {
    inputPath: string;
    // ファイル全体のメタ情報 (タイムコードを読むため)
    formatTags: Record<string, string>;
    chapters: ChapterInfo[];
    streams: FfStream[];
    formatName: string;
    first: number;
    last: number;
    output: string;
    method: VideoCutMethod;
    boundary: VideoCutBoundary;
    jobId: string;
    // 加工情報の表示用ログ
    log: (line: string) => void;
    // pass1 の進捗 (0-100)
    onProgress?: (percent: number) => void;
};

// カバーアートを画像のストリームとして持てる出力形式 (mkv は添付ファイルとして持つ)
const COVER_PICTURE_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.m4a', '.mp3', '.flac']);

// 映像のフレームレート (r_frame_rate、使えなければ avg_frame_rate。分からなければ 0)
function frameRateOf(stream: FfStream): number {
    for (const value of [stream.r_frame_rate, stream.avg_frame_rate]) {
        const [num, den = '1'] = (value ?? '').split('/');
        const rate = Number(num) / Number(den);
        if (Number.isFinite(rate) && rate > 0 && rate <= 240) return rate;
    }
    return 0;
}

// 秒数を HH:MM:SS.mmm 形式に整形する
export function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    const secText = s.toFixed(3).padStart(6, '0');
    return `${pad(h)}:${pad(m)}:${secText}`;
}

// 出力ファイルの主映像ストリームの開始時刻 (出力の 0 秒から映像が始まるまでのずれ。B フレームの並びなどで生じる) を測る
async function probeOutputShift(outputPath: string, jobId: string): Promise<{ shift: number }> {
    const media = await probeMedia(outputPath, jobId);
    const index = findVideoStreamIndex(media.streams);
    const stream = media.streams.find(item => item.index === index);
    const start = Number.parseFloat(stream?.start_time ?? '');
    return { shift: Number.isFinite(start) ? start : 0 };
}

// 指定チャプター範囲をひとつ切り抜く共通処理。
// cut / split は範囲の指定方式が異なるだけで、ここからは同一処理となる。
export async function cutRange(options: CutRangeOptions): Promise<void> {
    const { inputPath, chapters, streams, first, last, output, method, boundary, jobId, log } = options;
    const accurate = method === 'reencode';

    if (path.resolve(output) === path.resolve(inputPath)) {
        throw new Error('OUTPUT_EQUALS_INPUT');
    }

    // 範囲は開始チャプターの先頭から終了チャプターの末尾まで。境界をまたぐフレームを入れる範囲を boundary で決め、
    // 範囲の始まり・終わりを、範囲に入る最初のフレーム・次の範囲に入る最初のフレームの表示の時刻にする (隣り合う範囲は
    // 同じ境界を同じ規則で置き換えるため、どのフレームも一方だけに入る)
    const videoIndex = findVideoStreamIndex(streams);
    const resolve = (time: number) =>
        videoIndex !== null ? boundaryFrame(inputPath, videoIndex, time, boundary, jobId) : Promise.resolve(time);
    const start = await resolve(chapters[first].start);
    const end = await resolve(chapters[last].end);

    // まず映像の範囲を決め、音声・字幕などはその範囲に合わせて取り出す (映像と必ずそろえるため)。
    // 再エンコード・スマートカットは指定どおりの範囲。
    // ロスレスは指定どおりに切れないところを外側へ広げる: 始まりは直前のキーフレームへ、終わりは指定より前に表示される
    // フレームをすべて正しく表示できるところまで
    let actualStart = start;
    // 入力側・出力側の -ss に渡す位置と、-to に渡す位置。再エンコード・スマートカットは FRAME_TOLERANCE だけ手前にずらす
    // (ffmpeg は境界ちょうどのフレームを含めるかが時刻の丸めで変わるため。範囲に含めるフレームの規則は FRAME_TOLERANCE)。
    // ロスレスの出力側の -ss は copyStartSeek、-to はデコードの順の位置
    let inputStart = start - FRAME_TOLERANCE;
    let outputStart = start - FRAME_TOLERANCE;
    let videoDecodeEnd = end - FRAME_TOLERANCE;
    // 映像の終わり (表示上の元の時刻)
    let rangeEnd = end;
    // ロスレスで、始まりのキーフレームの先行フレームを捨てるか
    let dropLeading = false;
    if (method === 'lossless' && videoIndex !== null) {
        const keyframe = await findKeyframeBefore(inputPath, videoIndex, start, jobId);
        actualStart = keyframe.time;
        inputStart = keyframe.time;
        outputStart = copyStartSeek(keyframe);
        // HEVC の open GOP の区切り (CRA) の先行フレームは、デコードの順でキーフレームの後ろにあり、表示はキーフレームより前
        // (前のチャプターの終わり) になる。写すと前のチャプターのフレームが入り、映像の始まりがキーフレームより前になって
        // 音声などとずれるため捨てる (HEVC の規格では、先行フレームはキーフレームより後ろのフレームから参照されない)
        const codec = streams.find(stream => stream.index === videoIndex)?.codec_name;
        if (codec === 'hevc' && (await hasLeadingFrames(inputPath, videoIndex, keyframe.time, jobId))) {
            dropLeading = true;
            log(`leading frames: dropped (before ${formatTime(keyframe.time)})`);
        }
        const copyEnd = await findCopyEnd(inputPath, videoIndex, end, jobId);
        rangeEnd = copyEnd.displayEnd;
        videoDecodeEnd = copyEnd.decodeEnd;
    }

    // 加工情報のサマリ
    log(`input range   : ${formatTime(start)} - ${formatTime(end)}`);
    log(
        `mode          : ${
            { lossless: 'lossless (stream copy, keyframe snap)', smart: 'smart cut', reencode: 'accurate (re-encode)' }[
                method
            ]
        }`
    );
    if (start - actualStart > 0.0005) {
        log(`start snapped : ${formatTime(actualStart)} (-${(start - actualStart).toFixed(3)}s)`);
    }
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
    const canvas = mainVideo?.width && mainVideo?.height ? { width: mainVideo.width, height: mainVideo.height } : null;

    // カバーアート (本編ではない映像) も切り出し範囲外の時刻を持つため pass1 から外し、pass2 で付け直す。
    // mp4 系・mp3・flac では画像のストリーム (attached picture)、mkv では添付ファイルとして持たせる
    // (mkv の画像の添付ファイルは ffmpeg では映像のストリームとして読まれるため、そのまま写すと映像トラックになってしまう)
    const attachedPics: Array<{ videoIndex: number; stream: FfStream }> = [];
    let videoCount = 0;
    for (const stream of streams) {
        if (stream.codec_type !== 'video') continue;
        if (stream.disposition?.attached_pic) {
            attachedPics.push({ videoIndex: videoCount, stream });
        }
        videoCount += 1;
    }
    const outExtension = path.extname(output).toLowerCase();
    const coverMethod = COVER_PICTURE_CONTAINERS.has(outExtension)
        ? 'picture'
        : outExtension === '.mkv'
          ? 'attachment'
          : null;
    const keepAttachedPics = coverMethod ? attachedPics : [];

    // 字幕は pass1 に含めないため、コーデック指定も映像・音声だけを対象にする
    const videoAudio = streams.filter(stream => stream.codec_type !== 'subtitle');
    const available = accurate ? await availableEncoders() : null;
    const audioPlan = videoAudio
        .filter(stream => stream.codec_type === 'audio')
        .map(stream => accurateAudioEncoder(stream, outExtension, available));
    const { args: codecArgs, plan } = accurate ? accurateStreamArgs(videoAudio, audioPlan) : copyStreamArgs(videoAudio);
    // 再エンコードでは HDR のマスタリングの情報をエンコーダへ明示する (ffmpeg がフレームから引き継ぐかは版や組み合わせで変わるため)
    const mainVideoIndex = findVideoStreamIndex(streams);
    if (accurate && mainVideo && mainVideoIndex !== null && mainVideo.color_transfer === 'smpte2084') {
        const encoder = VIDEO_ENCODERS[mainVideo.codec_name ?? ''] ?? 'libx264';
        if (HDR_METADATA_ENCODERS.has(encoder)) {
            const order = streams.filter(stream => stream.codec_type === 'video').indexOf(mainVideo);
            const hdr = await probeHdrMetadata(inputPath, order, jobId);
            codecArgs.push(...hdrArgs(encoder, 0, hdr));
        }
    }
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
    // 一時ファイル (pass1 の出力・切り出した字幕・カバーアート・チャプター情報) は作業ディレクトリの
    // この処理用のフォルダに置き、終わったらフォルダごと消す
    const tempDir = newTempDir();
    const tempOutput = path.join(tempDir, `pass1${outExt}`);
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
            // 元の時刻のまま読み、出力側の -ss で切り出しの始まりより前を捨てる。入力側の -ss だけでは、デマルチプレクサが
            // 指定より前の位置 (mkv の索引の粒度など) から読み始め、映像・音声が手前から入ってしまう。
            // 再エンコードはデコードした映像・音声が指定の位置からちょうど始まり、ストリームコピーは指定のキーフレームから始まる
            '-copyts',
            '-ss',
            inputStart.toFixed(6),
            '-to',
            videoDecodeEnd.toFixed(6),
            // 再エンコードで VP8・VP9 の透過を保つため、透過の層を読める libvpx で読む (ffmpeg 標準のデコーダは透過を読まない)
            ...(accurate && mainVideo && hasAlphaLayer(mainVideo)
                ? ['-c:v', mainVideo.codec_name === 'vp8' ? 'libvpx' : 'libvpx-vp9']
                : []),
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
        // ロスレス・スマートカットでは、音声は映像の範囲 (表示の始まりから終わりまで) に合わせて別に取り出す (下の audioTemp)。
        // 映像の出力側の -ss はキーフレームのデコードの時刻より前の位置になるため、同じ指定で音声を取ると表示の始まりより前の音が入る
        const audios = streams.filter(stream => stream.codec_type === 'audio');
        const separateAudio = !accurate && audios.length > 0 && mainVideo !== undefined;
        // 映像の無いファイル (チャプター付きの音声) は音声だけを写す。始まりの音を含むパケットから写すよう、出力側の -ss を
        // そのパケットの始まりにする (音声はパケットの始まりで比べられる)
        if (!accurate && !mainVideo && audios.length > 0) {
            const packetStarts = await Promise.all(
                audios.map(stream => findAudioPacketStart(inputPath, stream.index, start, jobId))
            );
            outputStart = Math.min(...packetStarts) - 0.0005;
            actualStart = Math.min(...packetStarts);
        }
        if (separateAudio) pass1.push('-map', '-0:a');
        pass1.push(...codecArgs);
        if (dropLeading) {
            // 最初に届くパケット (始まりのキーフレーム) より前に表示されるパケットを捨てる。フィルタに渡る時刻は ffmpeg が
            // ずらした後の値のため、元の時刻ではなく最初のパケットの時刻 (startpts) と比べる。drop の式は 0 以外のときに
            // 捨てる。フィルタの区切り (,) を使えないため、lt() の代わりに ceil((startpts - pts) / 10^15) (前なら 1) で書く
            pass1.push('-bsf:v', 'noise=drop=ceil((startpts-pts)/1000000000000000)');
        }
        if (accurate && mainVideoIndex !== null) {
            // 再エンコードの映像の終わりは -to だけに任せず、範囲に含まれるフレームの数で止める (-to は境界ちょうどの
            // フレームを含めるかが時刻の基準と丸めで変わり、隣の範囲と 1 フレーム重なることがある)
            pass1.push('-frames:v', String(await countFrames(inputPath, mainVideoIndex, start, end, jobId)));
        }
        pass1.push('-ss', outputStart.toFixed(6), '-avoid_negative_ts', 'make_zero', tempOutput);
        if (method === 'smart' && mainVideo) {
            // スマートカットは映像を部分ごとに作ってつなげる (smart-cut.ts)
            await smartCutVideo({
                inputPath,
                video: mainVideo,
                videoOrder: streams.filter(stream => stream.codec_type === 'video').indexOf(mainVideo),
                start,
                end,
                output: tempOutput,
                extension: outExtension,
                tempDir,
                jobId,
                log,
            });
        } else {
            await runFfmpeg(pass1, { jobId, totalSec: rangeEnd - actualStart, onProgress: options.onProgress });
        }
        if (rangeEnd - end > 0.0005) {
            log(
                `end extended  : ${formatTime(rangeEnd)} (+${(rangeEnd - end).toFixed(3)}s, frames needed for decoding)`
            );
        }
        log(`duration      : ${formatTime(rangeEnd - actualStart)}`);
        const { shift } = await probeOutputShift(tempOutput, jobId);
        // 出力の内容は、出力側の -ss により必ず actualStart から始まる
        const contentStart = actualStart;
        // 出力の最初のフレームの元の表示の時刻 (切る位置がフレームの途中にある場合は actualStart より後ろ)
        const firstFrame =
            mainVideoIndex !== null ? await firstFrameFrom(inputPath, mainVideoIndex, actualStart, jobId) : actualStart;
        if (shift > 0.0005) {
            log(`ts shift      : +${shift.toFixed(3)}s (chapters compensated)`);
        }

        // 出力の 0 秒に当たる元の時刻。出力の最初のフレームは出力上 shift の位置にあり、元の時刻は firstFrame
        const base = firstFrame - shift;

        // ストリームコピーの音声: 映像の表示の始まり (actualStart) の音を含むパケットから、映像の表示の終わり (rangeEnd) の音を
        // 含むパケットまでを取り出す (音声のパケットの境目は映像と一致しないため、音を欠かさないよう外側へ広げる)。
        // 取り出したファイルは最初のパケット (元の時刻 audioStart) が 0 秒になるため、pass2 で audioStart - base だけずらして
        // 映像と合わせる
        // 一時ファイルは出力と同じ形式にする (形式ごとの音声の先頭の遅延 (AAC のエンコーダの遅延など) の扱いを保つため)
        const audioTemp = path.join(tempDir, `audio${outExt}`);
        let audioOffset = 0;
        if (separateAudio) {
            const packetStarts = await Promise.all(
                audios.map(stream => findAudioPacketStart(inputPath, stream.index, actualStart, jobId))
            );
            const audioStart = Math.min(...packetStarts);
            await runFfmpeg(
                [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-nostats',
                    '-y',
                    '-copyts',
                    '-ss',
                    audioStart.toFixed(6),
                    '-to',
                    rangeEnd.toFixed(6),
                    '-i',
                    inputPath,
                    '-map',
                    '0:a',
                    '-c',
                    'copy',
                    '-ss',
                    (audioStart - 0.0005).toFixed(6),
                    '-avoid_negative_ts',
                    'make_zero',
                    audioTemp,
                ],
                { jobId }
            );
            audioOffset = audioStart - base;
        }

        // 実測後の基準で、各チャプターが出力上のどこに来るかを表示する
        for (const chapter of chaptersInOutput(chapters, first, last, contentStart, rangeEnd)) {
            const label = chapter.title ? chapter.title : `(No. ${chapter.index + 1})`;
            log(`  ${formatTime(Math.max(0, chapter.start - base)).padStart(14)}  ${label}`);
        }

        // 字幕を範囲ごとに切り出す。テキスト字幕はこちらで時刻を書き換え、
        // それ以外 (PGS・VOBSUB・mov_text 等) は ffmpeg に範囲を切り出させる
        const delta = -base;
        const limit = rangeEnd + delta;
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
                    rangeEnd,
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

        // カバーアートを画像として取り出す (pass2 で付け直すため)
        for (let order = 0; order < keepAttachedPics.length; order++) {
            const { videoIndex, stream } = keepAttachedPics[order];
            // jpeg・png はそのまま、それ以外の形式は png に変換して取り出す
            const codec = stream.codec_name ?? '';
            const copy = codec === 'mjpeg' || codec === 'png';
            const imagePath = `${tempOutput}.cover${order}.${codec === 'mjpeg' ? 'jpg' : 'png'}`;
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
                    '-c:v',
                    copy ? 'copy' : 'png',
                    imagePath,
                ],
                { jobId }
            );
            coverPaths.push(imagePath);
        }

        // メタデータは一時ファイル経由で渡す (書き込みを閉じてから ffmpeg を実行する)
        const metaText = buildMetadata(chapters, first, last, base, contentStart, rangeEnd);
        const metaPath = path.join(tempDir, 'chapters.txt');
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
        // 入力の番号: 0 = pass1、1 = チャプター情報、(2 = ストリームコピーの音声)、続いて字幕、カバーアート
        if (separateAudio) pass2.push('-itsoffset', audioOffset.toFixed(6), '-i', audioTemp);
        const subtitleInput = separateAudio ? 3 : 2;
        for (const sub of subTempPaths) {
            if (Math.abs(sub.offset) > 0.0005) {
                pass2.push('-itsoffset', sub.offset.toFixed(6));
            }
            pass2.push('-i', sub.path);
        }
        if (coverMethod === 'picture') {
            for (const coverPath of coverPaths) {
                pass2.push('-i', coverPath);
            }
        }
        pass2.push('-map', '0', '-map', '-0:d');
        if (separateAudio) {
            pass2.push('-map', '2:a');
            // 音声のタグと指定は元のストリームから引き継ぐ (取り出した一時ファイルを経るため明示する)
            audios.forEach((stream, k) => pass2.push(...streamMetadataArgs(`a:${k}`, stream, outExtension)));
        }
        for (let j = 0; j < subTempPaths.length; j++) {
            // 字幕だけを取り込む (切り出した一時ファイルにも mp4 のチャプター用トラックが付くため)
            pass2.push('-map', `${subtitleInput + j}:s`);
        }
        // カバーアートを付け直す。画像のストリームは本編の映像の後ろに並べ、元のタグも引き継ぐ。
        // mkv は元のファイル名と種類の添付ファイルにする (ほかの添付ファイルの後ろに並ぶ)
        const mainVideoCount = videoCount - attachedPics.length;
        const attachmentCount = streams.filter(stream => stream.codec_type === 'attachment').length;
        for (let j = 0; j < coverPaths.length; j++) {
            const { stream } = keepAttachedPics[j];
            if (coverMethod === 'picture') {
                const spec = `v:${mainVideoCount + j}`;
                pass2.push('-map', `${subtitleInput + subTempPaths.length + j}:v`);
                pass2.push(...streamMetadataArgs(spec, stream, outExtension), `-disposition:${spec}`, 'attached_pic');
            } else {
                const png = coverPaths[j].endsWith('.png');
                const spec = `t:${attachmentCount + j}`;
                pass2.push(
                    '-attach',
                    coverPaths[j],
                    `-metadata:s:${spec}`,
                    `mimetype=${stream.tags?.mimetype ?? (png ? 'image/png' : 'image/jpeg')}`,
                    `-metadata:s:${spec}`,
                    `filename=${stream.tags?.filename ?? `cover${j > 0 ? ` (${j + 1})` : ''}.${png ? 'png' : 'jpg'}`}`
                );
            }
        }
        // タイムコードは、出力の最初のフレーム (元の時刻 firstFrame) に合わせて進める (元のままだと切り出した位置とずれる)
        const timecode =
            options.formatTags.timecode ?? streams.find(stream => stream.tags?.timecode)?.tags?.timecode ?? null;
        const frameRate = mainVideo ? frameRateOf(mainVideo) : 0;
        const shifted = timecode && frameRate > 0 ? shiftTimecode(timecode, Math.max(0, firstFrame), frameRate) : null;
        if (shifted) {
            pass2.push('-timecode', shifted, '-metadata:s:v', `timecode=${shifted}`);
            if (options.formatTags.timecode) pass2.push('-metadata', `timecode=${shifted}`);
            log(`timecode      : ${timecode} -> ${shifted}`);
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
        // 合流させた字幕のタグ (言語・タイトルなど) と指定 (既定・強制・聴覚障害者向けなど) を元ストリームから引き継ぐ。
        // 指定しないと ffmpeg が入力ごとに既定フラグを立て、既定の字幕が複数ある状態になる
        for (let j = 0; j < subs.length; j++) {
            pass2.push(...streamMetadataArgs(`s:${j}`, subs[j].stream, outExtension));
        }
        // 出力は同じフォルダに別の名前で書き、完成してから正式な名前にする。
        // 失敗・キャンセルしたら書きかけだけを消す (上書きする場合も、元のファイルはそのまま残る)
        await produceFile(output, target => runFfmpeg([...pass2, target], { jobId }));
        log('done');
    } finally {
        // 成否・キャンセルを問わず消す (消せなかったものは次の起動時に消す)
        discardLater(tempDir);
    }
}
