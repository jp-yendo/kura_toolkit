// ファイル探索 (ディレクトリ走査) の共通定数。
// renderer からも読み込むため、Node のモジュール (os / path) には依存させない
// (constants.ts はホームディレクトリの解決で os / path を使うので、そちらには置かない)。

// 探索スレッド数の下限・上限。設定画面ではこの範囲だけを制限する
export const SEARCH_THREADS_MIN = 1;
export const SEARCH_THREADS_MAX = 100;
