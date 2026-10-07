import fs from 'fs';
import os from 'os';
import path from 'path';
import { nativeTheme } from 'electron';
import { getAppRootDir } from '../../shared/constants';
import { SEARCH_THREADS_MIN } from '../../shared/search';
import { AUDIO_ENCODE_DEFAULTS } from '../../shared/audio-format';
import {
    AUDIO_NORMALIZER_DEFAULT_LUFS,
    type AppSettings,
    type DeepPartial,
    type SettingsLoadError,
    type SettingsUpdateResult,
} from '../../shared/types';

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
    storage: {
        libraryDir: '',
        modelDir: '',
        workDir: '',
        cacheDir: '',
        cacheRetentionDays: 30,
    },
    audioNormalizer: {
        ...AUDIO_ENCODE_DEFAULTS,
        outputDir: '',
        targetLufs: AUDIO_NORMALIZER_DEFAULT_LUFS,
        outputFormat: 'mp3',
    },
    cleanup: {
        customDirs: [],
        selectedTargets: [],
        selectedRoots: [],
    },
    voice: {
        export: {
            ...AUDIO_ENCODE_DEFAULTS,
            format: 'mp3',
        },
        symbolReadings: {
            ja: null,
            en: null,
            zh: null,
        },
        updatePromptVersion: '',
    },
};

let cachedSettings: AppSettings | null = null;
// 設定ファイルを読み込めなかったときの内容。利用者が既定の設定で続けることを選ぶまで、ファイルを上書きしない
let loadError: SettingsLoadError | null = null;

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

// 設定ファイルの内容。ファイルが無い (初回の起動) 場合は空。読み込めない場合は理由を記録し、空として扱う
function readSettingsFile(): unknown {
    const filePath = getSettingsFilePath();
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!isPlainObject(parsed)) throw new Error('the settings file does not contain an object');
        return parsed;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        loadError = { path: filePath, message: error instanceof Error ? error.message : String(error) };
        console.error(`failed to load settings from ${filePath}: ${loadError.message}`);
        return {};
    }
}

// 設定を読み込む (初回のみファイルアクセス、以後キャッシュ)
export function getSettings(): AppSettings {
    if (cachedSettings) return cachedSettings;
    cachedSettings = deepMerge(DEFAULT_SETTINGS, readSettingsFile());
    return cachedSettings;
}

// 設定ファイルを読み込めなかった場合の内容 (読み込めた場合は null)
export function getSettingsLoadError(): SettingsLoadError | null {
    getSettings();
    return loadError;
}

// 年月日-時分秒 (ファイル名に使う)
function timestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

// 読み込めなかった設定ファイルを同じ場所に別の名前で残し、今の設定 (既定の設定) を保存する。残した場所を返す
export function resetBrokenSettings(): string {
    if (!loadError) throw new Error('SETTINGS_NOT_BROKEN');
    const filePath = getSettingsFilePath();
    const kept = path.join(path.dirname(filePath), `settings.broken-${timestamp()}.json`);
    fs.renameSync(filePath, kept);
    loadError = null;
    writeSettings(getSettings());
    return kept;
}

// 設定をアトミックに書き込む (一時ファイルに書いて rename)
function writeSettings(settings: AppSettings): void {
    // 読み込めなかった設定ファイルは、利用者が既定の設定で続けることを選ぶまで上書きしない
    if (loadError) throw new Error('SETTINGS_FILE_UNREADABLE');
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

// 設定を部分更新して保存し、保存できた場合だけメモリ上の設定を更新する。保存できなければ SETTINGS_SAVE_FAILED で失敗させる。
// 保存場所の設定に使う (保存できないまま起動中だけ新しい場所を使うと、次の起動で元の場所を使い、
// 起動中に新しい場所へ置いたものを見失うため)
export function saveSettings(patch: DeepPartial<AppSettings>): AppSettings {
    const next = deepMerge(getSettings(), patch);
    try {
        writeSettings(next);
    } catch (error) {
        const saveError = error instanceof Error ? error.message : String(error);
        console.error(`failed to save settings to ${getSettingsFilePath()}: ${saveError}`);
        throw new Error(`SETTINGS_SAVE_FAILED: ${saveError}`, { cause: error });
    }
    cachedSettings = next;
    return next;
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
    return Math.max(SEARCH_THREADS_MIN, Math.floor(threads));
}
