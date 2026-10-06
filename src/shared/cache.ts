// キャッシュディレクトリの共通定数。
// renderer からも読み込むため、Node のモジュール (os / path) には依存させない

// キャッシュの保持期間 (日) の下限・既定値 (上限は設けない)
export const CACHE_RETENTION_DAYS_MIN = 1;
export const CACHE_RETENTION_DAYS_DEFAULT = 30;
