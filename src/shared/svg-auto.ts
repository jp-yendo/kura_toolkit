// SVG 自動変換の設定の既定値と範囲・手順 (main / renderer で共用)。
// Node / DOM に依存させない。

// 試す回数 (変換を試す回数の上限) の初期値 (設定ファイルには保存しないため、起動のたびにこの値から始まる)
export const DEFAULT_SVG_AUTO_TRIALS = 40;

// 試す回数の範囲 (画面のスライダーと入力欄の範囲。整数)
export const SVG_AUTO_TRIALS_RANGE = { min: 10, max: 200 };

// 手順 (進み具合の段階 svgAuto.<手順> の名前。画面の「手順 n / 4」はこの順)
export const SVG_AUTO_STEPS = ['preprocess', 'trial', 'select', 'refine'] as const;

export type SvgAutoStep = (typeof SVG_AUTO_STEPS)[number];
