import fs from 'fs/promises';
import sharp from 'sharp';
import { readImage } from '@neplex/vectorizer';
import type { VectorizerUpscale } from '../../../shared/types';
import type { GrayImage, ImageSize, PreparedImage, RgbaImage } from './types';

// 一般的な画像処理 (読み込み・拡大縮小・白地への合成・グレースケール化・しきい値・メディアン) を sharp で行う

// 拡大の方法ごとの sharp のカーネル。sharp の型定義には linear (双線形) が無いが、実装は受け付ける
const UPSCALE_KERNEL: Record<VectorizerUpscale, keyof sharp.KernelEnum> = {
    nearest: 'nearest',
    bilinear: 'linear' as keyof sharp.KernelEnum,
};

const WHITE = { r: 255, g: 255, b: 255 };

// sharp の出力 (チャンネル数 1-4) を RGBA にそろえる (グレースケールの出力は 1 チャンネル、アルファ付きは 2 チャンネル)
function toRgba(data: Buffer, info: sharp.OutputInfo): RgbaImage {
    const { width, height, channels } = info;
    if (channels === 4) return { width, height, data };
    const pixels = width * height;
    const out = Buffer.alloc(pixels * 4);
    for (let p = 0; p < pixels; p++) {
        const i = p * channels;
        const o = p * 4;
        if (channels >= 3) {
            out[o] = data[i];
            out[o + 1] = data[i + 1];
            out[o + 2] = data[i + 2];
        } else {
            out[o] = out[o + 1] = out[o + 2] = data[i];
        }
        out[o + 3] = channels === 2 ? data[i + 1] : 255;
    }
    return { width, height, data: out };
}

// sharp の出力の最初のチャンネルだけを取り出す
function firstChannel(data: Buffer, info: sharp.OutputInfo): GrayImage {
    const { width, height, channels } = info;
    if (channels === 1) return { width, height, data };
    const pixels = width * height;
    const out = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p++) out[p] = data[p * channels];
    return { width, height, data: out };
}

function rgbaInput(image: RgbaImage): sharp.Sharp {
    return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
}

function grayInput(image: GrayImage): sharp.Sharp {
    const data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    return sharp(data, { raw: { width: image.width, height: image.height, channels: 1 } });
}

// 画像ファイルを読み込み、EXIF の向きを反映して、比率を保って長辺を longSide にそろえる (透過は保つ)。
// 縮小は lanczos3、拡大は upscale の方法。sharp (libvips) が読めない形式 (BMP など) は変換ライブラリで読む。
// 元画像の大きさ (EXIF の向きを反映したもの) も返す。ファイルを読めないとき・画像として読めないときは IMAGE_READ_FAILED
export async function loadImageLong(
    filePath: string,
    longSide: number,
    upscale: VectorizerUpscale
): Promise<PreparedImage> {
    let buffer: Buffer;
    try {
        buffer = await fs.readFile(filePath);
    } catch (error) {
        // ファイルが無い・読めないときも、画像を読み込めなかったことにする
        throw new Error(`IMAGE_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    let pipeline: sharp.Sharp;
    let sourceSize: ImageSize;
    try {
        const meta = await sharp(buffer).metadata();
        pipeline = sharp(buffer).rotate();
        sourceSize = { width: meta.autoOrient.width, height: meta.autoOrient.height };
    } catch (sharpError) {
        let decoded: Awaited<ReturnType<typeof readImage>>;
        try {
            decoded = await readImage(buffer);
        } catch {
            throw new Error(
                `IMAGE_READ_FAILED: ${sharpError instanceof Error ? sharpError.message : String(sharpError)}`,
                { cause: sharpError }
            );
        }
        pipeline = sharp(Buffer.from(decoded.pixels), {
            raw: { width: decoded.width, height: decoded.height, channels: 4 },
        });
        sourceSize = { width: decoded.width, height: decoded.height };
    }
    const long = Math.max(sourceSize.width, sourceSize.height);
    if (!(sourceSize.width > 0) || !(sourceSize.height > 0)) throw new Error('IMAGE_READ_FAILED: empty image');
    if (long !== longSide) {
        pipeline = pipeline.resize({
            width: longSide,
            height: longSide,
            fit: 'inside',
            kernel: longSide > long ? UPSCALE_KERNEL[upscale] : 'lanczos3',
        });
    }
    let decodedImage: { data: Buffer; info: sharp.OutputInfo };
    try {
        decodedImage = await pipeline.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    } catch (error) {
        // 見出しは読めても中身を復号できない画像 (途中で切れたファイルなど)
        throw new Error(`IMAGE_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    return { image: toRgba(decodedImage.data, decodedImage.info), sourceSize };
}

// RGBA の画像を白地に合成する (アルファはすべて 255 になる)
export async function flattenOnWhite(image: RgbaImage): Promise<RgbaImage> {
    const { data, info } = await rgbaInput(image)
        .flatten({ background: WHITE })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return toRgba(data, info);
}

// RGBA の画像を白地に合成してグレースケールにした明るさ
export async function toGrayLevels(image: RgbaImage): Promise<GrayImage> {
    const { data, info } = await rgbaInput(image)
        .flatten({ background: WHITE })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return firstChannel(data, info);
}

// 1 チャンネルの画像を RGBA (R=G=B、不透明) にする
export function grayToRgba(image: GrayImage): RgbaImage {
    const pixels = image.width * image.height;
    const out = Buffer.alloc(pixels * 4);
    for (let p = 0; p < pixels; p++) {
        const v = image.data[p];
        const o = p * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
    }
    return { width: image.width, height: image.height, data: out };
}

function shrinkSize(width: number, height: number, side: number): { width?: number; height?: number } {
    return width >= height ? { width: Math.min(side, width) } : { height: Math.min(side, height) };
}

// RGBA の画像の長辺を side 以下に縮小する (lanczos3。side より小さい画像はそのまま)
export async function shrinkLong(image: RgbaImage, side: number): Promise<RgbaImage> {
    if (Math.max(image.width, image.height) <= side) return image;
    const { data, info } = await rgbaInput(image)
        .resize(shrinkSize(image.width, image.height, side))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return toRgba(data, info);
}

// 1 チャンネルの画像の長辺を side 以下に縮小する (lanczos3。side より小さい画像はそのまま)
export async function shrinkGrayLong(image: GrayImage, side: number): Promise<GrayImage> {
    if (Math.max(image.width, image.height) <= side) return image;
    const { data, info } = await grayInput(image)
        .resize(shrinkSize(image.width, image.height, side))
        .raw()
        .toBuffer({ resolveWithObject: true });
    return firstChannel(data, info);
}

// 明るさを、しきい値 t で白黒にする (t 未満が黒 (0)、t 以上が白 (255))
export async function thresholdGray(image: GrayImage, t: number): Promise<GrayImage> {
    const { data, info } = await grayInput(image)
        .threshold(t, { greyscale: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
    return firstChannel(data, info);
}

// 1 チャンネルの画像に size x size のメディアンをかける
export async function medianGray(image: GrayImage, size: number): Promise<GrayImage> {
    const { data, info } = await grayInput(image).median(size).raw().toBuffer({ resolveWithObject: true });
    return firstChannel(data, info);
}
