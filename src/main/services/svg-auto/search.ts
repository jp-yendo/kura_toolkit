import { VECTORIZE_PARAM_RANGES } from '../../../shared/vectorizer';
import type { VectorizeParams } from '../../../shared/types';

// 試行 (変換の設定の探索)。どの設定を変換するかを決める (変換と再現度の測定は、引数の run で行う)。
// 同じ設定は 2 回変換しない。変換できなかった設定も 1 回と数える

// 試す設定 (グレースケールで変換するときは段階の数 grayLevels とそのしきい値の並びの名前 planKey も持つ)
export type Trial = {
    params: VectorizeParams;
    // 標準のプリセットの値のままのときは、そのプリセットの名前の翻訳キー
    presetNameKey: string | null;
    grayLevels: number | null;
    // 同じ変換になる設定を見分ける名前 (グレースケールの段階のしきい値の並びなど)。省略時は段階の数
    planKey?: string;
};

// 変換して再現度を返す (変換できなかったときは null)
export type RunTrial = (trial: Trial) => Promise<number | null>;

type NumericKey = keyof typeof VECTORIZE_PARAM_RANGES;

// パラメーターの動かし方 (スペックル ½ / 2 倍 + 2、色精度 ±1、グラデーション幅 ½ / 1.5 倍 + 4、コーナー -20 / +30、
// セグメント長 -1、スプライス -15)
const MOVES: { key: NumericKey; move(value: number): number }[] = [
    { key: 'filterSpeckle', move: value => Math.round(value / 2) },
    { key: 'filterSpeckle', move: value => value * 2 + 2 },
    { key: 'colorPrecision', move: value => value - 1 },
    { key: 'colorPrecision', move: value => value + 1 },
    { key: 'layerDifference', move: value => Math.round(value / 2) },
    { key: 'layerDifference', move: value => Math.round(value * 1.5 + 4) },
    { key: 'cornerThreshold', move: value => value - 20 },
    { key: 'cornerThreshold', move: value => value + 30 },
    { key: 'lengthThreshold', move: value => Math.round((value - 1) * 10) / 10 },
    { key: 'spliceThreshold', move: value => value - 15 },
];

// カラーの変換で使うパラメーター
const COLOR_KEYS: NumericKey[] = [
    'filterSpeckle',
    'colorPrecision',
    'layerDifference',
    'cornerThreshold',
    'lengthThreshold',
    'spliceThreshold',
];
// 白黒の変換 (白黒モードとグレースケールの変換) で使うパラメーター
const BINARY_KEYS: NumericKey[] = ['filterSpeckle', 'cornerThreshold', 'lengthThreshold', 'spliceThreshold'];
// 曲線の当てはめのパラメーター (モード none では使われない)
const CURVE_KEYS: NumericKey[] = ['cornerThreshold', 'lengthThreshold', 'spliceThreshold'];

function clamp(key: NumericKey, value: number): number {
    const range = VECTORIZE_PARAM_RANGES[key];
    return Math.min(range.max, Math.max(range.min, value));
}

// 変換に効くパラメーター (白黒モードでは色精度・グラデーション幅は使われず、モード none ではコーナー・セグメント長・
// スプライスは使われない。使われない値を動かしても同じ変換になるため動かさない)
function effectiveKeys(params: VectorizeParams, binaryOnly: boolean): NumericKey[] {
    const keys = binaryOnly || params.colorMode === 'binary' ? BINARY_KEYS : COLOR_KEYS;
    return params.mode === 'none' ? keys.filter(key => !CURVE_KEYS.includes(key)) : keys;
}

// パラメーターを 1 つずつ動かした設定 (範囲に収め、値の変わらないものは除く)
function neighbours(params: VectorizeParams, binaryOnly: boolean): VectorizeParams[] {
    const keys = effectiveKeys(params, binaryOnly);
    const result: VectorizeParams[] = [];
    for (const { key, move } of MOVES) {
        if (!keys.includes(key)) continue;
        const value = clamp(key, move(params[key]));
        if (value !== params[key]) result.push({ ...params, [key]: value });
    }
    return result;
}

function trialKey(trial: Trial): string {
    const p = trial.params;
    const plan = trial.planKey ?? String(trial.grayLevels ?? '');
    return [
        plan,
        p.colorMode,
        p.hierarchical,
        p.mode,
        p.filterSpeckle,
        p.colorPrecision,
        p.layerDifference,
        p.cornerThreshold,
        p.lengthThreshold,
        p.spliceThreshold,
    ].join('|');
}

// 局所探索で値を動かしていく出発点
type Head = {
    trial: Trial;
    fidelity: number;
    pending: VectorizeParams[];
};

// 試行の回数を数え、同じ設定を 2 回変換しない
class TrialRunner {
    private readonly tried = new Set<string>();
    used = 0;

    constructor(
        private readonly budget: number,
        private readonly run: RunTrial
    ) {}

    get exhausted(): boolean {
        return this.used >= this.budget;
    }

    // 変換して再現度を返す (変換できなかったときは null)。試したことのある設定と、回数を使い切ったときは undefined
    async attempt(trial: Trial): Promise<number | null | undefined> {
        const key = trialKey(trial);
        if (this.exhausted || this.tried.has(key)) return undefined;
        this.tried.add(key);
        this.used++;
        return this.run(trial);
    }
}

// 出発点の設定をすべて変換し、再現度の高い順に返す (変換できなかったものは除く)
async function runStarts(runner: TrialRunner, starts: Trial[]): Promise<{ trial: Trial; fidelity: number }[]> {
    const results: { trial: Trial; fidelity: number }[] = [];
    for (const start of starts) {
        const fidelity = await runner.attempt(start);
        if (typeof fidelity === 'number') results.push({ trial: start, fidelity });
    }
    return results.sort((a, b) => b.fidelity - a.fidelity);
}

// 出発点 (heads) から、パラメーターを 1 つずつ動かす局所探索を交互に行う。良くなったら、その値から続ける。
// 出発点のどれも動かし方が尽きたか、回数を使い切ったら終わる
async function climb(runner: TrialRunner, heads: Head[], binaryOnly: boolean): Promise<void> {
    let turn = 0;
    while (!runner.exhausted && heads.some(head => head.pending.length > 0)) {
        const head = heads[turn % heads.length];
        const params = head.pending.shift();
        if (!params) {
            turn++;
            continue;
        }
        const trial: Trial = { ...head.trial, params, presetNameKey: null };
        const fidelity = await runner.attempt(trial);
        // 試したことのある設定は数えず、同じ出発点の次の動かし方を試す
        if (fidelity === undefined) continue;
        turn++;
        if (fidelity !== null && fidelity > head.fidelity) {
            head.trial = trial;
            head.fidelity = fidelity;
            head.pending = neighbours(params, binaryOnly);
        }
    }
}

// カラーで変換するときの探索: 標準のプリセット (starts) をすべて変換して出発点にし、再現度の高い 2 つから局所探索を
// 交互に行う。試した回数を返す
export async function searchColor(starts: Trial[], budget: number, run: RunTrial): Promise<number> {
    const runner = new TrialRunner(budget, run);
    const results = await runStarts(runner, starts);
    const heads = results.slice(0, 2).map(({ trial, fidelity }) => ({
        trial,
        fidelity,
        pending: neighbours(trial.params, false),
    }));
    await climb(runner, heads, false);
    return runner.used;
}

// グレースケールで変換するときの探索: 段階の数ごとの設定 (starts。既定のパラメーター) を変換し、最も再現度の高い
// 段階の数で、白黒の変換のパラメーター (スペックル・コーナー・セグメント長・スプライス) を局所探索する。試した回数を返す
export async function searchGray(starts: Trial[], budget: number, run: RunTrial): Promise<number> {
    const runner = new TrialRunner(budget, run);
    const results = await runStarts(runner, starts);
    const heads = results.slice(0, 1).map(({ trial, fidelity }) => ({
        trial,
        fidelity,
        pending: neighbours(trial.params, true),
    }));
    await climb(runner, heads, true);
    return runner.used;
}
