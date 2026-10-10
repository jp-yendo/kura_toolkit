import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { SvgAutoStep } from '../../../shared/svg-auto';
import type { SvgAutoRequest, SvgAutoVersionSource, VectorizeParams } from '../../../shared/types';
import {
    binaryTraceConfig,
    buildFidelitySample,
    countPaths,
    grayFinishSteps,
    grayScanSteps,
    GRAY_LEVEL_COUNTS,
    isTraceCancelled,
    levelThresholds,
    makeReference,
    measureFidelity,
    optimizeSvg,
    parseSvg,
    prepareGrayTrace,
    preprocessImageFile,
    readSvgFrame,
    throwIfCancelled,
    toSvg,
    traceColorImage,
    traceGrayLevels,
    withDisplaySize,
    type SvgModel,
    type TraceHooks,
} from '../vector-trace';
import type { WorkerHooks } from '../vector-trace/worker-protocol';
import { mergeNearColors } from './adjust-merge-colors';
import { recolorShapes } from './adjust-recolor';
import { simplifyPaths } from './adjust-simplify';
import { removeSmallShapes } from './adjust-small-shapes';
import { CandidatePool } from './candidate-pool';
import { isPixelArtFile } from './pixel-art';
import { refine, type Adjustment, type Evaluated } from './refine';
import { searchColor, searchGray, type RunTrial, type Trial } from './search';
import { writeVersionIndex, type AutoVersionFile, type VersionIndex } from './version-index';

// SVG 自動変換の処理の流れ (前処理 -> 試行 -> 選定 -> 補正)。画面と electron に依存しない。
// 途中の SVG と版の SVG は作業ごとの置き場 (dir) のファイルに置き、メモリには指標と設定とファイルの場所だけを持つ。
// 今ある版の一覧も置き場に書いておく (version-index.ts)

// 試行の上位から版として残す数
const VERSION_COUNT = 5;

// 処理に渡す値。request は範囲に収めたもの、dir は作業ごとの置き場 (作ってあるもの)
export type SvgAutoWorkerInit = {
    filePath: string;
    dir: string;
    request: SvgAutoRequest;
    // カラーで変換するときの出発点 (標準のプリセット)
    presets: { nameKey: string | null; params: VectorizeParams }[];
    // グレースケールで変換するときの出発点のパラメーター (既定値) と、それが標準のプリセットの値のときのプリセットの名前
    grayStart: { nameKey: string | null; params: VectorizeParams };
};

// 進み具合 (手順と、手順の中の進み具合 (0-1)・回数。これまでに得た最も高い再現度)
export type SvgAutoProgress = {
    step: SvgAutoStep;
    fraction?: number;
    current?: number;
    total?: number;
    bestFidelity: number | null;
};

// 表示の大きさを付けた SVG のモデル (大きさは座標の範囲 (viewBox) の大きさにする)
function modelOf(svg: string): SvgModel {
    const [, , width, height] = readSvgFrame(svg)
        .viewBox.trim()
        .split(/[\s,]+/)
        .map(Number);
    return { ...parseSvg(svg), width, height };
}

function vectorizeFailed(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(message.startsWith('VECTORIZE_FAILED') ? message : `VECTORIZE_FAILED: ${message}`);
}

// 画像の変換の設定を探して変換し、版のファイルを dir に書いて返す。版は試行の上位 (再現度の高い順) の後に
// 補正の版 (採った順)。全部の試行が変換できなかったときは VECTORIZE_FAILED、不透明な画素が無いときは
// NO_OPAQUE_PIXEL、背景を除くと何も残らないときは NOTHING_TO_TRACE。取り消されたときは KURA_CANCELLED
export async function autoConvert(init: SvgAutoWorkerInit, hooks: WorkerHooks<SvgAutoProgress>): Promise<VersionIndex> {
    const { signal } = hooks;
    const { preprocess, output, trials: budget } = init.request;
    const grayscale = preprocess.grayscale;
    let bestFidelity: number | null = null;
    const report = (step: SvgAutoStep, progress: Omit<SvgAutoProgress, 'step' | 'bestFidelity'> = {}) =>
        hooks.onProgress({ step, ...progress, bestFidelity });
    const traceHooks: TraceHooks = { signal, onProgress: () => undefined };

    // 1. 前処理と、再現度で比べる元画像 (長辺 1024px。補正の色の付け直しの色の元にも使う)
    report('preprocess');
    const prepared = await preprocessImageFile(init.filePath, preprocess, traceHooks);
    const gray = grayscale ? await prepareGrayTrace(prepared.image, preprocess.recolor) : null;
    const sample = gray?.sample ?? (await buildFidelitySample(prepared.image, grayscale));
    const reference = gray ? gray.reference : makeReference(sample);
    // 画素の塊をそのまま形にするモード (none) は、元画像がドット絵のときだけ試す (なめらかな画像では、
    // 長辺 1024px で測る再現度が画素の段差を見分けられず、段差だらけの SVG を選ぶため)
    const pixelArt = gray ? false : await isPixelArtFile(init.filePath, prepared.sourceSize);
    throwIfCancelled(signal);

    // 再現度
    const fidelityOf = (svg: string): number => measureFidelity(reference, svg);
    // 表示の大きさを元画像の大きさにした SVG
    const sizedSvg = (svg: string): string => withDisplaySize(svg, prepared.sourceSize);
    // 版のファイルの中身 (表示の大きさを元画像の大きさにし、オンのときはパスを最適化する)
    const finalize = async (svg: string): Promise<string> => {
        const sized = sizedSvg(svg);
        return output.optimize ? optimizeSvg(sized, traceHooks) : sized;
    };

    // 2. 試行
    const pool = new CandidatePool(init.dir, VERSION_COUNT);
    let used = 0;
    let failures = 0;
    let lastError: unknown = null;
    const reportTrial = (inner: number) =>
        report('trial', { fraction: Math.min(1, (used - 1 + inner) / budget), current: used, total: budget });
    // 今ある版の一覧を書き直す (処理が途中で終わったときに、それまでの版を返せるように)
    const saveIndex = (versions: AutoVersionFile[]) =>
        writeVersionIndex(init.dir, { versions, trials: used, failures });
    // 試行の上位の候補を版とみなした一覧 (候補のファイルは表示の大きさを付けた SVG で、そのまま表示・保存できる)
    const poolVersions = (): AutoVersionFile[] =>
        pool.ranked().map((candidate, index) => ({
            file: candidate.file,
            source: { kind: 'trial', rank: index + 1, grayLevels: candidate.trial.grayLevels },
            fidelity: candidate.fidelity,
            pathCount: candidate.pathCount,
            bytes: candidate.bytes,
            trial: candidate.trial,
        }));
    // グレースケールの段階の数ごとのしきい値 (同じしきい値になる段階の数は、同じ変換になる)
    const plans = new Map<string, number[]>();
    const grayStarts: Trial[] = [];
    if (gray) {
        for (const count of GRAY_LEVEL_COUNTS) {
            const thresholds = levelThresholds(gray.gray, gray.opaque, count);
            const planKey = thresholds.join(',');
            plans.set(planKey, thresholds);
            grayStarts.push({
                params: init.grayStart.params,
                presetNameKey: init.grayStart.nameKey,
                grayLevels: count,
                planKey,
            });
        }
    }

    // 1 つの設定で変換したモデル (svg と path の要素だけに組み直したもの)
    const traceTrial = async (trial: Trial): Promise<SvgModel> => {
        if (!gray) {
            return parseSvg(await traceColorImage(prepared.image, trial.params, output.pathPrecision, signal));
        }
        const thresholds = plans.get(trial.planKey ?? '') ?? [];
        const steps = grayScanSteps(thresholds) + grayFinishSteps(gray);
        let done = 0;
        const config = binaryTraceConfig(trial.params, output.pathPrecision);
        const result = await traceGrayLevels(gray, thresholds, config, signal, () => {
            done++;
            reportTrial(Math.min(1, done / steps));
        });
        return parseSvg(result.svg);
    };

    const run: RunTrial = async trial => {
        used++;
        reportTrial(0);
        try {
            const model = await traceTrial(trial);
            throwIfCancelled(signal);
            const svg = sizedSvg(toSvg(model));
            const fidelity = fidelityOf(svg);
            if (await pool.add(trial, svg, fidelity, model.paths.length)) await saveIndex(poolVersions());
            bestFidelity = pool.bestFidelity();
            reportTrial(1);
            return fidelity;
        } catch (error) {
            if (isTraceCancelled(error)) throw error;
            failures++;
            lastError = error;
            return null;
        }
    };

    const colorStarts: Trial[] = init.presets
        .filter(preset => pixelArt || preset.params.mode !== 'none')
        .map(preset => ({
            params: preset.params,
            presetNameKey: preset.nameKey,
            grayLevels: null,
        }));
    const trials = gray ? await searchGray(grayStarts, budget, run) : await searchColor(colorStarts, budget, run);
    throwIfCancelled(signal);
    const ranked = pool.ranked();
    if (ranked.length === 0) throw vectorizeFailed(lastError ?? new Error('every trial failed'));

    // 3. 選定 (上位の候補を版のファイルにする。仕上げた後に同じ中身になった版は 1 つにまとめる)
    const versions: AutoVersionFile[] = [];
    const hashes = new Set<string>();
    // 版のファイルを書いて一覧に加える (同じ中身の版がすでにあるときは加えない)。source は試行の版の順位 (1 から) から作る
    const writeVersion = async (
        svg: string,
        info: Pick<AutoVersionFile, 'fidelity' | 'trial'>,
        source: (rank: number) => SvgAutoVersionSource
    ) => {
        const hash = crypto.createHash('sha256').update(svg).digest('hex');
        if (hashes.has(hash)) return;
        hashes.add(hash);
        const file = path.join(init.dir, `version-${versions.length + 1}.svg`);
        await fs.writeFile(file, svg, 'utf-8');
        const rank = versions.filter(version => version.source.kind === 'trial').length + 1;
        versions.push({
            ...info,
            source: source(rank),
            file,
            pathCount: countPaths(svg),
            bytes: Buffer.byteLength(svg),
        });
        await saveIndex(versions);
    };
    for (const [index, candidate] of ranked.entries()) {
        report('select', { fraction: index / ranked.length, current: index + 1, total: ranked.length });
        const svg = await finalize(await fs.readFile(candidate.file, 'utf-8'));
        throwIfCancelled(signal);
        await writeVersion(svg, { fidelity: candidate.fidelity, trial: candidate.trial }, rank => ({
            kind: 'trial',
            rank,
            grayLevels: candidate.trial.grayLevels,
        }));
    }

    // 4. 補正 (最も再現度の高い候補に、パスの調整を順に試す)
    const best = ranked[0];
    const adjustments: Adjustment[] = [
        // グレースケールで色を再現した版は、色の付け直しが済んでいる
        ...(grayscale && preprocess.recolor
            ? []
            : [{ id: 'recolor' as const, apply: (model: SvgModel) => recolorShapes(model, sample) }]),
        { id: 'smallShapes', apply: model => removeSmallShapes(model, sample.width, sample.height) },
        {
            id: 'mergeColors',
            apply: model => mergeNearColors(model, sample.width, sample.height, output.pathPrecision),
        },
        { id: 'simplify', apply: model => simplifyPaths(model, output.pathPrecision) },
    ];
    await refine(
        { model: modelOf(await fs.readFile(best.file, 'utf-8')), fidelity: best.fidelity, bytes: versions[0].bytes },
        adjustments,
        {
            signal,
            evaluate: async (model): Promise<Evaluated> => {
                const svg = toSvg(model);
                const fidelity = fidelityOf(svg);
                const finished = await finalize(svg);
                return { svg: finished, fidelity, bytes: Buffer.byteLength(finished) };
            },
            adopt: async (_model, evaluated, adopted) => {
                await writeVersion(evaluated.svg, { fidelity: evaluated.fidelity, trial: best.trial }, () => ({
                    kind: 'refine',
                    adjustments: adopted,
                }));
                bestFidelity = Math.max(bestFidelity ?? 0, evaluated.fidelity);
            },
            onStep: (index, total) => report('refine', { fraction: index / total, current: index + 1, total }),
        }
    );
    await pool.clear();
    return { versions, trials, failures };
}
