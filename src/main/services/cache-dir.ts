import fs from 'fs';
import path from 'path';
import { CACHE_RETENTION_DAYS_DEFAULT, CACHE_RETENTION_DAYS_MIN } from '../../shared/cache';
import { getSettings } from './settings';
import { getCacheDir } from './storage';
import { writeJsonFile } from './voice/json-file';

// キャッシュディレクトリ (消しても作り直せるもの) の管理。
// - 中はライブラリごとのディレクトリに分ける。ライブラリが自分で作るキャッシュ (numba・matplotlib など) は、
//   そのライブラリのディレクトリの下に書かせ、中身はライブラリに任せる
// - 古いものは、使うたびに消すのではなく、起動時にまとめて消す (removeExpiredCache)。ファイルごとに、
//   アプリが読み書きするものは利用記録 (cache.json) の最終利用日時で、ライブラリが作るもの (使ったことをアプリが
//   知れないもの) は最終更新日時 (作った・作り直した日時) で判断し、保持期間を過ぎたものだけを消す

const INDEX_FILE = 'cache.json';
// 保存場所の移動で、先にコピーする一時フォルダの名前の接頭辞 (storage-merge.ts と同じ。移動が片付けるため触らない)
const STAGING_PREFIX = '.kura-move-';
const DAY_MS = 24 * 60 * 60 * 1000;

// 利用記録。キーはキャッシュディレクトリからの相対パス (/ 区切り)、値は最終利用日時 (ミリ秒)
type CacheIndex = { version: 1; entries: Record<string, number> };

// キャッシュディレクトリの中の場所
export function cachePath(...parts: string[]): string {
    return path.join(getCacheDir(), ...parts);
}

// ライブラリごとのキャッシュの場所
export function libraryCacheDir(libraryName: string): string {
    return cachePath(libraryName);
}

function indexKey(root: string, file: string): string | null {
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join('/');
}

// 利用記録を読む。無い・壊れている場合は空として扱う (消しても作り直せるものの記録のため)
function readIndex(root: string): CacheIndex {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(root, INDEX_FILE), 'utf-8')) as CacheIndex;
        if (data && typeof data.entries === 'object' && data.entries !== null)
            return { version: 1, entries: data.entries };
    } catch {
        // 無い・壊れている
    }
    return { version: 1, entries: {} };
}

// 利用記録を更新して書く (読み直してから変えるため、ほかの更新を上書きしない)
function updateIndex(root: string, change: (entries: Record<string, number>) => void): void {
    const index = readIndex(root);
    change(index.entries);
    writeJsonFile(path.join(root, INDEX_FILE), index, { pretty: false });
}

// アプリが読み書きするキャッシュのファイルを使ったことを記録する。記録できなくても処理は続ける
// (記録が無いものは最終更新日時で判断されるだけのため)
export function touchCacheFile(file: string): void {
    const root = getCacheDir();
    const key = indexKey(root, file);
    if (key === null) return;
    try {
        updateIndex(root, entries => {
            entries[key] = Date.now();
        });
    } catch (error) {
        console.warn(`failed to record the use of the cache ${file}`, error);
    }
}

export function cacheRetentionDays(): number {
    const days = Number(getSettings().storage.cacheRetentionDays);
    if (!Number.isFinite(days)) return CACHE_RETENTION_DAYS_DEFAULT;
    return Math.max(CACHE_RETENTION_DAYS_MIN, Math.round(days));
}

// 保持期間を過ぎたキャッシュを消す (起動時に呼ぶ。完了は待たない)。消せなかったもの (使用中など) は
// エラーにせず次回に回す。中身が空になったフォルダも消す
export async function removeExpiredCache(): Promise<void> {
    const root = getCacheDir();
    if (!fs.existsSync(root)) return;
    const cutoff = Date.now() - cacheRetentionDays() * DAY_MS;
    const entries = readIndex(root).entries;
    const removed: string[] = [];
    const seen = new Set<string>();

    // 中身が空になったら true を返す
    const sweep = async (dir: string): Promise<boolean> => {
        let items: fs.Dirent[];
        try {
            items = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
            return false;
        }
        let remaining = items.length;
        for (const item of items) {
            const full = path.join(dir, item.name);
            if (dir === root && (item.name === INDEX_FILE || item.name.startsWith(`${INDEX_FILE}.`))) continue;
            if (dir === root && item.name.startsWith(STAGING_PREFIX)) continue;
            // シンボリックリンクは辿らず、リンクそのものを 1 つのファイルとして扱う
            if (item.isDirectory()) {
                if ((await sweep(full)) && (await removeQuietly(full))) remaining -= 1;
                continue;
            }
            const key = indexKey(root, full);
            if (key === null) continue;
            seen.add(key);
            let lastUsed = entries[key];
            if (lastUsed === undefined) {
                try {
                    lastUsed = (await fs.promises.lstat(full)).mtimeMs;
                } catch {
                    continue;
                }
            }
            if (lastUsed >= cutoff) continue;
            if (await removeQuietly(full)) {
                removed.push(key);
                remaining -= 1;
            }
        }
        return remaining === 0;
    };

    try {
        await sweep(root);
        // 消したファイルと、無くなったファイルの記録を除く
        const stale = Object.keys(entries).filter(key => !seen.has(key));
        if (removed.length > 0 || stale.length > 0) {
            updateIndex(root, current => {
                for (const key of [...removed, ...stale]) delete current[key];
            });
        }
    } catch (error) {
        console.warn('failed to remove expired cache', error);
    }
}

// ファイル 1 つか、空のフォルダを消す。消せなければ false
async function removeQuietly(target: string): Promise<boolean> {
    try {
        if ((await fs.promises.lstat(target)).isDirectory()) {
            await fs.promises.rmdir(target);
        } else {
            await fs.promises.unlink(target);
        }
        return true;
    } catch {
        return false;
    }
}
