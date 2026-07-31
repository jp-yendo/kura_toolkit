import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { isCancelledError } from '../ffmpeg/ffmpeg';
import { probeChapterFile, probeChapters, probeMedia } from './probe';
import { chapterLabel, defaultOutputPath } from './naming';
import { cutRange } from './cut';
import type {
    ChapterCutRequest,
    ChapterJobResult,
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

// チャプター範囲の切り出し (元: cut コマンド)
export async function chapterCut(jobId: string, request: ChapterCutRequest): Promise<ChapterJobResult> {
    startJob(jobId);
    try {
        const chapters = await probeChapters(request.input, jobId);
        const first = request.fromIndex;
        const last = request.toIndex ?? chapters.length - 1;
        if (first < 0 || last >= chapters.length || first > last) {
            throw new Error('INVALID_RANGE');
        }
        // 出力パスが明示指定されていればそれを使い、無ければチャプター名から自動生成する
        const output =
            request.outputPath ||
            defaultOutputPath(
                request.input,
                chapterLabel(chapters[first]),
                chapterLabel(chapters[last]),
                request.outputDir
            );
        const media = await probeMedia(request.input, jobId);
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
            emitLog(jobId, 'note: split before the first chapter is ignored');
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
            defaultOutputPath(
                request.input,
                chapterLabel(chapters[first]),
                chapterLabel(chapters[last]),
                request.outputDir
            )
        );
        if (new Set(outputs.map(output => path.resolve(output))).size !== outputs.length) {
            throw new Error('DUPLICATE_OUTPUTS');
        }

        const media = await probeMedia(request.input, jobId);
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
                percent: (number / ranges.length) * 100,
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
                        percent: ((number + percent / 100) / ranges.length) * 100,
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
