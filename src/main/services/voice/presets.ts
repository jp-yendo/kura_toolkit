import path from 'path';
import { getAppRootDir } from '../../../shared/constants';
import { readJsonFile, writeJsonFile } from './json-file';
import { removePresetFrom, renamePresetIn, upsertPreset } from '../preset-list';
import type { PresetSaveRequest } from '../../../shared/types';
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

// 初期の合成プリセット。名前は renderer で翻訳するため翻訳キーで持つ。合成は音量だけを扱う (ボーカルのリバーブは
// 候補のフィルターのエフェクトでかけ、リバーブのプリセットはそちらに持つ)
const BUILTIN_MIX_PRESETS: PresetRecord<MixParams>[] = [
    {
        id: 'builtin-standard',
        name: '',
        nameKey: 'voice.mix.builtin.standard',
        builtin: true,
        params: { vocalGainDb: 0, accompanimentGainDb: 0, masterGainDb: 0 },
    },
    {
        id: 'builtin-vocal-forward',
        name: '',
        nameKey: 'voice.mix.builtin.vocalForward',
        builtin: true,
        params: { vocalGainDb: 3, accompanimentGainDb: -2, masterGainDb: 0 },
    },
];

// 合成のプリセットのファイルを今の形にする。初期のプリセットは今の定義に置き換え (定義から外したものは除く)、利用者の
// プリセットからは合成で扱わなくなった値 (リバーブ) を外す
function currentMixPresets(presets: PresetRecord<PresetParams>[]): PresetRecord<PresetParams>[] {
    const user = presets
        .filter(preset => !preset.builtin)
        .map(preset => {
            const { vocalGainDb, accompanimentGainDb, masterGainDb } = preset.params as MixParams;
            return { ...preset, params: { vocalGainDb, accompanimentGainDb, masterGainDb } };
        });
    return [...structuredClone(BUILTIN_MIX_PRESETS), ...user];
}

// ファイルが無い場合は初期状態 (合成は初期のプリセットの複製。定義そのものは書き換えない)。
// 読めない・壊れている場合は DATA_FILE_CORRUPT で失敗する
function readFile(kind: PresetKind): PresetFile {
    const data = readJsonFile<PresetFile>(presetPath(kind));
    if (data) return kind === 'mix' ? { ...data, presets: currentMixPresets(data.presets) } : data;
    return { version: 1, presets: kind === 'mix' ? structuredClone(BUILTIN_MIX_PRESETS) : [] };
}

function writeFile(kind: PresetKind, data: PresetFile): void {
    writeJsonFile(presetPath(kind), data);
}

export function listPresets(kind: PresetKind): PresetRecord<PresetParams>[] {
    return readFile(kind).presets;
}

// 同じ ID があれば上書き、無ければ追加する。初期のプリセットは上書きできない
export function savePreset(kind: PresetKind, preset: PresetSaveRequest<PresetParams>): PresetRecord<PresetParams>[] {
    const data = readFile(kind);
    upsertPreset(data.presets, preset);
    writeFile(kind, data);
    return data.presets;
}

// 初期のプリセットは名前を変えられない
export function renamePreset(kind: PresetKind, id: string, name: string): PresetRecord<PresetParams>[] {
    const data = readFile(kind);
    if (renamePresetIn(data.presets, id, name)) writeFile(kind, data);
    return data.presets;
}

// 初期のプリセットは削除できない
export function removePreset(kind: PresetKind, id: string): PresetRecord<PresetParams>[] {
    const data = readFile(kind);
    data.presets = removePresetFrom(data.presets, id);
    writeFile(kind, data);
    return data.presets;
}
