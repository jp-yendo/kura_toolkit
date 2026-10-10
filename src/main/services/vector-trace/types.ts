// 画像のベクター化で共用する型と取り消しの扱い (electron に依存しない)

// RGBA の画像 (1 画素 4 バイト、行の詰め物なし)
export type RgbaImage = {
    width: number;
    height: number;
    data: Buffer;
};

// 1 チャンネルの画像 (明るさ・白黒。1 画素 1 バイト、行の詰め物なし)
export type GrayImage = {
    width: number;
    height: number;
    data: Uint8Array;
};

// 画像の大きさ (px)
export type ImageSize = {
    width: number;
    height: number;
};

// 前処理した画像 (画像の長辺のサイズにそろえた RGBA) と、元画像の大きさ (EXIF の向きを反映したもの)。
// 変換した SVG は座標を処理の大きさ (viewBox) で持ち、表示の大きさ (width / height) を元画像の大きさにする
export type PreparedImage = {
    image: RgbaImage;
    sourceSize: ImageSize;
};

// 不透明とみなすアルファの下限 (これ未満の画素は透過した画素として扱う)
export const OPAQUE_ALPHA = 128;

// 取り消されたことを表すエラーのメッセージ (ジョブの取り消しと同じコード)
export const CANCELLED_MESSAGE = 'KURA_CANCELLED';

export function isTraceCancelled(error: unknown): boolean {
    return error instanceof Error && error.message === CANCELLED_MESSAGE;
}

// 取り消されていれば、取り消しのエラーを投げる
export function throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new Error(CANCELLED_MESSAGE);
}
