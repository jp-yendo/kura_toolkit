import type { SvgAutoAdjustment } from '../../../shared/types';
import { isTraceCancelled, throwIfCancelled, type SvgModel } from '../vector-trace';

// 補正: 最も再現度の高い候補に、パスの調整を 1 つずつ試す。
// 調整を採るのは、再現度が下がらず (それまでの最も高い再現度との差が -FIDELITY_TOLERANCE 以上)、再現度が上がるか
// ファイルが小さくなるときだけ。採った調整の結果に次の調整を試す (各調整は 1 回だけ)。
// 下がってよい幅を、1 つ前の版ではなくそれまでの最も高い再現度から測るため、調整を重ねても再現度は
// 最良の候補から FIDELITY_TOLERANCE を超えては下がらない

// 再現度が下がらないとみなす差 (測定の丸めの差)
const FIDELITY_TOLERANCE = 0.0005;

export type Adjustment = {
    id: SvgAutoAdjustment;
    // 調整したモデル (変わるものが無いときは null)
    apply(model: SvgModel): SvgModel | null;
};

// 調整したモデルを書き出した SVG と、その再現度・大きさ (バイト)
export type Evaluated = {
    svg: string;
    fidelity: number;
    bytes: number;
};

type RefineHooks = {
    signal: AbortSignal;
    // モデルを書き出して再現度と大きさを測る
    evaluate(model: SvgModel): Promise<Evaluated>;
    // 調整を採ったときに呼ぶ (adjustments はそれまでに採った調整。採った順)
    adopt(model: SvgModel, evaluated: Evaluated, adjustments: SvgAutoAdjustment[]): Promise<void>;
    // index 番目 (0 から) の調整を試し始めるときに呼ぶ
    onStep(index: number, total: number): void;
};

// base (最良の候補とその再現度・大きさ) に adjustments を順に試す。調整が失敗したとき (形を読めないなど) は
// その調整を採らずに続ける
export async function refine(
    base: { model: SvgModel; fidelity: number; bytes: number },
    adjustments: Adjustment[],
    hooks: RefineHooks
): Promise<void> {
    let current = base;
    let ceiling = base.fidelity;
    const adopted: SvgAutoAdjustment[] = [];
    for (let index = 0; index < adjustments.length; index++) {
        throwIfCancelled(hooks.signal);
        hooks.onStep(index, adjustments.length);
        const adjustment = adjustments[index];
        try {
            const model = adjustment.apply(current.model);
            if (!model) continue;
            throwIfCancelled(hooks.signal);
            const evaluated = await hooks.evaluate(model);
            const keeps = evaluated.fidelity >= ceiling - FIDELITY_TOLERANCE;
            const better = evaluated.fidelity > current.fidelity || evaluated.bytes < current.bytes;
            if (!keeps || !better) continue;
            await hooks.adopt(model, evaluated, [...adopted, adjustment.id]);
            adopted.push(adjustment.id);
            current = { model, fidelity: evaluated.fidelity, bytes: evaluated.bytes };
            ceiling = Math.max(ceiling, evaluated.fidelity);
        } catch (error) {
            if (isTraceCancelled(error)) throw error;
            console.warn(`svg-auto: adjustment ${adjustment.id} failed`, error);
        }
    }
}
