import { idMap, type SvgModel } from '../vector-trace';

// 補正の調整「小さな形の除去」

// 見えている面積が画像のこの割合未満の形を除く
const MIN_VISIBLE_RATIO = 0.0001;

// 見えている面積が画像の 0.01% 未満の形と、まったく見えていない形 (ほかの形に覆われた形) を除く (一番下の形は残す)。
// 見えている面積は、width x height に描いた ID 画像 (各形を固有の色で塗り、アンチエイリアスなしで描いたもの) で数える。
// 除く形が無いときは null
export function removeSmallShapes(model: SvgModel, width: number, height: number): SvgModel | null {
    const ids = idMap(model, width, height);
    const area = new Float64Array(model.paths.length);
    for (let p = 0; p < ids.length; p++) if (ids[p] >= 0) area[ids[p]]++;
    const minArea = width * height * MIN_VISIBLE_RATIO;
    const paths = model.paths.filter((_, i) => i === 0 || (area[i] > 0 && area[i] >= minArea));
    return paths.length === model.paths.length ? null : { ...model, paths };
}
