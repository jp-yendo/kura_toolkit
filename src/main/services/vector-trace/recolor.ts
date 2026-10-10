import { idMap } from './rasterize';
import type { SvgModel } from './svg-model';
import type { RgbaImage } from './types';

// 変換した形ごとに、元画像の色を付け直す

function hex(rgb: number[]): string {
    return `#${rgb
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
}

// 形ごとに、元画像 (不透明) のその形が見えている部分の色 (チャンネルごとの中央値) で塗る。
// 見えている部分の無い形は元の色のまま。新しいモデルを返す
export function recolor(model: SvgModel, image: RgbaImage): SvgModel {
    const ids = idMap(model, image.width, image.height);
    // 形ごとの R・G・B のヒストグラム (256 x 3) と画素数
    const histograms = new Map<number, { bins: Uint32Array; count: number }>();
    const data = image.data;
    for (let p = 0; p < ids.length; p++) {
        const id = ids[p];
        if (id < 0) continue;
        let histogram = histograms.get(id);
        if (!histogram) {
            histogram = { bins: new Uint32Array(256 * 3), count: 0 };
            histograms.set(id, histogram);
        }
        histogram.bins[data[p * 4]]++;
        histogram.bins[256 + data[p * 4 + 1]]++;
        histogram.bins[512 + data[p * 4 + 2]]++;
        histogram.count++;
    }
    const paths = model.paths.map(path => ({ ...path }));
    for (const [id, { bins, count }] of histograms) {
        const median = [0, 1, 2].map(c => {
            let acc = 0;
            for (let v = 0; v < 256; v++) if ((acc += bins[c * 256 + v]) * 2 >= count) return v;
            return 255;
        });
        paths[id].fill = hex(median);
    }
    return { ...model, paths };
}
