import { loadImageLong, type ImageSize, type RgbaImage } from '../vector-trace';

// ドット絵 (同じ大きさの四角い画素の塊でできた画像) の判定。
// 行と列ごとに、色がはっきり変わる位置の間の長さ (連の長さ) を集め、それがある塊の大きさ b の倍数に近い割合で見る

// これを超えるチャンネルの差 (R・G・B・アルファのうち最大のもの) を、色がはっきり変わる位置とみなす
const EDGE_DIFFERENCE = 24;
// 試す塊の大きさ (px) の範囲と刻み
const MIN_BLOCK = 6;
const MAX_BLOCK = 64;
const BLOCK_STEP = 0.25;
// 連の長さが塊の大きさの倍数から、これ (px) 以内なら倍数とみなす
const MULTIPLE_TOLERANCE = 1;
// 行・列のそれぞれに、これ未満の連しか無い画像はドット絵とみなさない
const MIN_RUNS = 50;
// 判定の値がこれ以上ならドット絵
const MIN_SCORE = 0.4;
// 長辺がこれを超える画像はドット絵とみなさない
const MAX_LONG_SIDE = 2048;

// 2 つの画素の色の差 (チャンネルごとの差の最大)
function difference(data: Buffer, a: number, b: number): number {
    return Math.max(
        Math.abs(data[a] - data[b]),
        Math.abs(data[a + 1] - data[b + 1]),
        Math.abs(data[a + 2] - data[b + 2]),
        Math.abs(data[a + 3] - data[b + 3])
    );
}

// 行 (horizontal) または列の、色がはっきり変わる位置の間の連の長さの度数 (添字が長さ)。
// 画像の端に接する連 (長さが切れているもの) は数えない
function runHistogram(image: RgbaImage, horizontal: boolean): { counts: Float64Array; total: number } {
    const { width, height, data } = image;
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const counts = new Float64Array(length + 1);
    let total = 0;
    for (let line = 0; line < lines; line++) {
        let start = -1;
        for (let k = 1; k < length; k++) {
            const current = horizontal ? (line * width + k) * 4 : (k * width + line) * 4;
            const previous = horizontal ? current - 4 : current - width * 4;
            if (difference(data, current, previous) <= EDGE_DIFFERENCE) continue;
            if (start >= 0) {
                counts[k - start]++;
                total++;
            }
            start = k;
        }
    }
    return { counts, total };
}

// 連の長さが塊の大きさ block の倍数に近い割合を、偶然に近くなる割合 (3 / block) を除いて 0-1 にそろえた値
function multipleRatio(histogram: { counts: Float64Array; total: number }, block: number): number {
    let near = 0;
    const { counts, total } = histogram;
    for (let v = 1; v < counts.length; v++) {
        if (!counts[v]) continue;
        if (Math.abs(v - block * Math.max(1, Math.round(v / block))) <= MULTIPLE_TOLERANCE) near += counts[v];
    }
    const chance = 3 / block;
    return (near / total - chance) / (1 - chance);
}

// 画像ファイルの元画像 (縮小・拡大の前。EXIF の向きを反映したもの。大きさは sourceSize) がドット絵か。
// 長辺が MAX_LONG_SIDE を超える画像と、行・列の連が少ない画像はドット絵でない
export async function isPixelArtFile(filePath: string, sourceSize: ImageSize): Promise<boolean> {
    const longSide = Math.max(sourceSize.width, sourceSize.height);
    if (longSide > MAX_LONG_SIDE) return false;
    // 長辺を元画像の長辺にそろえる (大きさを変えずに読む)
    const { image } = await loadImageLong(filePath, longSide, 'nearest');
    const rows = runHistogram(image, true);
    const columns = runHistogram(image, false);
    if (rows.total < MIN_RUNS || columns.total < MIN_RUNS) return false;
    let score = 0;
    for (let block = MIN_BLOCK; block <= MAX_BLOCK; block += BLOCK_STEP) {
        score = Math.max(score, Math.min(multipleRatio(rows, block), multipleRatio(columns, block)));
    }
    return score >= MIN_SCORE;
}
