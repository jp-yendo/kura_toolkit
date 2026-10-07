// 声の音の加工 (無音の扱い・ノイズ除去・音量をそろえる)。変換のオプション・学習用の音のフィルター・分岐の「その他」で
// 同じ設定・同じ初期値を使う。どれも「チェックするとスライダーが出る」形で、スライダーの値はチェックを外しても覚えておく

// 無音の判断。音のピークから thresholdDb (負の値) より小さい状態が minSeconds 以上続く部分を無音とする。
// 変換と分岐では無音部分の音量を 0 にし (時間は変わらない)、学習用の音のフィルターでは無音部分を除去して詰める
export type SilenceOption = { enabled: boolean; thresholdDb: number; minSeconds: number };

// ノイズ除去の方式。simple: ffmpeg の afftdn (FFT。雑音とみなす大きさ以下の成分を、下げる量だけ下げる)。
// wavelet: ffmpeg の afwtdn (ウェーブレット。雑音の大きさ以下の成分を、除去の強さの割合だけ除く)。
// model: ノイズ除去のおすすめのモデル (NOISE_REMOVAL_MODELS) で分離し、ノイズを除いた方の出力を使う
export type NoiseRemovalMethod = 'simple' | 'wavelet' | 'model';

export type NoiseRemovalOption = {
    enabled: boolean;
    method: NoiseRemovalMethod;
    // 雑音とみなす大きさ (dB。afftdn の noise_floor)
    floorDb: number;
    // 雑音を下げる量 (dB。afftdn の noise_reduction)
    reductionDb: number;
    // 雑音の大きさ (dB。afwtdn の sigma (振幅) を dB で表したもの)
    waveletNoiseDb: number;
    // 除去の強さ (%。afwtdn の percent)
    waveletPercent: number;
    // モデルで除去する場合のモデル (ファイル名。null は、取得済みのおすすめのうち先頭)
    model: string | null;
};

// 音量をそろえる。ファイル全体を一律に上げ下げし、ピークが上限を超える場合は上限までにとどめる (オーディオ正規化と同じ)
export type LoudnessOption = { enabled: boolean; targetLufs: number };

// 初期値とスライダーの範囲。無音の大きさの初期値は、なるべく消さない値。長さは Applio が学習の前に無音を切る長さ。
// afftdn の 2 つの値は ffmpeg の初期値。afwtdn の除去の強さは ffmpeg の初期値で、雑音の大きさは ffmpeg の初期値 (0) では
// 何も除かないため、afftdn の雑音とみなす大きさと同じ値にする。音量は話し声の配信でよく使われる値
export const SILENCE_DEFAULTS = { thresholdDb: -60, minSeconds: 0.4 };
export const SILENCE_RANGE = { thresholdDb: { min: -90, max: -20 }, minSeconds: { min: 0.1, max: 5 } };
export const NOISE_REMOVAL_DEFAULTS = { floorDb: -50, reductionDb: 12, waveletNoiseDb: -50, waveletPercent: 85 };
export const NOISE_REMOVAL_RANGE = {
    floorDb: { min: -80, max: -20 },
    reductionDb: { min: 1, max: 60 },
    waveletNoiseDb: { min: -80, max: -20 },
    waveletPercent: { min: 0, max: 100 },
};
export const LOUDNESS_DEFAULT_LUFS = -16;
export const LOUDNESS_RANGE = { min: -30, max: -10 };

export function silenceOption(enabled: boolean): SilenceOption {
    return { enabled, ...SILENCE_DEFAULTS };
}

export function noiseRemovalOption(enabled: boolean): NoiseRemovalOption {
    return { enabled, method: 'simple', ...NOISE_REMOVAL_DEFAULTS, model: null };
}

export function loudnessOption(enabled: boolean): LoudnessOption {
    return { enabled, targetLufs: LOUDNESS_DEFAULT_LUFS };
}

// ノイズ除去のおすすめのモデル (目的別のおすすめの「ノイズ除去」と、ノイズ除去の「モデルで除去する」で使う)。
// 上から順に、取得済みのものを初期値にする。cleanStem はノイズを除いた方の出力の名前 (大文字・小文字は区別しない)。
// 出典: 分離の利用者コミュニティのガイド。Mel-Roformer Denoise は VR 方式の DeNoise より控えめに取り除き、
// Aggr は強めに取り除く。UVR-DeNoise-Lite は控えめで軽い
export const NOISE_REMOVAL_MODELS: { filename: string; cleanStem: string }[] = [
    { filename: 'denoise_mel_band_roformer_aufr33_sdr_27.9959.ckpt', cleanStem: 'dry' },
    { filename: 'denoise_mel_band_roformer_aufr33_aggr_sdr_27.9768.ckpt', cleanStem: 'dry' },
    { filename: 'UVR-DeNoise-Lite.pth', cleanStem: 'no noise' },
];

// 学習用の音のフィルター。処理の順は、無音部分の除去 → ノイズ除去 → 音量をそろえる (ノイズ除去で音量が下がるため、
// 音量は最後にそろえる。無音の判断はピークからの大きさなので、音量をそろえる前後で変わらない)
export type TrainingFilterOptions = {
    removeSilence: SilenceOption;
    noiseRemoval: NoiseRemovalOption;
    loudness: LoudnessOption;
};

// 個々の音のフィルターの初期値 (すべてチェックあり)。全体に適用するときは、無音部分の除去だけチェックあり
export function trainingFilterDefaults(scope: 'audio' | 'set'): TrainingFilterOptions {
    return {
        removeSilence: silenceOption(true),
        noiseRemoval: noiseRemovalOption(scope === 'audio'),
        loudness: loudnessOption(scope === 'audio'),
    };
}

export function hasTrainingFilter(options: TrainingFilterOptions): boolean {
    return options.removeSilence.enabled || options.noiseRemoval.enabled || options.loudness.enabled;
}

// 画面から受け取った設定を確かめ、数値は範囲に収める (main で使う。値は ffmpeg のフィルターの指定にも入るため)
function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(range.max, Math.max(range.min, number));
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function sanitizeSilenceOption(value: unknown): SilenceOption {
    const item = record(value);
    return {
        enabled: item.enabled === true,
        thresholdDb: clampNumber(item.thresholdDb, SILENCE_RANGE.thresholdDb, SILENCE_DEFAULTS.thresholdDb),
        minSeconds: clampNumber(item.minSeconds, SILENCE_RANGE.minSeconds, SILENCE_DEFAULTS.minSeconds),
    };
}

export function sanitizeNoiseRemovalOption(value: unknown): NoiseRemovalOption {
    const item = record(value);
    return {
        enabled: item.enabled === true,
        method: item.method === 'model' || item.method === 'wavelet' ? item.method : 'simple',
        floorDb: clampNumber(item.floorDb, NOISE_REMOVAL_RANGE.floorDb, NOISE_REMOVAL_DEFAULTS.floorDb),
        reductionDb: clampNumber(item.reductionDb, NOISE_REMOVAL_RANGE.reductionDb, NOISE_REMOVAL_DEFAULTS.reductionDb),
        waveletNoiseDb: clampNumber(
            item.waveletNoiseDb,
            NOISE_REMOVAL_RANGE.waveletNoiseDb,
            NOISE_REMOVAL_DEFAULTS.waveletNoiseDb
        ),
        waveletPercent: clampNumber(
            item.waveletPercent,
            NOISE_REMOVAL_RANGE.waveletPercent,
            NOISE_REMOVAL_DEFAULTS.waveletPercent
        ),
        model: typeof item.model === 'string' ? item.model : null,
    };
}

export function sanitizeLoudnessOption(value: unknown): LoudnessOption {
    const item = record(value);
    return {
        enabled: item.enabled === true,
        targetLufs: clampNumber(item.targetLufs, LOUDNESS_RANGE, LOUDNESS_DEFAULT_LUFS),
    };
}

export function sanitizeTrainingFilterOptions(value: unknown): TrainingFilterOptions {
    const item = record(value);
    return {
        removeSilence: sanitizeSilenceOption(item.removeSilence),
        noiseRemoval: sanitizeNoiseRemovalOption(item.noiseRemoval),
        loudness: sanitizeLoudnessOption(item.loudness),
    };
}
