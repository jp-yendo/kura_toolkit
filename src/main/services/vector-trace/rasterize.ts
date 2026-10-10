import { Resvg } from '@resvg/resvg-js';
import { toSvg, type SvgModel } from './svg-model';
import type { RgbaImage } from './types';

// SVG を resvg で描く

// SVG を幅 width に合わせて描き、width x height の RGBA にする (描いた高さが違う分は切るか透明で埋める)。
// 画素の色はアルファを掛けた後の値 (premultiplied)。crisp はアンチエイリアスなしで描く
export function rasterizeSvg(svg: string, width: number, height: number, crisp = false): RgbaImage {
    const source = crisp ? svg.replace('<svg ', '<svg shape-rendering="crispEdges" ') : svg;
    const rendered = new Resvg(source, {
        fitTo: { mode: 'width', value: width },
        shapeRendering: crisp ? 0 : 2,
        // 文字を描かないため、システムのフォントは読まない
        font: { loadSystemFonts: false },
    }).render();
    const pixels = rendered.pixels;
    if (rendered.width === width && rendered.height === height) return { width, height, data: Buffer.from(pixels) };
    const out = Buffer.alloc(width * height * 4);
    const rowBytes = Math.min(width, rendered.width) * 4;
    for (let y = 0; y < Math.min(height, rendered.height); y++) {
        pixels.copy(out, y * width * 4, y * rendered.width * 4, y * rendered.width * 4 + rowBytes);
    }
    return { width, height, data: out };
}

// 各画素で見えている形の番号 (model.paths の添字。どの形も無い画素は -1)。
// 各形を固有の色で塗り、アンチエイリアスなしで width x height に描いて求める
export function idMap(model: SvgModel, width: number, height: number): Int32Array {
    const fills = model.paths.map((_, i) => {
        const id = i + 1;
        return `rgb(${id & 0xff},${(id >> 8) & 0xff},${(id >> 16) & 0xff})`;
    });
    const raster = rasterizeSvg(toSvg(model, fills), width, height, true);
    const out = new Int32Array(width * height);
    const data = raster.data;
    for (let p = 0; p < out.length; p++) {
        out[p] = data[p * 4 + 3] === 0 ? -1 : (data[p * 4] | (data[p * 4 + 1] << 8) | (data[p * 4 + 2] << 16)) - 1;
    }
    return out;
}
