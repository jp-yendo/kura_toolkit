import fs from 'fs';
import path from 'path';
import { probeSize } from './downloader';
import { writeJsonFile } from './json-file';
import { libraryPaths, modelPaths } from './paths';
import { getWorker } from './python-worker';
import { componentSpec, SEPARATOR_MODEL_DIR, separatorItemId, type SpecFile } from './spec';
import type { SeparationArch, SeparationCategory } from '../../../shared/voice/types';

// 分離モデルの一覧。audio-separator が提供する一覧から取得し、ライブラリ内に保存して使う。
// 一覧の取得にはパッケージ一式 (audio-separator) が必要なため、導入後に作成する。
// 一覧はファイルごとに取得元の候補 (UVR の配布場所と audio-separator の配布場所) を持ち、ファイルは候補のうち
// 1 か所にだけある。ファイルが実際にある URL をファイルごとに一度だけ調べて大きさと一緒に保存し、
// 取得はその URL からだけ行う。

type SeparatorModelEntry = {
    filename: string;
    name: string;
    arch: SeparationArch;
    category: SeparationCategory;
    stems: string[];
    targetStem: string | null;
    sdr: Record<string, number | null>;
    // 取得するファイルと、その取得元の候補
    files: { name: string; urls: string[] }[];
};

type SeparatorPresetEntry = {
    id: string;
    name: string;
    description: string;
    models: string[];
    algorithm: string;
    category: SeparationCategory;
};

type ModelListCache = {
    componentVersion: string;
    models: SeparatorModelEntry[];
    presets: SeparatorPresetEntry[];
};

// ファイルの取得元 (候補のうちファイルが実際にある URL) と、その大きさ
type FileSource = { url: string; size: number };

// 一覧と取得元は導入したパッケージ一式から得る情報のため、audio-separator のライブラリのディレクトリに置く
function listCachePath(): string {
    return path.join(libraryPaths().library('separator'), 'model-list.json');
}

function sourceCachePath(): string {
    return path.join(libraryPaths().library('separator'), 'model-sources.json');
}

let cachedList: ModelListCache | null = null;
// ファイル名ごとの取得元 (調べられたものだけ。問い合わせに失敗したファイルは記録せず、次の機会に調べ直す)
let sourceCache: Record<string, FileSource | undefined> | null = null;
// 取得元の候補のどこにも無かったファイル。アプリを起動している間だけ覚え、次に起動したときに調べ直す
const notFound = new Set<string>();

// 一覧の作り方 (分離の種類の判定など) を変えたら上げる。版が違う一覧は作り直す
const LIST_FORMAT = 3;

function listCacheVersion(): string {
    return `${componentSpec('separator').version}+list${LIST_FORMAT}`;
}

export function readSeparatorModelList(): ModelListCache | null {
    if (cachedList) return cachedList;
    try {
        const data = JSON.parse(fs.readFileSync(listCachePath(), 'utf-8')) as ModelListCache;
        if (data.componentVersion !== listCacheVersion()) return null;
        cachedList = data;
        return data;
    } catch {
        return null;
    }
}

// 保存した一覧と取得元を読み直させる (パッケージ一式の導入・削除と、ライブラリの移動の後)
export function forgetSeparatorModelList(): void {
    cachedList = null;
    sourceCache = null;
    notFound.clear();
}

// パッケージ一式の Python から一覧を取得して保存する
export async function refreshSeparatorModelList(): Promise<ModelListCache> {
    const worker = getWorker('separator');
    const result = await worker.request<{ models: SeparatorModelEntry[]; presets: SeparatorPresetEntry[] }>(
        'list_models',
        { modelDir: modelPaths().group('separator') }
    );
    const data: ModelListCache = { componentVersion: listCacheVersion(), ...result };
    writeJsonFile(listCachePath(), data, { pretty: false });
    cachedList = data;
    return data;
}

export function separatorModelInstalled(entry: SeparatorModelEntry): boolean {
    const dir = modelPaths().group('separator');
    return entry.files.every(file => fs.existsSync(path.join(dir, file.name)));
}

export function separatorModelByItemId(itemId: string): SeparatorModelEntry | undefined {
    return readSeparatorModelList()?.models.find(model => separatorItemId(model.filename) === itemId);
}

// --- 取得元 (候補のうちファイルが実際にある URL) と大きさ ---

// 保存した取得元を読む。無い・壊れている場合は空として扱い、調べ直す (問い合わせの結果を保存しただけのもののため)
function readSourceCache(): Record<string, FileSource | undefined> {
    if (sourceCache) return sourceCache;
    try {
        sourceCache = JSON.parse(fs.readFileSync(sourceCachePath(), 'utf-8')) as Record<string, FileSource>;
    } catch {
        sourceCache = {};
    }
    return sourceCache;
}

function saveSourceCache(cache: Record<string, FileSource | undefined>): void {
    writeJsonFile(sourceCachePath(), cache, { pretty: false });
}

// ファイルがある取得元を候補から探す (ファイルは候補のうち 1 か所にだけある)。どこにも無ければ null。
// 問い合わせに失敗した場合は、ファイルの有無が分からないためエラーにする
async function locateFile(urls: string[], signal?: AbortSignal): Promise<FileSource | null> {
    for (const url of urls) {
        const size = await probeSize(url, signal);
        if (size !== null) return { url, size };
    }
    return null;
}

// モデルの取得元を調べた結果 (ダウンロード画面の表示用)
export type SeparatorModelSource = {
    // 取得元の候補のどこにも無いファイルがある (このモデルは取得できない)
    notFound: boolean;
    // ファイルの大きさの合計。取得元がまだ分からないファイルがあれば null
    sizeBytes: number | null;
    // 先頭のファイルの取得元。まだ分からなければ null
    url: string | null;
};

export function separatorModelSource(entry: SeparatorModelEntry): SeparatorModelSource {
    const cache = readSourceCache();
    const sources = entry.files.map(file => cache[file.name]);
    let sizeBytes: number | null = 0;
    for (const source of sources) {
        sizeBytes = source === undefined || sizeBytes === null ? null : sizeBytes + source.size;
    }
    const first = sources[0];
    return {
        notFound: entry.files.some(file => notFound.has(file.name)),
        sizeBytes,
        url: first === undefined ? null : first.url,
    };
}

// モデルのファイルを、取得元 (ファイルが実際にある URL) と大きさを付けて返す。取得元がまだ分からないファイルは
// ここで調べて保存する。候補のどこにも無いファイルがあれば取得できないため SEPARATOR_MODEL_NOT_FOUND で失敗させる
export async function resolveSeparatorModelFiles(entry: SeparatorModelEntry, signal: AbortSignal): Promise<SpecFile[]> {
    const cache = readSourceCache();
    const files: SpecFile[] = [];
    for (const file of entry.files) {
        let source = cache[file.name];
        if (source === undefined) {
            const located = await locateFile(file.urls, signal);
            if (located === null) {
                notFound.add(file.name);
                throw new Error(`SEPARATOR_MODEL_NOT_FOUND: ${file.name}`);
            }
            source = located;
            cache[file.name] = located;
            notFound.delete(file.name);
            saveSourceCache(cache);
        }
        files.push({ url: source.url, size: source.size, dest: `${SEPARATOR_MODEL_DIR}/${file.name}` });
    }
    return files;
}

let probing: Promise<void> | null = null;

// 取得元がまだ分からないファイルを配布元に問い合わせて調べる (同時に 8 件まで)。
// 候補のどこにも無いファイルは取得できないものとして覚え、問い合わせに失敗したファイルは記録せずに次の機会に調べ直す
export function probeSeparatorSizes(): Promise<void> {
    if (probing) return probing;
    const list = readSeparatorModelList();
    if (!list) return Promise.resolve();
    const cache = readSourceCache();
    const pending = new Map<string, string[]>();
    for (const model of list.models) {
        for (const file of model.files) {
            if (cache[file.name] === undefined && !notFound.has(file.name)) pending.set(file.name, file.urls);
        }
    }
    if (pending.size === 0) return Promise.resolve();
    const queue = [...pending.entries()];
    let failed = 0;
    let lastError: unknown = null;
    const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
            const [name, urls] = next;
            try {
                const located = await locateFile(urls);
                if (located === null) notFound.add(name);
                else cache[name] = located;
            } catch (error) {
                failed += 1;
                lastError = error;
            }
        }
    };
    probing = Promise.all(Array.from({ length: 8 }, worker))
        .then(() => {
            saveSourceCache(cache);
            if (failed > 0) console.warn(`could not locate ${failed} separation model files`, lastError);
        })
        .finally(() => {
            probing = null;
        });
    return probing;
}
