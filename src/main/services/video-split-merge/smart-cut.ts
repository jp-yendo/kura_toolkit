import fs from 'fs';
import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { accurateStreamArgs } from './encoders';
import { hdrArgs } from './hdr';
import {
    copyStartSeek,
    findCopyEndBefore,
    findKeyframeBefore,
    decodableFrom,
    firstFrameFrom,
    FRAME_TOLERANCE,
    keyframesWithin,
    countFrames,
} from './keyframe';
import { concatPath } from './merge-subtitles';
import { hasAlphaLayer, probeHdrMetadata, type FfStream } from './probe';
import { streamMetadataArgs } from './stream-metadata';
import { HDR_METADATA_ENCODERS, VIDEO_ENCODERS } from '../../../shared/video-codecs';

// スマートカット: 映像を指定の位置で正確に切り、再エンコードはキーフレームで切れない部分 (始まりから写し始めるキーフレーム
// までと、写し終えるキーフレームから終わりまで) だけにとどめ、間はストリームコピーで写す

const QUIET = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];

// キーフレームごとに映像の設定 (SPS/PPS など) を持てる形式 (MPEG-TS) を経由してつなげるコーデック。再エンコードした部分と
// 写した部分で設定が違っても、それぞれの部分の設定でデコードできる
const IN_BAND_CODECS = new Set(['h264', 'hevc', 'mpeg2video', 'mpeg1video']);

// ffprobe の H.264 のプロファイル名 -> libx264 の指定 (写した部分と同じプロファイルで再エンコードするため)
const H264_PROFILES: Record<string, string> = {
    Baseline: 'baseline',
    'Constrained Baseline': 'baseline',
    Main: 'main',
    High: 'high',
    'High 10': 'high10',
    'High 4:2:2': 'high422',
    'High 4:4:4 Predictive': 'high444',
};

// 写す部分の各キーフレームの前に、元の映像の設定 (SPS/PPS など。mp4・mkv ではファイルの先頭にだけ持つ) を入れる指定。
// 写し始めるキーフレームが IDR でない場合、ffmpeg は設定を IDR の前にしか入れないため、写した部分が直前に再エンコードした
// 部分の設定でデコードされて崩れる
function parameterSetArgs(video: FfStream): string[] {
    if (video.codec_name === 'h264') return ['-bsf:v', 'h264_mp4toannexb,dump_extra=freq=keyframe'];
    if (video.codec_name === 'hevc') return ['-bsf:v', 'hevc_mp4toannexb,dump_extra=freq=keyframe'];
    return [];
}

export type SmartCutOptions = {
    inputPath: string;
    // 本編の映像と、映像ストリームの中での順番
    video: FfStream;
    videoOrder: number;
    start: number;
    end: number;
    // 書き出す一時ファイル (映像だけ。mkv の添付ファイルも含める) と、出力の拡張子 (小文字、ドット付き)
    output: string;
    extension: string;
    tempDir: string;
    jobId: string;
    log: (line: string) => void;
};

// 再エンコードする部分の映像の引数 (元と同じコーデック・画素形式・ビットレート・プロファイル・色の規格・HDR の情報)
async function encodeArgs(options: SmartCutOptions): Promise<string[]> {
    const { video, inputPath, videoOrder, jobId } = options;
    const args = [...accurateStreamArgs([video], []).args];
    const encoder = VIDEO_ENCODERS[video.codec_name ?? ''] ?? 'libx264';
    if (encoder === 'libx264') {
        const profile = H264_PROFILES[video.profile ?? ''];
        if (profile) args.push('-profile:v', profile);
        const level = Number(video.level ?? NaN);
        if (Number.isFinite(level) && level > 0) args.push('-level:v', (level / 10).toFixed(1));
    }
    for (const [option, value] of [
        ['-color_primaries', video.color_primaries],
        ['-color_trc', video.color_transfer],
        ['-colorspace', video.color_space],
        ['-color_range', video.color_range],
    ]) {
        if (value && value !== 'unknown') args.push(`${option}:v:0`, value);
    }
    if (video.color_transfer === 'smpte2084' && HDR_METADATA_ENCODERS.has(encoder)) {
        args.push(...hdrArgs(encoder, 0, await probeHdrMetadata(inputPath, videoOrder, jobId)));
    }
    return args;
}

// 映像を start から end まで正確に書き出す
export async function smartCutVideo(options: SmartCutOptions): Promise<void> {
    const { inputPath, video, videoOrder, start, end, tempDir, jobId, log } = options;
    const index = video.index;
    const before = await findKeyframeBefore(inputPath, index, start, jobId);
    const inside = await keyframesWithin(inputPath, index, start, end, jobId);
    // キーフレームを早い順に並べたもの (写し始めるキーフレームの 1 つ前を copyStartSeek に渡すため、始まりより前のものも含める)
    const keyframes = [...new Set([...(before.previous !== null ? [before.previous] : []), before.time, ...inside])];
    const startIsKeyframe = Math.abs(before.time - start) <= 0.001;

    // 写し始めるキーフレーム: 始まりがキーフレームならそこ、そうでなければ範囲内のキーフレームのうち、そこから写し始めても
    // 正しくデコードできる (decodableFrom) 最初のもの。始まりからそこまでを再エンコードする
    let copyFrom: number | null = null;
    for (const keyframe of startIsKeyframe ? [before.time, ...inside] : inside) {
        if (await decodableFrom(inputPath, index, video.codec_name, keyframe, false, jobId)) {
            copyFrom = keyframe;
            break;
        }
    }

    // 写す部分の終わりと、終わり側で再エンコードする部分の始まり (tailFrom)。写すのは、終わり以前で表示が途切れない
    // 最も遅い位置まで (B フレームの参照先が終わりより後ろにある場合は、その手前の B フレームの並びの区切り)。
    // そこから終わりまでを再エンコードする
    let copyEnd: { decodeEnd: number; displayEnd: number } | null = null;
    let tailFrom: number | null = null;
    if (copyFrom !== null) {
        copyEnd = await findCopyEndBefore(inputPath, index, copyFrom, end, jobId);
        // 写せる部分が無ければ範囲全体を再エンコードする
        if (copyEnd === null) copyFrom = null;
        else if (copyEnd.displayEnd < end - 0.0005) tailFrom = copyEnd.displayEnd;
    }

    const segmentExtension = IN_BAND_CODECS.has(video.codec_name ?? '') ? '.ts' : '.mkv';
    const decoder = hasAlphaLayer(video) ? ['-c:v', video.codec_name === 'vp8' ? 'libvpx' : 'libvpx-vp9'] : [];
    const encoding = await encodeArgs(options);
    // 各部分のファイルと、その最初のフレームの元の表示の時刻
    const segments: Array<{ file: string; first: number }> = [];
    const encode = async (from: number, to: number, first: number) => {
        const file = path.join(tempDir, `smart${segments.length}${segmentExtension}`);
        await runFfmpeg(
            [
                ...QUIET,
                // 範囲に含めるフレームの規則に合わせて手前にずらす (FRAME_TOLERANCE)
                '-ss',
                (from - FRAME_TOLERANCE).toFixed(6),
                '-to',
                (to - FRAME_TOLERANCE).toFixed(6),
                ...decoder,
                '-i',
                inputPath,
                '-map',
                `0:v:${videoOrder}`,
                // 終わりは -to だけに任せず、範囲に含まれるフレームの数で止める (-to は境界ちょうどのフレームを含めるかが
                // 時刻の基準と丸めで変わり、隣の範囲と 1 フレーム重なることがある)
                '-frames:v',
                String(await countFrames(inputPath, index, from, to, jobId)),
                ...encoding,
                '-avoid_negative_ts',
                'make_zero',
                file,
            ],
            { jobId }
        );
        segments.push({ file, first });
        log(`  re-encoded  : ${from.toFixed(3)} - ${to.toFixed(3)}`);
    };

    // 始まりから写し始めるキーフレームまで (範囲内にキーフレームが無ければ範囲全体) を再エンコードする
    if (copyFrom === null || copyFrom > start + 0.001) {
        await encode(start, copyFrom ?? end, await firstFrameFrom(inputPath, index, start, jobId));
    }
    if (copyFrom !== null && copyEnd) {
        const file = path.join(tempDir, `smart${segments.length}${segmentExtension}`);
        // 1 つ前のキーフレームの直後を出力側の -ss に渡し、写し始めるキーフレームから書かせる (copyStartSeek)
        const seek = copyStartSeek({ time: copyFrom, previous: keyframes[keyframes.indexOf(copyFrom) - 1] ?? null });
        await runFfmpeg(
            [
                ...QUIET,
                '-copyts',
                '-ss',
                copyFrom.toFixed(6),
                '-to',
                copyEnd.decodeEnd.toFixed(6),
                '-i',
                inputPath,
                '-map',
                `0:v:${videoOrder}`,
                '-c',
                'copy',
                ...parameterSetArgs(video),
                '-ss',
                seek.toFixed(6),
                '-avoid_negative_ts',
                'make_zero',
                file,
            ],
            { jobId }
        );
        const copyTo = tailFrom ?? copyEnd.displayEnd;
        segments.push({ file, first: copyFrom });
        log(`  copied      : ${copyFrom.toFixed(3)} - ${copyTo.toFixed(3)}`);
    }
    if (tailFrom !== null) await encode(tailFrom, end, tailFrom);

    // 各部分の長さ (最初のフレームから次の部分の最初のフレームまで) を明示してつなげる (それぞれの部分の始まりは 0 秒に
    // 寄せられる。切る位置がフレームの途中にあっても、フレームの間隔が元のまま続く)。最後の部分は長さを指定しない。
    // mkv の添付ファイル (フォントなど) は元のファイルから取り込む (-t 0 で添付ファイルだけを読む)
    const listPath = path.join(tempDir, 'smart.txt');
    const lines = ['ffconcat version 1.0'];
    segments.forEach((segment, i) => {
        lines.push(`file ${concatPath(segment.file)}`);
        const next = segments[i + 1];
        if (next) lines.push(`duration ${(next.first - segment.first).toFixed(6)}`);
    });
    fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf-8');
    await runFfmpeg(
        [
            ...QUIET,
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-t',
            '0',
            '-i',
            inputPath,
            '-map',
            '0:v',
            '-map',
            '1:t?',
            '-c',
            'copy',
            ...streamMetadataArgs('v:0', video, options.extension),
            '-avoid_negative_ts',
            'make_zero',
            options.output,
        ],
        { jobId }
    );

    // 再エンコードした部分が無ければ (範囲全体を写しただけで) つなぎ目は無いため、確かめない
    if (segments.length === 1 && copyFrom !== null) return;
    // つなぎ目を含めて映像をすべてデコードし、誤りが無く、元の範囲と同じ数のフレームが表示されることを確かめる
    // (誤りがあれば再生ソフトでも乱れ、数が違えばフレームが欠けている・重なっているため失敗とする)
    const errors: string[] = [];
    let decoded = 0;
    await runFfmpeg([...QUIET, '-progress', 'pipe:1', '-i', options.output, '-map', '0:v', '-f', 'null', '-'], {
        jobId,
        onStdoutLine: line => {
            const match = /^frame=(\d+)/.exec(line);
            if (match) decoded = Number(match[1]);
        },
        onStderrLine: line => {
            if (line.trim()) errors.push(line.trim());
        },
    });
    if (errors.length > 0) {
        log(`  decode check: ${errors[0]}`);
        throw new Error('SMART_CUT_FAILED');
    }
    const expected = await countFrames(inputPath, index, start, end, jobId);
    if (decoded !== expected) {
        log(`  frame check : ${decoded} frames (source range has ${expected})`);
        throw new Error('SMART_CUT_FAILED');
    }
}
