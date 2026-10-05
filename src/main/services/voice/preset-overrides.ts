import fs from 'fs';
import path from 'path';
import { readJsonFile, writeJsonFile } from './json-file';
import { modelPaths } from './paths';
import type { VoiceLanguage } from '../../../shared/voice/languages';

// 読み上げのプリセット (JVNV) の名前と言語の変更の記録 (<モデルディレクトリ>/audio/tts/voices/preset-overrides.json)。
// プリセットはダウンロード物のため、変更はプリセットのファイルとは別にここへ記録する。
// どのプリセットも変更していない間はファイルが無い。
// 声のモデルの管理 (voice-models.ts) とライブラリの削除 (library.ts) の両方が使うため、独立したファイルに置く

export type PresetOverride = { name?: string; languages?: VoiceLanguage[] };

const PRESET_OVERRIDES_FILE = 'preset-overrides.json';

function overridesPath(): string {
    return path.join(modelPaths().voices('tts'), PRESET_OVERRIDES_FILE);
}

// 記録を読む。読めない・解析できない・オブジェクトでない場合は DATA_FILE_CORRUPT で失敗させる
export function readPresetOverrides(): Record<string, PresetOverride> {
    const file = overridesPath();
    const data = readJsonFile<unknown>(file);
    // readJsonFile はファイルが無い場合と中身が null の場合の両方で null を返すため、ファイルの有無で分ける
    if (data === null && !fs.existsSync(file)) return {};
    if (typeof data !== 'object' || data === null) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    return data as Record<string, PresetOverride>;
}

export function writePresetOverrides(data: Record<string, PresetOverride>): void {
    writeJsonFile(overridesPath(), data);
}

// プリセットを削除したときに、そのプリセットの変更の記録を消す (取得し直したときに元の名前と言語で使うため)
export function clearPresetOverride(name: string): void {
    const overrides = readPresetOverrides();
    if (!(name in overrides)) return;
    delete overrides[name];
    writePresetOverrides(overrides);
}
