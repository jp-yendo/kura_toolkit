import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
    DEFAULT_VECTORIZE_OUTPUT,
    DEFAULT_VECTORIZE_PREPROCESS,
    VECTORIZE_OUTPUT_RANGES,
    VECTORIZE_PREPROCESS_RANGES,
} from '../../shared/vectorizer';
import type {
    ImagePreview,
    VectorizeJobResult,
    VectorizeOutput,
    VectorizePreprocess,
    VectorizeRequest,
} from '../../shared/types';
import { emitJobEvent, finishJob, isCancelled, startJob } from './job-manager';
import { forgetMedia, mediaUrl } from './media-protocol';
import { normalizeVectorizeParams } from './vectorizer-presets';
import type { TraceProgress } from './vector-trace/pipeline';
import { countPaths } from './vector-trace/svg-model';
import type { TraceWorkerInit } from './vector-trace/worker-protocol';
import { discardLater, newTempDir } from './work-dir';
import { runWorkerJob } from './worker-job';

// 画像 -> SVG 変換 (処理は vector-trace/ をワーカースレッドで動かす)。
// 元画像と変換結果は、中身を renderer へ渡さず、表示用の URL (kura-media://) で見せる。
// 変換結果は作業ディレクトリのファイルに置き、保存はそのファイルを写す (最後の 1 つだけを持つ)

let currentResult: { id: string; dir: string; file: string } | null = null;

// 変換結果を片付ける
export function discardVectorizeResult(): void {
    if (!currentResult) return;
    forgetMedia(currentResult.file);
    discardLater(currentResult.dir);
    currentResult = null;
}

// 数値を範囲に収めた整数にする (数値でないときは fallback)
export function numberIn(value: unknown, range: { min: number; max: number }, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.round(Math.min(range.max, Math.max(range.min, value)));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

// renderer から受け取った前処理を、範囲に収めた値にする (欠けた値・型の違う値は既定値)
export function normalizeVectorizePreprocess(value: unknown): VectorizePreprocess {
    const preprocess: Partial<VectorizePreprocess> = typeof value === 'object' && value !== null ? value : {};
    const defaults = DEFAULT_VECTORIZE_PREPROCESS;
    return {
        longSide: numberIn(preprocess.longSide, VECTORIZE_PREPROCESS_RANGES.longSide, defaults.longSide),
        upscale:
            preprocess.upscale === 'nearest' || preprocess.upscale === 'bilinear'
                ? preprocess.upscale
                : defaults.upscale,
        removeBackground: booleanOr(preprocess.removeBackground, defaults.removeBackground),
        backgroundTolerance: numberIn(
            preprocess.backgroundTolerance,
            VECTORIZE_PREPROCESS_RANGES.backgroundTolerance,
            defaults.backgroundTolerance
        ),
        speckArea: numberIn(preprocess.speckArea, VECTORIZE_PREPROCESS_RANGES.speckArea, defaults.speckArea),
        grayscale: booleanOr(preprocess.grayscale, defaults.grayscale),
        recolor: booleanOr(preprocess.recolor, defaults.recolor),
    };
}

// renderer から受け取った出力の設定を、範囲に収めた値にする (欠けた値・型の違う値は既定値)
export function normalizeVectorizeOutput(value: unknown): VectorizeOutput {
    const output: Partial<VectorizeOutput> = typeof value === 'object' && value !== null ? value : {};
    return {
        optimize: booleanOr(output.optimize, DEFAULT_VECTORIZE_OUTPUT.optimize),
        pathPrecision: numberIn(
            output.pathPrecision,
            VECTORIZE_OUTPUT_RANGES.pathPrecision,
            DEFAULT_VECTORIZE_OUTPUT.pathPrecision
        ),
    };
}

// renderer から受け取った要求を、範囲に収めた値にする (欠けた値・型の違う値は既定値)
function normalizeRequest(request: VectorizeRequest): VectorizeRequest {
    return {
        params: normalizeVectorizeParams(request?.params),
        preprocess: normalizeVectorizePreprocess(request?.preprocess),
        output: normalizeVectorizeOutput(request?.output),
    };
}

// 変換の段階と進み具合を知らせる (段階の文言は jobPhases.svg.<段階>。進み具合が分からない段階は進捗バーを不定にする)
function emitTraceProgress(jobId: string, progress: TraceProgress): void {
    emitJobEvent({
        jobId,
        kind: 'progress',
        percent: progress.fraction === undefined ? null : progress.fraction * 100,
        phase: {
            id: `svg.${progress.phase}`,
            fraction: progress.fraction,
        },
    });
}

// 変換をワーカースレッドで行う。取り消したときは null
function traceInWorker(jobId: string, filePath: string, request: VectorizeRequest): Promise<string | null> {
    return runWorkerJob<TraceProgress, string>(jobId, {
        script: 'vectorizer-worker.js',
        workerData: { filePath, request } satisfies TraceWorkerInit,
        onProgress: progress => emitTraceProgress(jobId, progress),
        runInProcess: async hooks => {
            const { traceImageFile } = await import('./vector-trace/pipeline');
            return traceImageFile(filePath, request, hooks);
        },
    });
}

// 画像を表示用に公開する (画像の中身は renderer が表示するときに読む)
export function imagePreview(filePath: string): ImagePreview {
    return { url: mediaUrl(filePath), fileName: path.basename(filePath) };
}

// プレビュー用に画像を公開する (画像の中身は renderer が表示するときに読む)。
// 画像を選び直すと前の変換結果は使わなくなるため、ここで片付ける
export function loadImagePreview(filePath: string): ImagePreview {
    const preview = imagePreview(filePath);
    discardVectorizeResult();
    return preview;
}

// 画像ファイルを SVG に変換し (ジョブ。進み具合を知らせ、取り消せる)、作業ディレクトリのファイルに置く
// (前の変換結果は片付ける)。取り消したときは前の変換結果を残し、cancelled を true にして返す
export async function convertImage(
    jobId: string,
    filePath: string,
    request: VectorizeRequest
): Promise<VectorizeJobResult> {
    const normalized = normalizeRequest(request);
    startJob(jobId);
    try {
        const svg = await traceInWorker(jobId, filePath, normalized);
        if (svg === null || isCancelled(jobId)) return { svg: null, cancelled: true };
        const dir = newTempDir();
        const file = path.join(dir, 'result.svg');
        try {
            await fs.writeFile(file, svg, 'utf-8');
        } catch (error) {
            discardLater(dir);
            throw error;
        }
        discardVectorizeResult();
        currentResult = { id: crypto.randomUUID(), dir, file };
        return {
            svg: {
                id: currentResult.id,
                url: mediaUrl(file),
                pathCount: countPaths(svg),
                bytes: Buffer.byteLength(svg, 'utf-8'),
            },
            cancelled: false,
        };
    } finally {
        finishJob(jobId);
    }
}

// 変換結果を保存先へ写す (resultId は convertImage が返したもの)
export async function saveSvgFile(resultId: string, filePath: string): Promise<void> {
    if (!currentResult || currentResult.id !== resultId) throw new Error('SVG_RESULT_GONE');
    await fs.copyFile(currentResult.file, filePath);
}
