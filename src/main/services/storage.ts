import os from 'os';
import path from 'path';
import { getAppRootDir } from '../../shared/constants';
import { getSettings } from './settings';
import type { StorageInfo, StorageKind } from '../../shared/types';

// アプリ全体で使う 3 つの保存場所 (設定画面の「保存場所」)。
// 利用者が選んだフォルダを、そのままその保存場所として使う。
// - ライブラリディレクトリ: 外部のライブラリ (Python 本体、各ライブラリの仮想環境・ソース一式など)。
//   中はライブラリごとのディレクトリに分け、ライブラリが増えてもこの下に追加する
// - モデルディレクトリ: ダウンロードしたモデルと、利用者が学習・取り込みしたモデル。
//   中は分類 (audio など) の階層を挟み、ほかの種類のモデルが増えてもこの下に追加する
// - 作業ディレクトリ: 全機能の一時ファイル (work-dir.ts)。既定は OS の一時ディレクトリの中のこのアプリ用のフォルダ
// 設定が空の場合は既定の場所を使う。既定の場所は設定ファイルに書き込まず、画面には実際に使う場所を示す。

export function hasNonAscii(text: string): boolean {
    return /[^\x20-\x7e]/.test(text);
}

export function defaultStorageDir(kind: StorageKind): string {
    if (kind === 'library') return path.join(getAppRootDir(), 'libraries');
    if (kind === 'model') return path.join(getAppRootDir(), 'models');
    return path.join(os.tmpdir(), 'kura_toolkit');
}

const SETTING_KEYS = { library: 'libraryDir', model: 'modelDir', work: 'workDir' } as const;

// 実際に使う場所 (設定が空なら既定の場所)
export function getStorageDir(kind: StorageKind): string {
    const configured = getSettings().storage[SETTING_KEYS[kind]].trim();
    return configured ? path.resolve(configured) : defaultStorageDir(kind);
}

export function getLibraryDir(): string {
    return getStorageDir('library');
}

export function getModelDir(): string {
    return getStorageDir('model');
}

export function getWorkDir(): string {
    return getStorageDir('work');
}

const STORAGE_KINDS: StorageKind[] = ['library', 'model', 'work'];

// 設定画面の表示用の状態
export function getStorageInfo(): StorageInfo {
    const dirs = {} as Record<StorageKind, string>;
    const defaults = {} as Record<StorageKind, string>;
    const nonAscii = {} as Record<StorageKind, boolean>;
    for (const kind of STORAGE_KINDS) {
        dirs[kind] = getStorageDir(kind);
        defaults[kind] = defaultStorageDir(kind);
        nonAscii[kind] = process.platform === 'win32' && hasNonAscii(dirs[kind]);
    }
    return { dirs, defaults, nonAscii };
}

// 2 つのパスが同じ場所か (Windows と macOS は大文字小文字を区別しない)
export function isSamePath(a: string, b: string): boolean {
    const left = path.resolve(a);
    const right = path.resolve(b);
    return process.platform === 'win32' || process.platform === 'darwin'
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}

// 2 つの場所が同じか、一方がもう一方の中にあるか (保存場所どうしを重ねないための確認)
export function isSameOrNested(a: string, b: string): boolean {
    if (isSamePath(a, b)) return true;
    const left = path.resolve(a);
    const right = path.resolve(b);
    const inside = (child: string, parent: string) => {
        const relative = path.relative(parent, child);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    };
    return inside(left, right) || inside(right, left);
}
