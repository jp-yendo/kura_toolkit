import path from 'path';
import { getAppRootDir } from '../../shared/constants';
import { DEFAULT_VECTORIZE_PARAMS, INITIAL_VECTORIZE_PRESET_ID, VECTORIZE_PARAM_RANGES } from '../../shared/vectorizer';
import { readJsonFile, writeJsonFile } from './voice/json-file';
import { removePresetFrom, renamePresetIn, upsertPreset } from './preset-list';
import type { PresetRecord, PresetSaveRequest, VectorizeParams } from '../../shared/types';

// 画像 SVG 変換のパラメータのプリセット (~/.kura_toolkit/presets/vectorizer.json)。
// 標準のプリセットはこのファイルの定義だけに持ち、ファイルには利用者のプリセット (カスタム) だけを書く
// (ファイルを書き換えられても標準のプリセットは変わらない)。標準のプリセットは上書き・名前変更・削除できない

type PresetFile = {
    version: 1;
    presets: PresetRecord<VectorizeParams>[];
};

function presetPath(): string {
    return path.join(getAppRootDir(), 'presets', 'vectorizer.json');
}

function builtin(id: string, nameKey: string, params: Partial<VectorizeParams>): PresetRecord<VectorizeParams> {
    return {
        id: `builtin-${id}`,
        name: '',
        nameKey,
        builtin: true,
        params: { ...DEFAULT_VECTORIZE_PARAMS, ...params },
    };
}

// 標準のプリセット。名前は renderer で翻訳するため翻訳キーで持つ。
// 汎用は既定値 (DEFAULT_VECTORIZE_PARAMS。色精度 8 のほかは vtracer の既定値)。白黒・ポスター・写真は vtracer の公式のプリセット
// (bw / poster / photo) と同じ値
// (白黒では色精度・階調・階層は使われない。ピクセルアートのモード none ではコーナー・セグメント長・スプライスは使われない)
const BUILTIN_PRESETS: PresetRecord<VectorizeParams>[] = [
    { ...builtin('general', 'svgPage.presetNames.general', {}), id: INITIAL_VECTORIZE_PRESET_ID },
    builtin('bw', 'svgPage.presetNames.bw', { colorMode: 'binary', colorPrecision: 6 }),
    builtin('poster', 'svgPage.presetNames.poster', { colorPrecision: 8 }),
    builtin('photo', 'svgPage.presetNames.photo', {
        filterSpeckle: 10,
        colorPrecision: 8,
        layerDifference: 48,
        cornerThreshold: 180,
    }),
    builtin('logo', 'svgPage.presetNames.logo', {
        filterSpeckle: 8,
        colorPrecision: 5,
        layerDifference: 32,
        cornerThreshold: 45,
    }),
    builtin('detail', 'svgPage.presetNames.detail', {
        filterSpeckle: 1,
        colorPrecision: 8,
        layerDifference: 8,
        cornerThreshold: 45,
        lengthThreshold: 3.5,
    }),
    builtin('pixelArt', 'svgPage.presetNames.pixelArt', {
        filterSpeckle: 0,
        colorPrecision: 8,
        layerDifference: 0,
        mode: 'none',
    }),
];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function numberIn(value: unknown, key: keyof typeof VECTORIZE_PARAM_RANGES): number {
    const range = VECTORIZE_PARAM_RANGES[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VECTORIZE_PARAMS[key];
    return Math.min(range.max, Math.max(range.min, value));
}

// 受け取った値を今のパラメータの形にする (欠けた値は既定値、範囲外は範囲に収め、知らない項目は除く)
export function normalizeVectorizeParams(value: unknown): VectorizeParams {
    const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    return {
        colorMode: pick(raw.colorMode, ['color', 'binary'], DEFAULT_VECTORIZE_PARAMS.colorMode),
        hierarchical: pick(raw.hierarchical, ['stacked', 'cutout'], DEFAULT_VECTORIZE_PARAMS.hierarchical),
        filterSpeckle: numberIn(raw.filterSpeckle, 'filterSpeckle'),
        colorPrecision: numberIn(raw.colorPrecision, 'colorPrecision'),
        layerDifference: numberIn(raw.layerDifference, 'layerDifference'),
        mode: pick(raw.mode, ['spline', 'polygon', 'none'], DEFAULT_VECTORIZE_PARAMS.mode),
        cornerThreshold: numberIn(raw.cornerThreshold, 'cornerThreshold'),
        lengthThreshold: numberIn(raw.lengthThreshold, 'lengthThreshold'),
        spliceThreshold: numberIn(raw.spliceThreshold, 'spliceThreshold'),
    };
}

// 利用者のプリセットを読む。ファイルが無い場合は 0 件。読めない・形が違う場合は DATA_FILE_CORRUPT で失敗する
// (空として扱うと、次に保存したときに元のプリセットが失われるため)。
// 標準のプリセットと同じ ID や builtin の印を持つ項目は、標準のプリセットを変えられないよう読み飛ばす
function readCustomPresets(): PresetRecord<VectorizeParams>[] {
    const file = presetPath();
    const data = readJsonFile<Partial<PresetFile>>(file);
    if (data === null) return [];
    if (typeof data !== 'object' || !Array.isArray(data.presets)) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    const builtinIds = new Set(BUILTIN_PRESETS.map(preset => preset.id));
    return data.presets
        .filter(
            preset =>
                typeof preset === 'object' &&
                preset !== null &&
                typeof preset.id === 'string' &&
                !builtinIds.has(preset.id) &&
                preset.builtin !== true
        )
        .map(preset => ({
            id: preset.id,
            name: typeof preset.name === 'string' ? preset.name : '',
            builtin: false,
            params: normalizeVectorizeParams(preset.params),
        }));
}

// 標準のプリセット (定義の写し)
export function builtinVectorizerPresets(): PresetRecord<VectorizeParams>[] {
    return structuredClone(BUILTIN_PRESETS);
}

// 標準のプリセットの後に利用者のプリセットを並べる
function readAll(): PresetRecord<VectorizeParams>[] {
    return [...builtinVectorizerPresets(), ...readCustomPresets()];
}

// 利用者のプリセットだけを書く
function writeCustom(presets: PresetRecord<VectorizeParams>[]): void {
    const data: PresetFile = { version: 1, presets: presets.filter(preset => !preset.builtin) };
    writeJsonFile(presetPath(), data);
}

export function listVectorizerPresets(): PresetRecord<VectorizeParams>[] {
    return readAll();
}

// 同じ ID があれば上書き、無ければ追加する。新しく作るときは名前が必要 (PRESET_NAME_REQUIRED)
export function saveVectorizerPreset(preset: PresetSaveRequest<VectorizeParams>): PresetRecord<VectorizeParams>[] {
    const name = preset.name.trim();
    if (!preset.id && !name) throw new Error('PRESET_NAME_REQUIRED');
    const presets = readAll();
    upsertPreset(presets, { id: preset.id, name, params: normalizeVectorizeParams(preset.params) });
    writeCustom(presets);
    return presets;
}

export function renameVectorizerPreset(id: string, name: string): PresetRecord<VectorizeParams>[] {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('PRESET_NAME_REQUIRED');
    const presets = readAll();
    if (renamePresetIn(presets, id, trimmed)) writeCustom(presets);
    return presets;
}

export function removeVectorizerPreset(id: string): PresetRecord<VectorizeParams>[] {
    const presets = removePresetFrom(readAll(), id);
    writeCustom(presets);
    return presets;
}
