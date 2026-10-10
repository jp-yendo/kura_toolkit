import { recolor, type RgbaImage, type SvgModel } from '../vector-trace';

// 補正の調整「色の付け直し」: 各形を、形が見えている部分の元画像の色 (チャンネルごとの中央値) で塗り直す。
// sample は再現度で比べる元画像 (不透明)。塗りが変わらないときは null
export function recolorShapes(model: SvgModel, sample: RgbaImage): SvgModel | null {
    const recolored = recolor(model, sample);
    const changed = recolored.paths.some((path, i) => path.fill.toUpperCase() !== model.paths[i].fill.toUpperCase());
    return changed ? recolored : null;
}
