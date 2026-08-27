import fs from 'fs';
import os from 'os';
import path from 'path';
import { nativeTheme } from 'electron';
import { getAppRootDir } from '../../shared/constants';
import { SEARCH_THREADS_MAX, SEARCH_THREADS_MIN } from '../../shared/search';
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
    search: {
        // 0 は「未決定」を表す番兵。初回起動時に initializeSearchThreads() が実数値へ置き換える
        threads: 0,
    },
    audioNormalizer: {
        outputDir: '',
        targetLufs: -13,
        sampleRate: 44100,
        bitrateMode: 'cbr',
        bitrate: 160,
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

// 初回起動時に決める既定値の上限。論理コア数の半分まで、かつこの値を超えない。
// 実測ではスレッド数を増やしても 8 前後で頭打ちになるため、既定はこの程度で十分効果が出る
const SEARCH_THREADS_INITIAL_MAX = 4;

// 設定がまだ無い (未決定の) 起動時にだけ、探索スレッド数の既定値を決めて保存する。
// 既に有効な値が入っている場合は何もしない (ユーザーの指定を上書きしない)
export function initializeSearchThreads(): void {
    const current = getSettings().search.threads;
    if (current >= SEARCH_THREADS_MIN) return;
    const threads = Math.max(
        SEARCH_THREADS_MIN,
        Math.min(SEARCH_THREADS_INITIAL_MAX, Math.floor(os.availableParallelism() / 2))
    );
    updateSettings({ search: { threads } });
}

// 実行時に使う探索スレッド数。起動時初期化の上限 (4) はここでは適用しない
export function resolveSearchThreads(): number {
    const threads = getSettings().search.threads;
    if (!Number.isFinite(threads)) return SEARCH_THREADS_MIN;
    return Math.max(SEARCH_THREADS_MIN, Math.min(SEARCH_THREADS_MAX, Math.floor(threads)));
}
