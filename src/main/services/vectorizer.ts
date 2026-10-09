import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ColorMode, Hierarchical, PathSimplifyMode, vectorize, type Config } from '@neplex/vectorizer';
import type { ImagePreview, SvgResult, VectorizeParams } from '../../shared/types';
import { forgetMedia, mediaUrl } from './media-protocol';
import { discardLater, newTempDir } from './work-dir';

// 画像 -> SVG 変換 (元: vtracer-gui/vtracer-gui.py、vtracer の NAPI バインディングを使用)
// 元画像と変換結果は、中身を renderer へ渡さず、表示用の URL (kura-media://) で見せる。
// 変換結果は作業ディレクトリのファイルに置き、保存はそのファイルを写す (最後の 1 つだけを持つ)

let currentResult: { id: string; dir: string; file: string } | null = null;

function discardResult(): void {
    if (!currentResult) return;
    forgetMedia(currentResult.file);
    discardLater(currentResult.dir);
    currentResult = null;
}

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

// プレビュー用に画像を公開する (画像の中身は renderer が表示するときに読む)。
// 画像を選び直すと前の変換結果は使わなくなるため、ここで片付ける
export function loadImagePreview(filePath: string): ImagePreview {
    const preview = { url: mediaUrl(filePath), fileName: path.basename(filePath) };
    discardResult();
    return preview;
}

// 画像ファイルを SVG に変換し、作業ディレクトリのファイルに置く (前の変換結果は片付ける)
export async function convertImage(filePath: string, params: VectorizeParams): Promise<SvgResult> {
    const buffer = await fs.readFile(filePath);
    let svg: string;
    try {
        svg = await vectorize(buffer, toConfig(params));
    } catch (error) {
        // vtracer は値の組み合わせと画像によって変換に失敗する (グラデーション幅 0 で色数の多い画像など。
        // 理由は「Unknown error occurred」としか返らない)。設定を変えれば変換できることを画面で示すためコードにする
        throw new Error(`VECTORIZE_FAILED: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    const dir = newTempDir();
    const file = path.join(dir, 'result.svg');
    try {
        await fs.writeFile(file, svg, 'utf-8');
    } catch (error) {
        discardLater(dir);
        throw error;
    }
    discardResult();
    currentResult = { id: crypto.randomUUID(), dir, file };
    return { id: currentResult.id, url: mediaUrl(file) };
}

// 変換結果を保存先へ写す (resultId は convertImage が返したもの)
export async function saveSvgFile(resultId: string, filePath: string): Promise<void> {
    if (!currentResult || currentResult.id !== resultId) throw new Error('SVG_RESULT_GONE');
    await fs.copyFile(currentResult.file, filePath);
}
