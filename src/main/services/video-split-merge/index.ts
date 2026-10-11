import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { isCancelledError } from '../ffmpeg/ffmpeg';
import { findVideoStreamIndex, probeVideoFile, probeChapters, probeMedia, type FfStream } from './probe';
import { decodableFrom, findKeyframeBefore } from './keyframe';
import { defaultOutputPath, namedOutputPath, rangeLabels, resolveSubtitleFriendlyOutput } from './naming';
import { cutRange } from './cut';
import { mergeFiles } from './merge';
import { accurateAudioEncoder } from './encoders';
import { availableEncoders } from '../audio-formats';
import { availableFilters } from '../ffmpeg/filters';
import type {
    VideoCutRequest,
    VideoMergeCapabilities,
    VideoMergeOutputCheck,
    VideoMergeRequest,
    ChapterInfo,
    VideoJobResult,
    VideoOutputCheck,
    VideoProbeResult,
    VideoCutMethod,
    VideoSplitNotice,
    VideoSplitRequest,
} from '../../../shared/types';

// 動画分割・結合機能の公開 API (GUI からの呼び出し単位)

export async function videoProbe(input: string): Promise<VideoProbeResult> {
    return probeVideoFile(input);
}

function emitLog(jobId: string, line: string): void {
    emitJobEvent({ jobId, kind: 'log', message: line });
}

// 切り出す範囲と出力パスを決める (実行前チェックと本処理で同じ規則を使う)
function planCut(
    request: VideoCutRequest,
    chapters: ChapterInfo[],
    streams: FfStream[]
): { first: number; last: number; output: string } {
    const first = request.fromIndex;
    const last = request.toIndex ?? chapters.length - 1;
    if (first < 0 || last >= chapters.length || first > last) {
        throw new Error('INVALID_RANGE');
    }
    // ファイル名が明示指定されていればそれを使い、無ければ範囲のチャプターから自動生成する
    // (どちらも出力先は request.outputDir。未指定なら入力と同じディレクトリ)
    const output = request.outputName
        ? namedOutputPath(request.input, request.outputDir, request.outputName)
        : defaultOutputPath(request.input, rangeLabels(chapters, first, last), request.outputDir);
    return { first, last, output: resolveSubtitleFriendlyOutput(output, streams) };
}

// 分割する範囲と出力パスを決める (実行前チェックと本処理で同じ規則を使う)
function planSplit(
    request: VideoSplitRequest,
    chapters: ChapterInfo[],
    streams: FfStream[],
    log?: (line: string) => void
): { ranges: (readonly [number, number])[]; outputs: string[] } {
    // 指定チャプターの直前を分割点として範囲の一覧に変換する
    const indices = new Set<number>();
    for (const index of request.boundaryIndexes) {
        if (index < 0 || index >= chapters.length) {
            throw new Error('INVALID_RANGE');
        }
        indices.add(index);
    }
    if (indices.has(0)) {
        // 先頭チャプターの直前での分割は範囲を生まないため無視する
        log?.('note: split before the first chapter is ignored');
        indices.delete(0);
    }
    if (indices.size === 0) {
        throw new Error('NO_SPLIT_POINT');
    }
    const boundaries = [...indices].sort((a, b) => a - b);
    const firsts = [0, ...boundaries];
    const lasts = [...boundaries.map(boundary => boundary - 1), chapters.length - 1];
    const ranges = firsts.map((first, i) => [first, lasts[i]] as const);

    // 出力名は範囲ごとに、範囲のチャプターから生成する
    const outputs = ranges.map(([first, last]) =>
        resolveSubtitleFriendlyOutput(
            defaultOutputPath(request.input, rangeLabels(chapters, first, last), request.outputDir),
            streams
        )
    );
    if (new Set(outputs.map(output => path.resolve(output))).size !== outputs.length) {
        throw new Error('DUPLICATE_OUTPUTS');
    }
    return { ranges, outputs };
}

// ビットマップ字幕のためにコンテナを変えた場合はログに残す (拡張子が変わる理由を示す)
function logContainerChange(jobId: string, requested: string, output: string): void {
    const from = path.extname(requested).toLowerCase();
    const to = path.extname(output).toLowerCase();
    // 拡張子を省略した指定 (from が空) は変更ではないため何も出さない
    if (!from || !to || from === to) return;
    emitLog(jobId, `container     : ${to.slice(1)} (bitmap subtitles are not handled reliably in ${from.slice(1)})`);
}

// 拡張子の比較用 (先頭のドットを外した小文字)
function extensionOf(filePath: string): string {
    return path.extname(filePath).toLowerCase().replace(/^\./, '');
}

// 切り出し・分割で実行前に知らせること。データのストリーム (タイムコード用・mp4 のチャプター用のトラックを除く) は
// 切り出す範囲に合わせて扱えないため含めない。カバーアートは出力形式が持てない場合 (webm など) に含められない。
// 再エンコードでは、同じ形式で書けない音声を別の形式で書く
function noticesOf(
    streams: FfStream[],
    output: string,
    accurate: boolean,
    available: Set<string> | null
): VideoSplitNotice[] {
    const losses: VideoSplitNotice[] = [];
    const extension = path.extname(output).toLowerCase();
    const chapterTracks = (stream: FfStream) => (stream.codec_tag_string ?? '').toLowerCase() === 'text';
    const dataCodecs = new Set(
        streams
            .filter(stream => stream.codec_type === 'data')
            .filter(stream => !chapterTracks(stream) && (stream.codec_tag_string ?? '').toLowerCase() !== 'tmcd')
            .map(stream => stream.codec_name || stream.codec_tag_string || '?')
    );
    for (const codec of dataCodecs) losses.push({ kind: 'data', codec });
    const hasCover = streams.some(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic);
    const coverContainers = new Set(['.mp4', '.m4v', '.mov', '.m4a', '.mp3', '.flac', '.mkv']);
    if (hasCover && !coverContainers.has(extension)) losses.push({ kind: 'coverArt' });
    if (accurate) {
        for (const stream of streams.filter(item => item.codec_type === 'audio')) {
            const { encoder, converted } = accurateAudioEncoder(stream, extension, available);
            if (converted) losses.push({ kind: 'audioConverted', codec: stream.codec_name ?? '?', to: encoder });
        }
    }
    return losses;
}

// ロスレスで切り出す範囲のうち、始まり (直前のキーフレーム) から正しくデコードできないものの、最初のチャプターの番号を返す
async function uncleanStarts(input: string, streams: FfStream[], starts: RangeStart[]): Promise<number[]> {
    const index = findVideoStreamIndex(streams);
    if (index === null) return [];
    const codec = streams.find(stream => stream.index === index)?.codec_name;
    const found: number[] = [];
    for (const { chapter, start } of starts) {
        const keyframe = await findKeyframeBefore(input, index, start);
        if (!(await decodableFrom(input, index, codec, keyframe.time, true))) found.push(chapter);
    }
    return found;
}

// 切り出す範囲の始まり (最初のチャプターの番号と、元の時刻)
type RangeStart = { chapter: number; start: number };

// 出力パスのうち既に存在するものと、実行前に知らせることを調べる
async function checkExisting(
    input: string,
    requested: string,
    outputs: string[],
    streams: FfStream[],
    method: VideoCutMethod,
    starts: RangeStart[]
): Promise<VideoOutputCheck> {
    const accurate = method === 'reencode';
    const existing = outputs.filter(output => {
        try {
            return fs.existsSync(output);
        } catch {
            // 判定できない場合は確認対象にしない (実行時に改めて失敗を返す)
            return false;
        }
    });
    const from = extensionOf(requested);
    const to = outputs.length > 0 ? extensionOf(outputs[0]) : from;
    return {
        outputs,
        existing,
        containerChange: from && to && from !== to ? { from, to } : null,
        notices: outputs.length > 0 ? await notices() : [],
    };

    async function notices(): Promise<VideoSplitNotice[]> {
        const found = noticesOf(streams, outputs[0], accurate, accurate ? await availableEncoders() : null);
        if (method === 'lossless') {
            const chapters = await uncleanStarts(input, streams, starts);
            if (chapters.length > 0) found.push({ kind: 'uncleanStart', chapters });
        }
        return found;
    }
}

// 切り出しの出力先を実行前に調べる (上書き確認に使う)
export async function videoCheckCut(request: VideoCutRequest): Promise<VideoOutputCheck> {
    const chapters = await probeChapters(request.input);
    const media = await probeMedia(request.input);
    const { first, output } = planCut(request, chapters, media.streams);
    return checkExisting(request.input, request.outputName || request.input, [output], media.streams, request.method, [
        { chapter: first + 1, start: chapters[first].start },
    ]);
}

// 分割の出力先を実行前に調べる (上書き確認に使う)
export async function videoCheckSplit(request: VideoSplitRequest): Promise<VideoOutputCheck> {
    const chapters = await probeChapters(request.input);
    const media = await probeMedia(request.input);
    const { ranges, outputs } = planSplit(request, chapters, media.streams);
    return checkExisting(
        request.input,
        request.input,
        outputs,
        media.streams,
        request.method,
        ranges.map(([first]) => ({ chapter: first + 1, start: chapters[first].start }))
    );
}

// チャプター範囲の切り出し
export async function videoCut(jobId: string, request: VideoCutRequest): Promise<VideoJobResult> {
    startJob(jobId);
    try {
        const chapters = await probeChapters(request.input, jobId);
        const media = await probeMedia(request.input, jobId);
        const { first, last, output } = planCut(request, chapters, media.streams);
        logContainerChange(jobId, request.outputName || request.input, output);
        await cutRange({
            inputPath: request.input,
            chapters,
            streams: media.streams,
            formatName: media.formatName,
            formatTags: media.formatTags,
            first,
            last,
            output,
            method: request.method,
            jobId,
            log: line => emitLog(jobId, line),
            onProgress: percent => emitJobEvent({ jobId, kind: 'progress', percent }),
        });
        return { outputs: [output], cancelled: false };
    } catch (error) {
        if (isCancelledError(error)) {
            return { outputs: [], cancelled: true };
        }
        throw error;
    } finally {
        finishJob(jobId);
    }
}

// 指定チャプターの直前を分割点として複数ファイルに分割する
export async function videoSplit(jobId: string, request: VideoSplitRequest): Promise<VideoJobResult> {
    startJob(jobId);
    const outputsDone: string[] = [];
    try {
        const chapters = await probeChapters(request.input, jobId);
        const media = await probeMedia(request.input, jobId);
        const { ranges, outputs } = planSplit(request, chapters, media.streams, line => emitLog(jobId, line));
        logContainerChange(jobId, request.input, outputs[0]);
        // 全体の進み具合は、切り出す範囲の長さの合計で決める (範囲の長さが違っても進み方がずれず、残り時間を
        // 見積もれるように)。終わった範囲の長さと、切り出し中の範囲の進み具合から求める
        const lengths = ranges.map(([first, last]) => Math.max(0, chapters[last].end - chapters[first].start));
        const totalLength = lengths.reduce((sum, value) => sum + value, 0);
        const overall = (number: number, percent: number) => {
            if (totalLength <= 0) return ((number + percent / 100) / ranges.length) * 100;
            const done = lengths.slice(0, number).reduce((sum, value) => sum + value, 0);
            return ((done + lengths[number] * (percent / 100)) / totalLength) * 100;
        };
        for (let number = 0; number < ranges.length; number++) {
            if (isCancelled(jobId)) {
                return { outputs: outputsDone, cancelled: true };
            }
            const [first, last] = ranges[number];
            emitLog(jobId, `=== part ${number + 1}/${ranges.length} ===`);
            emitJobEvent({
                jobId,
                kind: 'progress',
                current: number + 1,
                total: ranges.length,
                percent: overall(number, 0),
            });
            await cutRange({
                inputPath: request.input,
                chapters,
                streams: media.streams,
                formatName: media.formatName,
                formatTags: media.formatTags,
                first,
                last,
                output: outputs[number],
                method: request.method,
                jobId,
                log: line => emitLog(jobId, line),
                onProgress: percent =>
                    emitJobEvent({
                        jobId,
                        kind: 'progress',
                        current: number + 1,
                        total: ranges.length,
                        percent: overall(number, percent),
                    }),
            });
            outputsDone.push(outputs[number]);
        }
        return { outputs: outputsDone, cancelled: false };
    } catch (error) {
        if (isCancelledError(error)) {
            return { outputs: outputsDone, cancelled: true };
        }
        throw error;
    } finally {
        finishJob(jobId);
    }
}

// 複数のファイルを並べた順に 1 つのファイルへ結合する
export async function videoMerge(jobId: string, request: VideoMergeRequest): Promise<VideoJobResult> {
    startJob(jobId);
    try {
        const output = await mergeFiles({
            request,
            jobId,
            log: line => emitLog(jobId, line),
            onProgress: percent => emitJobEvent({ jobId, kind: 'progress', percent }),
        });
        return { outputs: [output], cancelled: false };
    } catch (error) {
        if (isCancelledError(error)) {
            return { outputs: [], cancelled: true };
        }
        throw error;
    } finally {
        finishJob(jobId);
    }
}

// 使っている ffmpeg にあるエンコーダとフィルタ (調べられない場合は null)
export async function videoCapabilities(): Promise<VideoMergeCapabilities> {
    const [encoders, filters] = await Promise.all([availableEncoders(), availableFilters()]);
    return { encoders: encoders ? [...encoders] : null, filters: filters ? [...filters] : null };
}

// 結合の出力先のフォルダがあるか・同じ名前のファイルが既にあるか
export async function videoCheckMergeOutput(output: string): Promise<VideoMergeOutputCheck> {
    const resolved = path.resolve(output);
    const isDirectory = (target: string) => {
        try {
            return fs.statSync(target).isDirectory();
        } catch {
            return false;
        }
    };
    return { directoryExists: isDirectory(path.dirname(resolved)), exists: fs.existsSync(resolved) };
}
