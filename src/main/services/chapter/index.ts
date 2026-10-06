import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { isCancelledError } from '../ffmpeg/ffmpeg';
import { probeChapterFile, probeChapters, probeMedia, type FfStream } from './probe';
import { chapterLabel, defaultOutputPath, namedOutputPath, resolveSubtitleFriendlyOutput } from './naming';
import { cutRange } from './cut';
import type {
    ChapterCutRequest,
    ChapterInfo,
    ChapterJobResult,
    ChapterOutputCheck,
    ChapterProbeResult,
    ChapterSplitRequest,
} from '../../../shared/types';

// チャプターカット機能の公開 API (GUI からの呼び出し単位)

export async function chapterProbe(input: string): Promise<ChapterProbeResult> {
    return probeChapterFile(input);
}

function emitLog(jobId: string, line: string): void {
    emitJobEvent({ jobId, kind: 'log', message: line });
}

// 切り出す範囲と出力パスを決める (実行前チェックと本処理で同じ規則を使う)
function planCut(
    request: ChapterCutRequest,
    chapters: ChapterInfo[],
    streams: FfStream[]
): { first: number; last: number; output: string } {
    const first = request.fromIndex;
    const last = request.toIndex ?? chapters.length - 1;
    if (first < 0 || last >= chapters.length || first > last) {
        throw new Error('INVALID_RANGE');
    }
    // ファイル名が明示指定されていればそれを使い、無ければチャプター名から自動生成する
    // (どちらも出力先は request.outputDir。未指定なら入力と同じディレクトリ)
    const output = request.outputName
        ? namedOutputPath(request.input, request.outputDir, request.outputName)
        : defaultOutputPath(
              request.input,
              chapterLabel(chapters[first]),
              chapterLabel(chapters[last]),
              request.outputDir
          );
    return { first, last, output: resolveSubtitleFriendlyOutput(output, streams) };
}

// 分割する範囲と出力パスを決める (実行前チェックと本処理で同じ規則を使う)
function planSplit(
    request: ChapterSplitRequest,
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

    // 出力名は cut の既定と同じ仕様で範囲ごとに生成する
    const outputs = ranges.map(([first, last]) =>
        resolveSubtitleFriendlyOutput(
            defaultOutputPath(
                request.input,
                chapterLabel(chapters[first]),
                chapterLabel(chapters[last]),
                request.outputDir
            ),
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

// 出力パスのうち既に存在するものを調べる
function checkExisting(requested: string, outputs: string[]): ChapterOutputCheck {
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
    return { outputs, existing, containerChange: from && to && from !== to ? { from, to } : null };
}

// 切り出しの出力先を実行前に調べる (上書き確認に使う)
export async function chapterCheckCut(request: ChapterCutRequest): Promise<ChapterOutputCheck> {
    const chapters = await probeChapters(request.input);
    const media = await probeMedia(request.input);
    return checkExisting(request.outputName || request.input, [planCut(request, chapters, media.streams).output]);
}

// 分割の出力先を実行前に調べる (上書き確認に使う)
export async function chapterCheckSplit(request: ChapterSplitRequest): Promise<ChapterOutputCheck> {
    const chapters = await probeChapters(request.input);
    const media = await probeMedia(request.input);
    return checkExisting(request.input, planSplit(request, chapters, media.streams).outputs);
}

// チャプター範囲の切り出し (元: cut コマンド)
export async function chapterCut(jobId: string, request: ChapterCutRequest): Promise<ChapterJobResult> {
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
            first,
            last,
            output,
            accurate: request.accurate,
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

// 指定チャプターの直前を分割点として複数ファイルに分割する (元: split コマンド)
export async function chapterSplit(jobId: string, request: ChapterSplitRequest): Promise<ChapterJobResult> {
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
                first,
                last,
                output: outputs[number],
                accurate: request.accurate,
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
