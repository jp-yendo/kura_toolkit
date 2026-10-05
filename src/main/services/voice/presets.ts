import crypto from 'crypto';
import path from 'path';
import { getAppRootDir } from '../../../shared/constants';
import { readJsonFile, writeJsonFile } from './json-file';
import type { MixParams, PresetKind, PresetRecord, SeparationPresetParams } from '../../../shared/voice/types';

// 分離と合成のパラメーターのプリセット (~/.kura_toolkit/voice-presets/<種類>.json)。
// 1 種類 1 ファイルで、保存・呼び出し・名前変更・削除ができる。
// 合成のプリセットにはアプリが用意した初期のものがあり、それは読み取り専用
// (上書き・名前変更・削除は PRESET_BUILTIN で断る。新しいプリセットとしての保存はできる)。

export type PresetParams = SeparationPresetParams | MixParams;

type PresetFile = {
    version: 1;
    presets: PresetRecord<PresetParams>[];
};

function presetPath(kind: PresetKind): string {
    // 種類は renderer から渡されるため、決まった名前に限る (ファイル名に使うため)
    if (kind !== 'separation' && kind !== 'mix') throw new Error(`INVALID_PRESET_KIND: ${String(kind)}`);
    return path.join(getAppRootDir(), 'voice-presets', `${kind}.json`);
}

// 初期の合成プリセット。名前は renderer で翻訳するため翻訳キーで持つ
const BUILTIN_MIX_PRESETS: PresetRecord<MixParams>[] = [
    {
        id: 'builtin-standard',
        name: '',
        nameKey: 'voice.mix.builtin.standard',
        builtin: true,
        params: {
            vocalGainDb: 0,
            accompanimentGainDb: 0,
            masterGainDb: 0,
            reverb: { enabled: true, roomSize: 0.3, damping: 0.5, wetLevel: 0.12, dryLevel: 0.9, width: 1 },
            limiter: true,
        },
    },
    {
        id: 'builtin-dry',
        name: '',
        nameKey: 'voice.mix.builtin.dry',
        builtin: true,
        params: {
            vocalGainDb: 0,
            accompanimentGainDb: 0,
            masterGainDb: 0,
            reverb: { enabled: false, roomSize: 0.3, damping: 0.5, wetLevel: 0.12, dryLevel: 0.9, width: 1 },
            limiter: true,
        },
    },
    {
        id: 'builtin-hall',
        name: '',
        nameKey: 'voice.mix.builtin.hall',
        builtin: true,
        params: {
            vocalGainDb: 0,
            accompanimentGainDb: -1,
            masterGainDb: 0,
            reverb: { enabled: true, roomSize: 0.75, damping: 0.4, wetLevel: 0.28, dryLevel: 0.8, width: 1 },
            limiter: true,
        },
    },
    {
        id: 'builtin-vocal-forward',
        name: '',
        nameKey: 'voice.mix.builtin.vocalForward',
        builtin: true,
        params: {
            vocalGainDb: 3,
            accompanimentGainDb: -2,
            masterGainDb: 0,
            reverb: { enabled: true, roomSize: 0.25, damping: 0.6, wetLevel: 0.08, dryLevel: 0.95, width: 0.8 },
            limiter: true,
        },
    },
];

// ファイルが無い場合は初期状態 (合成は初期のプリセットの複製。定義そのものは書き換えない)。
// 読めない・壊れている場合は DATA_FILE_CORRUPT で失敗する
function readFile(kind: PresetKind): PresetFile {
    const data = readJsonFile<PresetFile>(presetPath(kind));
    if (data) return data;
    return { version: 1, presets: kind === 'mix' ? structuredClone(BUILTIN_MIX_PRESETS) : [] };
}

function writeFile(kind: PresetKind, data: PresetFile): void {
    writeJsonFile(presetPath(kind), data);
}

export function listPresets(kind: PresetKind): PresetRecord<PresetParams>[] {
    return readFile(kind).presets;
}

// 同じ ID があれば上書き、無ければ追加する。初期のプリセットは上書きできない
export function savePreset(
    kind: PresetKind,
    preset: { id?: string; name: string; params: PresetParams }
): PresetRecord<PresetParams>[] {
    const data = readFile(kind);
    const id = preset.id ?? crypto.randomUUID();
    const existing = data.presets.find(item => item.id === id);
    if (existing) {
        if (existing.builtin) throw new Error('PRESET_BUILTIN');
        existing.params = preset.params;
        if (preset.name) existing.name = preset.name;
    } else {
        data.presets.push({ id, name: preset.name, builtin: false, params: preset.params });
    }
    writeFile(kind, data);
    return data.presets;
}

// 初期のプリセットは名前を変えられない
export function renamePreset(kind: PresetKind, id: string, name: string): PresetRecord<PresetParams>[] {
    const data = readFile(kind);
    const preset = data.presets.find(item => item.id === id);
    if (preset) {
        if (preset.builtin) throw new Error('PRESET_BUILTIN');
        preset.name = name;
        writeFile(kind, data);
    }
    return data.presets;
}

// 初期のプリセットは削除できない
export function removePreset(kind: PresetKind, id: string): PresetRecord<PresetParams>[] {
    const data = readFile(kind);
    if (data.presets.some(item => item.id === id && item.builtin)) throw new Error('PRESET_BUILTIN');
    data.presets = data.presets.filter(item => item.id !== id);
    writeFile(kind, data);
    return data.presets;
}
