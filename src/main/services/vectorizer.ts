import fs from 'fs/promises';
import path from 'path';
import { ColorMode, Hierarchical, PathSimplifyMode, vectorize, type Config } from '@neplex/vectorizer';
import type { ImagePreview, VectorizeParams } from '../../shared/types';

// 画像 -> SVG 変換 (元: vtracer-gui/vtracer-gui.py、vtracer の NAPI バインディングを使用)

const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.tiff': 'image/tiff',
};

function toConfig(params: VectorizeParams): Config {
    return {
        colorMode: params.colorMode === 'binary' ? ColorMode.Binary : ColorMode.Color,
        hierarchical: params.hierarchical === 'cutout' ? Hierarchical.Cutout : Hierarchical.Stacked,
        filterSpeckle: params.filterSpeckle,
        colorPrecision: params.colorPrecision,
        layerDifference: params.layerDifference,
        mode:
            params.mode === 'polygon'
                ? PathSimplifyMode.Polygon
                : params.mode === 'none'
                  ? PathSimplifyMode.None
                  : PathSimplifyMode.Spline,
        cornerThreshold: params.cornerThreshold,
        lengthThreshold: params.lengthThreshold,
        // 元 GUI と同じ固定値 (vtracer の既定値)
        maxIterations: 10,
        spliceThreshold: params.spliceThreshold,
    };
}

// プレビュー用に画像を dataURL として読み込む
export async function loadImagePreview(filePath: string): Promise<ImagePreview> {
    const buffer = await fs.readFile(filePath);
    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return {
        dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
        fileName: path.basename(filePath),
    };
}

// 画像ファイルを SVG 文字列に変換する
export async function convertImage(filePath: string, params: VectorizeParams): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return vectorize(buffer, toConfig(params));
}

// SVG 文字列をファイルへ保存する
export async function saveSvgFile(filePath: string, svg: string): Promise<void> {
    await fs.writeFile(filePath, svg, 'utf-8');
}
