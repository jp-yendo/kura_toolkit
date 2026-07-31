import fs from 'fs';
import path from 'path';
import { nativeTheme } from 'electron';
import { getAppRootDir } from '../../shared/constants';
import type { AppSettings, DeepPartial, SettingsUpdateResult } from '../../shared/types';

// 設定ファイルのパス
const SETTINGS_FILE = 'settings.json';

// 既定の設定値 (欠損キーはここから補完される)
export const DEFAULT_SETTINGS: AppSettings = {
    version: 1,
    app: {
        theme: 'system',
        language: 'ja',
    },
    ffmpeg: {
        ffmpegPath: '',
        ffprobePath: '',
    },
    audioNormalizer: {
        outputDir: '',
        targetLufs: -13,
        sampleRate: 44100,
        bitrateMode: 'cbr',
        bitrate: 160,
    },
    chapterCut: {
        outputDir: '',
        accurate: false,
    },
    vectorizer: {
        colorMode: 'color',
        hierarchical: 'stacked',
        filterSpeckle: 4,
        colorPrecision: 6,
        layerDifference: 16,
        mode: 'spline',
        cornerThreshold: 60,
        lengthThreshold: 4.0,
        spliceThreshold: 45,
    },
    cleanup: {
        customDirs: [],
        selectedTargets: [],
        selectedRoots: [],
    },
};

let cachedSettings: AppSettings | null = null;

function getSettingsFilePath(): string {
    return path.join(getAppRootDir(), SETTINGS_FILE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 既定値をベースに保存値を再帰マージする (配列は丸ごと置換)
function deepMerge<T>(base: T, patch: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(patch)) {
        return (patch === undefined ? base : patch) as T;
    }
    const result: Record<string, unknown> = { ...base };
    for (const key of Object.keys(patch)) {
        const baseValue = (base as Record<string, unknown>)[key];
        const patchValue = patch[key];
        if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
            result[key] = deepMerge(baseValue, patchValue);
        } else if (patchValue !== undefined) {
            result[key] = patchValue;
        }
    }
    return result as T;
}

// 設定を読み込む (初回のみファイルアクセス、以後キャッシュ)
export function getSettings(): AppSettings {
    if (cachedSettings) return cachedSettings;
    let loaded: unknown = {};
    try {
        const raw = fs.readFileSync(getSettingsFilePath(), 'utf-8');
        loaded = JSON.parse(raw);
    } catch {
        // ファイルが無い/壊れている場合は既定値を使用
        loaded = {};
    }
    cachedSettings = deepMerge(DEFAULT_SETTINGS, loaded);
    return cachedSettings;
}

// 設定をアトミックに書き込む (一時ファイルに書いて rename)
function writeSettings(settings: AppSettings): void {
    const dir = getAppRootDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getSettingsFilePath();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

// 設定を部分更新して保存する。
// 保存先の ~/.kura_toolkit はホーム直下のため、macOS のフルディスクアクセスなど
// 追加の権限は不要だが、ディスク容量不足や権限の問題で書き込みに失敗することはある。
// その場合でもメモリ上の設定は更新して起動中の動作は継続させ、失敗を呼び出し元へ返す。
export function updateSettings(patch: DeepPartial<AppSettings>): SettingsUpdateResult {
    const current = getSettings();
    const next = deepMerge(current, patch);
    cachedSettings = next;
    try {
        writeSettings(next);
        return { settings: next, saveError: null };
    } catch (error) {
        const saveError = error instanceof Error ? error.message : String(error);
        console.error(`failed to save settings to ${getSettingsFilePath()}: ${saveError}`);
        return { settings: next, saveError };
    }
}

// 保存済みテーマを nativeTheme に反映する (起動時に呼ぶ)
export function applySavedTheme(): void {
    nativeTheme.themeSource = getSettings().app.theme;
}
