// 画像のベクター化 (画面と electron に依存しない部品) のうち、ほかの機能が使う関数と型。
// どの処理も入力を引数で受け取り、時間のかかるものは取り消し (AbortSignal) と進み具合の知らせ (TraceHooks) を受け取る

// 処理の流れ: 前処理・最適化と、変換の候補を 1 つずつ作る部品、再現度を測るときに比べる元画像
export {
    buildFidelitySample,
    grayFinishSteps,
    optimizeSvg,
    prepareGrayTrace,
    preprocessImageFile,
    traceColorImage,
    traceGrayLevels,
    type TraceHooks,
} from './pipeline';
// 再現度
export { makeReference, measureFidelity } from './fidelity';
// 画像の読み込み
export { loadImageLong } from './image-io';
// 変換ライブラリの設定
export { binaryTraceConfig } from './trace';
// グレースケールの変換と色の再現
export { GRAY_LEVEL_COUNTS, grayScanSteps, levelThresholds } from './gray-scan';
export { recolor } from './recolor';
// SVG の読み書きと描画
export { countPaths, parseSvg, readSvgFrame, toSvg, withDisplaySize, type SvgModel, type SvgPath } from './svg-model';
export { idMap } from './rasterize';
export { toLab } from './lab';
export { isTraceCancelled, throwIfCancelled, type ImageSize, type RgbaImage } from './types';
