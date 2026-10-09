import crypto from 'crypto';
import type { PresetRecord, PresetSaveRequest } from '../../shared/types';

// プリセットの一覧の操作 (SVG 変換・音声機能で共通)。一覧そのものを書き換え、ファイルへの保存は呼び出し側で行う。
// アプリが用意したプリセット (builtin) は上書き・名前変更・削除できない (PRESET_BUILTIN で断る)

// 同じ ID があれば上書き、無ければ追加する。保存したプリセットの ID を返す
export function upsertPreset<T>(presets: PresetRecord<T>[], preset: PresetSaveRequest<T>): string {
    const id = preset.id ?? crypto.randomUUID();
    const existing = presets.find(item => item.id === id);
    if (existing) {
        if (existing.builtin) throw new Error('PRESET_BUILTIN');
        existing.params = preset.params;
        if (preset.name) existing.name = preset.name;
    } else {
        presets.push({ id, name: preset.name, builtin: false, params: preset.params });
    }
    return id;
}

// 名前を変える。対象が無ければ何もせず false を返す
export function renamePresetIn<T>(presets: PresetRecord<T>[], id: string, name: string): boolean {
    const preset = presets.find(item => item.id === id);
    if (!preset) return false;
    if (preset.builtin) throw new Error('PRESET_BUILTIN');
    preset.name = name;
    return true;
}

// 削除した後の一覧を返す
export function removePresetFrom<T>(presets: PresetRecord<T>[], id: string): PresetRecord<T>[] {
    if (presets.some(item => item.id === id && item.builtin)) throw new Error('PRESET_BUILTIN');
    return presets.filter(item => item.id !== id);
}
