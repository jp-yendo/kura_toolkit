import { optimize, OptimizePreset, type Config } from '@neplex/vectorizer';
import type { VectorizeParams, VectorizePreprocess, VectorizeRequest } from '../../../shared/types';
import { binarizeAlpha, opaqueMask, removeBackground, removeSpecks } from './background';
import { splitMixedShapes } from './color-split';
import { FIDELITY_LONG_SIDE, makeReference, measureFidelity, type FidelityReference } from './fidelity';
import { GRAY_LEVEL_COUNTS, grayScanSteps, levelThresholds, scanGray } from './gray-scan';
import { flattenOnWhite, grayToRgba, loadImageLong, shrinkGrayLong, shrinkLong, toGrayLevels } from './image-io';
import { recolor } from './recolor';
import { readSvgFrame, toSvg, withDisplaySize, withSvgFrame, type SvgModel } from './svg-model';
import { binaryTraceConfig, traceConfig, traceRgba } from './trace';
import {
    isTraceCancelled,
    OPAQUE_ALPHA,
    throwIfCancelled,
    type GrayImage,
    type PreparedImage,
    type RgbaImage,
} from './types';

// 画像ファイルを SVG にする処理の流れ (読み込み・前処理・変換・最適化)。画面に依存しない。
// 段階ごとにも呼べる (preprocessImageFile -> traceImage -> optimizeSvg。traceImageFile はこれを順に行う)。
// 変換の候補を 1 つずつ作る部品 (traceColorImage・prepareGrayTrace と traceGrayLevels) と、再現度で比べる元画像も公開する。
// どの関数も、取り消されたときは KURA_CANCELLED のエラーを投げる。
// traceImage・traceImageFile が返す SVG は、座標を処理の大きさ (viewBox) で持ち、表示の大きさ (width / height) を
// 元画像の大きさにする

// 処理の段階 (load: 読み込み、background: 背景と小さな点の除去、trace: ベクター化、optimize: パスの最適化)
export type TracePhase = 'load' | 'background' | 'trace' | 'optimize';

export type TraceProgress = {
    phase: TracePhase;
    // 段階の中の進み具合 (0-1。分からない段階では省略)
    fraction?: number;
};

export type TraceHooks = {
    signal: AbortSignal;
    onProgress(progress: TraceProgress): void;
};

// 変換ライブラリの失敗をコード付きのエラーにする (理由は「Unknown error occurred」としか返らないことが多い)
function vectorizeFailed(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('VECTORIZE_FAILED')) return error as Error;
    return new Error(`VECTORIZE_FAILED: ${message}`, { cause: error });
}

// 再現度を測るときに比べる元画像 (長辺 FIDELITY_LONG_SIDE 以下、不透明)。image は前処理した画像 (PreparedImage の
// image。透過あり) で、白地に合成して使う。grayscale のときはグレースケールにしたもの
export async function buildFidelitySample(image: RgbaImage, grayscale: boolean): Promise<RgbaImage> {
    if (grayscale) return grayToRgba(await shrinkGrayLong(await toGrayLevels(image), FIDELITY_LONG_SIDE));
    return shrinkLong(await flattenOnWhite(image), FIDELITY_LONG_SIDE);
}

// 再現度を測るときに比べる元画像 (buildFidelitySample) の明るさ・Lab・勾配。
// 測る SVG は、表示の大きさによらず、この元画像と同じ大きさに描いて比べる
async function buildFidelityReference(image: RgbaImage, grayscale: boolean): Promise<FidelityReference> {
    return makeReference(await buildFidelitySample(image, grayscale));
}

// カラー (または白黒) の変換。白黒モードはアルファを無視するため、白地に合成してから変換する
// (透過した部分は白になり、形を作らない)。変換できないときは VECTORIZE_FAILED
export async function traceColorImage(
    image: RgbaImage,
    params: VectorizeParams,
    pathPrecision: number,
    signal: AbortSignal
): Promise<string> {
    const input = params.colorMode === 'binary' ? await flattenOnWhite(image) : binarizeAlpha(image);
    try {
        return await traceRgba(input, traceConfig(params, pathPrecision), signal);
    } catch (error) {
        throwIfCancelled(signal);
        throw vectorizeFailed(error);
    }
}

async function traceColor(image: RgbaImage, request: VectorizeRequest, hooks: TraceHooks): Promise<string> {
    hooks.onProgress({ phase: 'trace' });
    return traceColorImage(image, request.params, request.output.pathPrecision, hooks.signal);
}

// グレースケールの変換で、段階の数によらず使う値 (画像から一度だけ求める)
type GrayTraceContext = {
    // 不透明な画素の印
    opaque: Uint8Array;
    // 白地に合成した画像と、その明るさ
    flat: RgbaImage;
    gray: GrayImage;
    // 色を再現するときの色の元 (白地に合成し、長辺 FIDELITY_LONG_SIDE 以下に縮小した元画像)。再現しないときは null
    sample: RgbaImage | null;
    // 再現度で比べる元画像 (色を再現するときは sample、しないときは元画像をグレースケールにしたもの)
    reference: FidelityReference;
};

// グレースケールの変換の準備 (recolor は、変換した形に元画像の色を付け直すか)
export async function prepareGrayTrace(image: RgbaImage, recolor: boolean): Promise<GrayTraceContext> {
    const opaque = opaqueMask(image);
    const flat = await flattenOnWhite(image);
    const gray = await toGrayLevels(image);
    const sample = recolor ? await shrinkLong(flat, FIDELITY_LONG_SIDE) : null;
    const reference = sample ? makeReference(sample) : await buildFidelityReference(image, true);
    return { opaque, flat, gray, sample, reference };
}

// 段階の数ごとの仕上げ (色の付け直し・分け直し・再現度) の手間の数
export function grayFinishSteps(context: GrayTraceContext): number {
    return context.sample ? 3 : 1;
}

// 1 つの段階の数 (しきい値 thresholds) で変換し、SVG (座標と表示の大きさは処理の大きさ) と再現度を返す。
// 色を再現するときは形ごとに元画像の色を付け直し、色味が 2 つに分かれる形を分け直す (再現度が上がるときだけ採る)。
// onStep は白黒画像 1 つと仕上げの 1 段ごとに呼ぶ (合わせて grayScanSteps(thresholds) + grayFinishSteps(context) 回)。
// 試みた白黒画像がすべて変換できなかったときは失敗する
export async function traceGrayLevels(
    context: GrayTraceContext,
    thresholds: number[],
    config: Config,
    signal: AbortSignal,
    onStep: () => void
): Promise<{ svg: string; fidelity: number }> {
    const { opaque, flat, gray, sample, reference } = context;
    const scan = await scanGray(gray, opaque, thresholds, config, signal, onStep);
    if (scan.attempted > 0 && scan.traced === 0) throw new Error('every threshold failed');
    if (!sample) {
        const svg = toSvg(scan.model);
        const fidelity = measureFidelity(reference, svg);
        onStep();
        return { svg, fidelity };
    }
    const colored = recolor(scan.model, sample);
    let svg = toSvg(colored);
    let fidelity = measureFidelity(reference, svg);
    onStep();
    throwIfCancelled(signal);
    let split: SvgModel | null = null;
    try {
        split = await splitMixedShapes(colored, flat, opaque, config, signal);
    } catch (error) {
        // 分け直しの変換に失敗したときは、分け直さない
        if (isTraceCancelled(error)) throw error;
    }
    onStep();
    if (split) {
        const splitSvg = toSvg(recolor(split, sample));
        const splitFidelity = measureFidelity(reference, splitSvg);
        if (splitFidelity > fidelity) {
            svg = splitSvg;
            fidelity = splitFidelity;
        }
    }
    onStep();
    return { svg, fidelity };
}

// グレースケールの変換。段階の数 (8・16・32) ごとに変換し、再現度が最も高いものを採る。
// 再現度は、色を再現するときは元画像と、しないときは元画像をグレースケールにしたものと比べる (長辺 1024px)。
// 全部の段階の数で変換できなかったときは VECTORIZE_FAILED
async function traceGray(image: RgbaImage, request: VectorizeRequest, hooks: TraceHooks): Promise<string> {
    const { signal } = hooks;
    const context = await prepareGrayTrace(image, request.preprocess.recolor);
    const config = binaryTraceConfig(request.params, request.output.pathPrecision);

    // 進み具合: 白黒画像 1 つの変換を 1 とし、段階の数ごとの仕上げ (色の付け直し・分け直し・再現度) を加える
    const finishSteps = grayFinishSteps(context);
    // 明るさの種類が少ない画像では、段階の数を変えても同じしきい値になるため、同じものは 1 度だけ変換する
    const plans = [
        ...new Map(
            GRAY_LEVEL_COUNTS.map(count => {
                const thresholds = levelThresholds(context.gray, context.opaque, count);
                return [thresholds.join(','), thresholds] as const;
            })
        ).values(),
    ];
    const totalSteps = plans.reduce((sum, thresholds) => sum + grayScanSteps(thresholds) + finishSteps, 0);
    let doneSteps = 0;
    const report = () => hooks.onProgress({ phase: 'trace', fraction: doneSteps / totalSteps });
    const step = () => {
        doneSteps++;
        report();
    };

    let best: { svg: string; fidelity: number } | null = null;
    let lastError: unknown = null;
    for (const thresholds of plans) {
        const stepsAtStart = doneSteps;
        report();
        try {
            const result = await traceGrayLevels(context, thresholds, config, signal, step);
            if (!best || result.fidelity > best.fidelity) best = result;
        } catch (error) {
            if (isTraceCancelled(error)) throw error;
            lastError = error;
            // この段階の数は飛ばす (進み具合は、この段階の数の分を済んだことにする)
            doneSteps = stepsAtStart + grayScanSteps(thresholds) + finishSteps;
            report();
        }
        throwIfCancelled(signal);
    }
    if (!best) throw vectorizeFailed(lastError ?? new Error('every level count failed'));
    return best.svg;
}

// 不透明な画素 (アルファ OPAQUE_ALPHA 以上) が 1 つでもあるか
function hasOpaquePixel(image: RgbaImage): boolean {
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] >= OPAQUE_ALPHA) return true;
    return false;
}

// 画像ファイルを読み込み、前処理 (長辺をそろえる・背景を除く・小さな点を除く) をした画像 (RGBA、透過あり) と、
// 元画像の大きさを返す。不透明な画素が無い画像 (全面が透過した画像) は NO_OPAQUE_PIXEL、背景を除くと不透明な画素が
// 残らないときは NOTHING_TO_TRACE
export async function preprocessImageFile(
    filePath: string,
    preprocess: VectorizePreprocess,
    hooks: TraceHooks
): Promise<PreparedImage> {
    const { signal } = hooks;
    hooks.onProgress({ phase: 'load' });
    const loaded = await loadImageLong(filePath, preprocess.longSide, preprocess.upscale);
    let image = loaded.image;
    throwIfCancelled(signal);
    if (!hasOpaquePixel(image)) throw new Error('NO_OPAQUE_PIXEL: the image has no opaque pixel');
    if (preprocess.removeBackground) {
        hooks.onProgress({ phase: 'background' });
        image = removeBackground(image, preprocess.backgroundTolerance);
        if (preprocess.speckArea > 0) image = removeSpecks(image, preprocess.speckArea);
        throwIfCancelled(signal);
        if (!hasOpaquePixel(image)) throw new Error('NOTHING_TO_TRACE: no opaque pixel remains');
    }
    return { image, sourceSize: loaded.sourceSize };
}

// 前処理した画像を変換する (request.preprocess の grayscale・recolor で、カラーの変換かグレースケールの変換かを選ぶ。
// 最適化はしない)。表示の大きさは元画像の大きさにする。変換できないときは VECTORIZE_FAILED
export async function traceImage(
    prepared: PreparedImage,
    request: VectorizeRequest,
    hooks: TraceHooks
): Promise<string> {
    const svg = request.preprocess.grayscale
        ? await traceGray(prepared.image, request, hooks)
        : await traceColor(prepared.image, request, hooks);
    throwIfCancelled(hooks.signal);
    return withDisplaySize(svg, prepared.sourceSize);
}

// SVG のパスを最適化する (変換ライブラリに入っている OXVG の既定の処理)。最適化できなかったときは元の SVG を返す。
// 枠 (width / height / viewBox) は最適化の前のものに戻す (最適化で表示の大きさや座標の範囲が変わらないように)
export async function optimizeSvg(svg: string, hooks: TraceHooks): Promise<string> {
    const { signal } = hooks;
    hooks.onProgress({ phase: 'optimize' });
    const frame = readSvgFrame(svg);
    let result = svg;
    try {
        result = withSvgFrame(await optimize(svg, { preset: OptimizePreset.Default }, signal), frame);
    } catch (error) {
        throwIfCancelled(signal);
        console.warn('svg optimize failed', error);
    }
    throwIfCancelled(signal);
    return result;
}

// 画像ファイルを SVG にする (前処理・変換・最適化 (request.output.optimize がオンのとき))
export async function traceImageFile(filePath: string, request: VectorizeRequest, hooks: TraceHooks): Promise<string> {
    const prepared = await preprocessImageFile(filePath, request.preprocess, hooks);
    const svg = await traceImage(prepared, request, hooks);
    return request.output.optimize ? optimizeSvg(svg, hooks) : svg;
}
