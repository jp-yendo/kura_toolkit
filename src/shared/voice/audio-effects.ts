// 効果を付けるエフェクト (EQ・コンプレッサー・ディエッサー・コーラス・ディレイ・リバーブ)。分岐の「エフェクト」と、
// 音声変換の候補のフィルターで同じ設定・同じ初期値を使う。どれも「チェックすると設定の欄が出る」形で、欄の値は
// チェックを外しても覚えておく。かける順は EQ → コンプレッサー → ディエッサー → コーラス → ディレイ → リバーブ
// (一般的なボーカルの処理の順)。長さとチャンネル数は変えない (最後にかかる余韻は元の長さで切り、短くフェードアウトする)

// EQ (グラフィック EQ の 10 バンドとローカット)。バンドの周波数は一般的なプレーヤーの 10 バンドと同じ
export const EQ_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_GAIN_RANGE = { min: -12, max: 12 };
// ローカットの周波数の選択肢 (0 はローカットしない)
export const EQ_LOW_CUT_CHOICES = [0, 30, 40, 60, 80, 100, 120, 150, 200] as const;

export type EqOption = {
    enabled: boolean;
    // ローカットの周波数 (Hz。0 はローカットしない)
    lowCutHz: number;
    // 各バンドの量 (dB。EQ_BANDS_HZ の順)
    gainsDb: number[];
};

export type EqPresetGroup = 'voice' | 'music';

export type EqPreset = {
    id: string;
    // 声向け / 曲・伴奏向け (曲調)
    group: EqPresetGroup;
    lowCutHz: number;
    gainsDb: number[];
};

// EQ のプリセット (アプリが決めた値)。声向けは声の処理でよく使われる範囲の控えめな出発点、曲・伴奏向けは一般的な
// プレーヤーの EQ のカーブを、強くかけすぎないよう ±5dB 以内に抑えたもの
export const EQ_PRESETS: EqPreset[] = [
    { id: 'flat', group: 'voice', lowCutHz: 0, gainsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'vocalTidy', group: 'voice', lowCutHz: 100, gainsDb: [0, 0, -1, -2, -2, 0, 1, 1, 2, 2] },
    { id: 'removeMuddiness', group: 'voice', lowCutHz: 80, gainsDb: [0, 0, -1, -3, -3, -1, 0, 1, 1, 1] },
    { id: 'clarity', group: 'voice', lowCutHz: 100, gainsDb: [0, 0, 0, 0, 0, 1, 2, 3, 3, 3] },
    { id: 'vocalBoost', group: 'voice', lowCutHz: 0, gainsDb: [-2, -2, -1, 1, 3, 3, 3, 2, 0, -1] },
    { id: 'speech', group: 'voice', lowCutHz: 120, gainsDb: [0, 0, -1, -2, -1, 0, 1, 2, 1, 0] },
    { id: 'bassBoost', group: 'voice', lowCutHz: 30, gainsDb: [3, 4, 3, 1, 0, 0, 0, 0, 0, 0] },
    { id: 'trebleBoost', group: 'voice', lowCutHz: 0, gainsDb: [0, 0, 0, 0, 0, 0, 0, 1, 3, 4] },
    { id: 'rock', group: 'music', lowCutHz: 0, gainsDb: [4, 3, 2, 0, -2, -2, 0, 2, 3, 4] },
    { id: 'pop', group: 'music', lowCutHz: 0, gainsDb: [-1, 0, 1, 2, 3, 3, 2, 1, 0, -1] },
    { id: 'ballad', group: 'music', lowCutHz: 0, gainsDb: [2, 2, 2, 1, 1, 2, 2, 1, 0, -1] },
    { id: 'jazz', group: 'music', lowCutHz: 0, gainsDb: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
    { id: 'classical', group: 'music', lowCutHz: 0, gainsDb: [3, 2, 1, 0, 0, 0, 0, 1, 2, 3] },
    { id: 'dance', group: 'music', lowCutHz: 0, gainsDb: [5, 4, 2, 0, -1, -1, 0, 2, 3, 3] },
    { id: 'hipHop', group: 'music', lowCutHz: 0, gainsDb: [5, 5, 3, 1, -1, -1, 0, 1, 1, 2] },
    { id: 'rnb', group: 'music', lowCutHz: 0, gainsDb: [3, 5, 4, 1, -1, -1, 1, 1, 2, 2] },
    { id: 'electronic', group: 'music', lowCutHz: 0, gainsDb: [4, 3, 1, 0, -2, 1, 0, 1, 3, 4] },
    { id: 'acoustic', group: 'music', lowCutHz: 0, gainsDb: [2, 2, 2, 1, 0, 1, 2, 2, 2, 1] },
    { id: 'loudness', group: 'music', lowCutHz: 0, gainsDb: [4, 3, 1, 0, 0, 0, 0, 0, 2, 4] },
];

// コンプレッサー (pedalboard の Compressor)
export type CompressorOption = {
    enabled: boolean;
    // しきい値 (dBFS)
    thresholdDb: number;
    // 比率 (1 以上。1 では何もしない)
    ratio: number;
    // アタック (ms)
    attackMs: number;
    // リリース (ms)
    releaseMs: number;
};

// ディエッサー (ffmpeg の deesser。値はどれも 0-1)
export type DeesserOption = {
    enabled: boolean;
    // 強さ (i)
    intensity: number;
    // 抑える量の上限 (m)
    max: number;
    // 周波数 (f。大きいほど高い帯域)
    frequency: number;
};

// コーラス (pedalboard の Chorus)
export type ChorusOption = {
    enabled: boolean;
    // 揺れの速さ (Hz)
    rateHz: number;
    // 揺れの深さ (0-1)
    depth: number;
    // 中心の遅れ (ms)
    centreDelayMs: number;
    // フィードバック (0-0.95)
    feedback: number;
    // 混ぜる量 (0-1)
    mix: number;
};

// ディレイ (pedalboard の Delay)
export type DelayOption = {
    enabled: boolean;
    // 遅れの時間 (秒)
    delaySeconds: number;
    // フィードバック (0-0.95)
    feedback: number;
    // 混ぜる量 (0-1)
    mix: number;
};

// リバーブ (pedalboard の Reverb)。残響音の量・原音の量は実際の音量の倍率 (原音の量 1 で元の大きさのまま)
export type ReverbOption = {
    enabled: boolean;
    // 部屋の大きさ (0-1)
    roomSize: number;
    // 高域の減衰 (0-1)
    damping: number;
    // 残響音の量 (0-1)
    wetLevel: number;
    // 原音の量 (0-1)
    dryLevel: number;
    // ステレオの広がり (0-1。ステレオの音で効く)
    width: number;
};

export type ReverbPreset = { id: string; values: Omit<ReverbOption, 'enabled'> };

// リバーブのプリセット。響きが小さいものから大きいものの順に並べる。原音の量は 1 (元の大きさのまま) にし、部屋の大きさ・
// 残響音の量で響きの大きさを、高域の減衰で明るさを分ける (pedalboard の Reverb はプレートなどを本物どおりには作れない
// ため、「ボーカル」「明るい響き」は高域の減衰を小さくして近づけたもの)。先頭の「控えめ」が初期値 (残響は声より約 25 dB
// 小さく、空気感が少し足される程度)。「軽いリバーブ」「ホール」と「控えめ」(合成の「ボーカルを前に」のもの) は、合成の
// 初期のプリセットから移したもの
export const REVERB_PRESETS: ReverbPreset[] = [
    { id: 'subtle', values: { roomSize: 0.25, damping: 0.6, wetLevel: 0.13, dryLevel: 1, width: 0.8 } },
    { id: 'smallRoom', values: { roomSize: 0.2, damping: 0.6, wetLevel: 0.15, dryLevel: 1, width: 0.7 } },
    { id: 'light', values: { roomSize: 0.3, damping: 0.5, wetLevel: 0.2, dryLevel: 1, width: 1 } },
    { id: 'vocal', values: { roomSize: 0.45, damping: 0.25, wetLevel: 0.25, dryLevel: 1, width: 1 } },
    { id: 'liveHouse', values: { roomSize: 0.5, damping: 0.5, wetLevel: 0.3, dryLevel: 1, width: 1 } },
    { id: 'bright', values: { roomSize: 0.6, damping: 0.1, wetLevel: 0.35, dryLevel: 1, width: 1 } },
    { id: 'warm', values: { roomSize: 0.6, damping: 0.8, wetLevel: 0.35, dryLevel: 1, width: 1 } },
    { id: 'hall', values: { roomSize: 0.75, damping: 0.4, wetLevel: 0.53, dryLevel: 1, width: 1 } },
    { id: 'cathedral', values: { roomSize: 0.92, damping: 0.3, wetLevel: 0.6, dryLevel: 1, width: 1 } },
];

export type EffectsOptions = {
    eq: EqOption;
    compressor: CompressorOption;
    deesser: DeesserOption;
    chorus: ChorusOption;
    delay: DelayOption;
    reverb: ReverbOption;
};

// 初期値 (チェックはどれも無し)。EQ はフラット、コンプレッサーは声に軽くかかる値、コーラス・ディレイは控えめに
// 混ぜる値、リバーブは「控えめ」(プリセットの先頭)
export const EFFECT_DEFAULTS: { [K in keyof EffectsOptions]: Omit<EffectsOptions[K], 'enabled'> } = {
    eq: { lowCutHz: 0, gainsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    compressor: { thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150 },
    deesser: { intensity: 0.5, max: 0.5, frequency: 0.5 },
    chorus: { rateHz: 1, depth: 0.25, centreDelayMs: 7, feedback: 0, mix: 0.3 },
    delay: { delaySeconds: 0.3, feedback: 0.25, mix: 0.25 },
    reverb: { ...REVERB_PRESETS[0].values },
};

// スライダーの範囲
export const EFFECT_RANGE = {
    compressor: {
        thresholdDb: { min: -60, max: 0 },
        ratio: { min: 1, max: 20 },
        attackMs: { min: 0.1, max: 100 },
        releaseMs: { min: 10, max: 1000 },
    },
    deesser: { intensity: { min: 0, max: 1 }, max: { min: 0, max: 1 }, frequency: { min: 0, max: 1 } },
    chorus: {
        rateHz: { min: 0.1, max: 10 },
        depth: { min: 0, max: 1 },
        centreDelayMs: { min: 1, max: 30 },
        feedback: { min: 0, max: 0.95 },
        mix: { min: 0, max: 1 },
    },
    delay: { delaySeconds: { min: 0.01, max: 2 }, feedback: { min: 0, max: 0.95 }, mix: { min: 0, max: 1 } },
    reverb: {
        roomSize: { min: 0, max: 1 },
        damping: { min: 0, max: 1 },
        wetLevel: { min: 0, max: 1 },
        dryLevel: { min: 0, max: 1 },
        width: { min: 0, max: 1 },
    },
};

export function effectsDefaults(): EffectsOptions {
    return {
        eq: { enabled: false, ...EFFECT_DEFAULTS.eq, gainsDb: [...EFFECT_DEFAULTS.eq.gainsDb] },
        compressor: { enabled: false, ...EFFECT_DEFAULTS.compressor },
        deesser: { enabled: false, ...EFFECT_DEFAULTS.deesser },
        chorus: { enabled: false, ...EFFECT_DEFAULTS.chorus },
        delay: { enabled: false, ...EFFECT_DEFAULTS.delay },
        reverb: { enabled: false, ...EFFECT_DEFAULTS.reverb },
    };
}

export function hasEffect(effects: EffectsOptions): boolean {
    return Object.values(effects).some(effect => effect.enabled);
}

// 余韻を作るエフェクト (最後を短くフェードアウトする。ステレオの音として作ると広がりが出る)
export function hasTailEffect(effects: EffectsOptions): boolean {
    return effects.chorus.enabled || effects.delay.enabled || effects.reverb.enabled;
}

// 画面から受け取った設定を確かめ、数値は範囲に収める (main で使う。値は Python と ffmpeg のフィルターの指定に入るため)
function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(range.max, Math.max(range.min, number));
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function sanitizeGroup<T extends Record<string, number>>(
    value: unknown,
    defaults: T,
    ranges: { [K in keyof T]: { min: number; max: number } }
): T & { enabled: boolean } {
    const item = record(value);
    const result: Record<string, number> = {};
    for (const key of Object.keys(defaults)) {
        result[key] = clampNumber(item[key], ranges[key as keyof T], defaults[key as keyof T]);
    }
    return { enabled: item.enabled === true, ...(result as T) };
}

export function sanitizeEffectsOptions(value: unknown): EffectsOptions {
    const item = record(value);
    const eq = record(item.eq);
    const gains = Array.isArray(eq.gainsDb) ? eq.gainsDb : [];
    return {
        eq: {
            enabled: eq.enabled === true,
            lowCutHz: (EQ_LOW_CUT_CHOICES as readonly number[]).includes(eq.lowCutHz as number)
                ? (eq.lowCutHz as number)
                : 0,
            gainsDb: EQ_BANDS_HZ.map((_band, index) => clampNumber(gains[index], EQ_GAIN_RANGE, 0)),
        },
        compressor: sanitizeGroup(item.compressor, EFFECT_DEFAULTS.compressor, EFFECT_RANGE.compressor),
        deesser: sanitizeGroup(item.deesser, EFFECT_DEFAULTS.deesser, EFFECT_RANGE.deesser),
        chorus: sanitizeGroup(item.chorus, EFFECT_DEFAULTS.chorus, EFFECT_RANGE.chorus),
        delay: sanitizeGroup(item.delay, EFFECT_DEFAULTS.delay, EFFECT_RANGE.delay),
        reverb: sanitizeGroup(item.reverb, EFFECT_DEFAULTS.reverb, EFFECT_RANGE.reverb),
    };
}
