import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { emitJobEvent, onJobCancel } from '../job-manager';
import { readJsonFile, writeJsonFile } from './json-file';
import { libraryPaths } from './paths';
import { COMPONENT_SPECS } from './spec';
import { isFileBusyError, renameWithRetry } from '../../utils/rename-retry';
import type {
    StorageMoveDecisions,
    StorageMovePlan,
    StorageUnitConflict,
    StorageUnitStats,
} from '../../../shared/types';
import type { VoiceComponentId, VoiceModelFeature } from '../../../shared/voice/types';

// 保存場所 (ライブラリ・モデルディレクトリ) の移動。移動先に中身がある場合は、まとまり (単位) ごとにマージする。
// - 単位: モデルディレクトリはダウンロードしたモデル (取得記録の項目ごと)・分離のパッケージ一式のモデル設定・
//   声のモデル・学習セット。ライブラリディレクトリは Python 本体とライブラリ (仮想環境の単位) ごと。
//   モデルのファイルの一部などの単位では扱わない
// - 複数のモデルが共有するファイル (同じ系統の分離モデルが共有する設定ファイルなど。配布元の同じファイル) は
//   どの単位にも入れず、移動先に無い場合だけ移す (上書きでモデルを消すときも消さない)
// - 移動元にだけある単位は移す。両方にある単位は、利用者が選んだとおりに、上書きする (移動先の単位を削除してから
//   移す) か、上書きしない (移動先の単位を使う) かにする。移動元は最後にまとめて削除する
// - どの単位にも属さないファイルは、移動先に無いものだけを移す
// 別のドライブへは、まず移動先の中の一時フォルダへコピーし (中断・失敗したら一時フォルダを消して元のまま)、
// コピーし終えてから単位ごとに置き換える。同じドライブでは名前の変更で移す

type MovableStorage = 'library' | 'model';

type Unit = Omit<StorageUnitConflict, 'source' | 'target'> & {
    // 単位に属するファイル・フォルダ (保存場所からの相対パス)
    paths: string[];
};

// 移動先に置ける、それぞれの保存場所の直下の名前 (これ以外のものがある移動先は、ほかのファイルと混ぜないために選べない)
const KNOWN_TOP_LEVEL: Record<MovableStorage, string[]> = {
    model: ['manifest.json', 'audio'],
    library: ['manifest.json', 'python', 'python.tar.gz', 'pip-cache', 'audio-separator', 'applio', 'style-bert-vits2'],
};

// 移さずに移動元と一緒に消すもの (取得の再試行のためだけに残しているもの)
const NOT_TRANSFERRED: Record<MovableStorage, string[]> = {
    model: [],
    library: ['pip-cache', 'python.tar.gz'],
};

// 別のドライブへの移動で、先にコピーする一時フォルダの名前の接頭辞
const STAGING_PREFIX = '.kura-move-';
// 同じドライブかを確かめるために、名前の変更を試すファイルの名前の接頭辞
const PROBE_PREFIX = '.kura-move-probe-';

const COMPONENTS: VoiceComponentId[] = ['separator', 'converter', 'tts'];
const VOICE_FEATURES: VoiceModelFeature[] = ['converter', 'tts'];
const MODEL_GROUP: Record<VoiceModelFeature, string> = { converter: 'audio/conversion', tts: 'audio/tts' };
const READY_PREFIX = 'model:tts:ready:';
const READY_OVERRIDES = 'audio/tts/voices/ready-model-overrides.json';

type ModelManifestFile = { version: 1; models: Record<string, { files: string[] }> };
type LibraryManifestFile = { version: 1; python: unknown; components: Record<string, unknown> };

// Windows と macOS はファイル名の大文字と小文字を区別しない
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function sameName(a: string, b: string): boolean {
    return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// 移動先にあっても、ほかのファイルとはみなさないもの。OS がフォルダやドライブを開いたときに作る情報
// (macOS の Finder の .DS_Store・._*、macOS のボリュームの .Spotlight-V100・.fseventsd・.Trashes・.TemporaryItems、
// Windows のエクスプローラーの Thumbs.db・desktop.ini) と、前回の移動が途中で終わって残った一時フォルダ
const IGNORABLE_NAMES = [
    '.DS_Store',
    '.Spotlight-V100',
    '.fseventsd',
    '.Trashes',
    '.TemporaryItems',
    'Thumbs.db',
    'desktop.ini',
];

function isIgnorableName(name: string): boolean {
    return (
        IGNORABLE_NAMES.some(item => sameName(item, name)) || name.startsWith('._') || name.startsWith(STAGING_PREFIX)
    );
}

// 取得記録の形を確かめる (別の種類の保存場所の記録や、壊れた記録で中身を動かさないため)
function isModelManifest(data: unknown): data is ModelManifestFile {
    const models = (data as ModelManifestFile | null)?.models;
    return (
        !!models &&
        typeof models === 'object' &&
        Object.values(models).every(
            entry => Array.isArray(entry?.files) && entry.files.every(file => typeof file === 'string')
        )
    );
}

function isLibraryManifest(data: unknown): data is LibraryManifestFile {
    const components = (data as LibraryManifestFile | null)?.components;
    return !!components && typeof components === 'object';
}

function readModelManifest(root: string): ModelManifestFile {
    const file = path.join(root, 'manifest.json');
    const data = readJsonFile<unknown>(file);
    if (data === null) return { version: 1, models: {} };
    if (!isModelManifest(data)) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    return data;
}

function readLibraryManifest(root: string): LibraryManifestFile {
    const file = path.join(root, 'manifest.json');
    const data = readJsonFile<unknown>(file);
    if (data === null) return { version: 1, python: null, components: {} };
    if (!isLibraryManifest(data)) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    return data;
}

function readOverrides(root: string): Record<string, unknown> | null {
    const file = path.join(root, READY_OVERRIDES);
    const data = readJsonFile<unknown>(file);
    if (data === null) return null;
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    return data as Record<string, unknown>;
}

// 移動先に中身がある場合、同じ種類の保存場所であることを確かめる
export function checkMergeTarget(kind: MovableStorage, newRoot: string): void {
    if (!fs.existsSync(newRoot)) return;
    const unknown = fs
        .readdirSync(newRoot)
        .filter(name => !KNOWN_TOP_LEVEL[kind].some(item => sameName(item, name)) && !isIgnorableName(name));
    if (unknown.length > 0) throw new Error(`STORAGE_TARGET_NOT_EMPTY: ${newRoot}`);
    // 記録が別の種類の保存場所のもの (モデルディレクトリにライブラリの記録など) なら選べない
    const data = readJsonFile<unknown>(path.join(newRoot, 'manifest.json'));
    if (data !== null && !(kind === 'model' ? isModelManifest(data) : isLibraryManifest(data))) {
        throw new Error(`STORAGE_TARGET_NOT_EMPTY: ${newRoot}`);
    }
}

// 保存場所の中に収まる相対パスにする。絶対パス・空・保存場所の外を指すもの (別の端末から来た記録などに
// 含まれていても) は扱わない (null)
function safeRelative(relative: string): string | null {
    if (!relative || path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) return null;
    const normalized = path.normalize(relative.split('/').join(path.sep));
    if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) return null;
    return normalized;
}

// --- 単位の一覧 ---

function listDirs(dir: string): string[] {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

// 利用者が付けた名前。記録が読めない場合は ID を名前にする (壊れた記録が 1 つあっても移動できるようにするため)
function recordName(file: string, id: string): string {
    try {
        const data = readJsonFile<{ name?: unknown }>(file);
        return typeof data?.name === 'string' && data.name ? data.name : id;
    } catch {
        return id;
    }
}

// 取得記録で、複数のモデルが共有するファイル (相対パス)
function sharedFilesOf(manifest: ModelManifestFile): Set<string> {
    const count = new Map<string, number>();
    for (const entry of Object.values(manifest.models)) {
        for (const file of new Set(entry.files.map(safeRelative).filter((item): item is string => item !== null))) {
            count.set(file, (count.get(file) ?? 0) + 1);
        }
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([file]) => file));
}

function modelUnits(root: string, shared: Set<string>): Unit[] {
    const units: Unit[] = [];
    for (const [id, entry] of Object.entries(readModelManifest(root).models)) {
        const paths = [...new Set(entry.files.map(safeRelative))].filter(
            (file): file is string => file !== null && !shared.has(file)
        );
        units.push({ key: id, kind: 'download', itemIds: [id], paths });
    }
    // 分離のパッケージ一式と一緒に取得し、モデルディレクトリに置くモデル設定
    const separatorFiles = (COMPONENT_SPECS.find(spec => spec.id === 'separator')?.files ?? [])
        .map(file => safeRelative(file.dest))
        .filter((file): file is string => file !== null);
    if (separatorFiles.some(file => fs.existsSync(path.join(root, file)))) {
        units.push({
            key: 'componentFiles:separator',
            kind: 'componentFiles',
            itemIds: ['component:separator'],
            paths: separatorFiles,
        });
    }
    for (const feature of VOICE_FEATURES) {
        const group = path.join(...MODEL_GROUP[feature].split('/'));
        for (const id of listDirs(path.join(root, group, 'voices'))) {
            const dir = path.join(group, 'voices', id);
            units.push({
                key: `voice:${feature}:${id}`,
                kind: 'voice',
                feature,
                name: recordName(path.join(root, dir, 'meta.json'), id),
                paths: [dir],
            });
        }
        for (const id of listDirs(path.join(root, group, 'training-sets'))) {
            const dir = path.join(group, 'training-sets', id);
            units.push({
                key: `trainingSet:${feature}:${id}`,
                kind: 'trainingSet',
                feature,
                name: recordName(path.join(root, dir, 'set.json'), id),
                paths: [dir],
            });
        }
    }
    return units;
}

function libraryUnits(root: string): Unit[] {
    const units: Unit[] = [];
    const manifest = readLibraryManifest(root);
    if (manifest.python || fs.existsSync(path.join(root, 'python'))) {
        units.push({ key: 'python', kind: 'python', itemIds: ['python'], paths: ['python'] });
    }
    for (const component of COMPONENTS) {
        const dir = path.relative(root, libraryPaths(root).library(component));
        if (!fs.existsSync(path.join(root, dir))) continue;
        // 表示名は、そのライブラリを使うパッケージ一式の名前 (取得記録が無いものも含める)
        const itemIds = COMPONENT_SPECS.filter(spec => spec.env === component).map(spec => `component:${spec.id}`);
        units.push({ key: `library:${component}`, kind: 'library', itemIds, paths: [dir] });
    }
    return units;
}

// 両方の場所の取得記録で、複数のモデルが共有するファイル
function sharedFiles(kind: MovableStorage, oldRoot: string, newRoot: string): Set<string> {
    if (kind !== 'model') return new Set();
    const roots = [oldRoot, newRoot].filter(root => fs.existsSync(root));
    return new Set(roots.flatMap(root => [...sharedFilesOf(readModelManifest(root))]));
}

function unitsOf(kind: MovableStorage, root: string, shared: Set<string>): Unit[] {
    if (!fs.existsSync(root)) return [];
    return kind === 'model' ? modelUnits(root, shared) : libraryUnits(root);
}

// --- ファイルの辿り方 ---

type WalkOptions = {
    // 辿る場所の中を指すシンボリックリンクを、リンクのまま渡す (Linux の仮想環境の lib64 -> lib など。
    // リンク先を辿ると、同じ中身を 2 回数えたり写したりするため)
    onInternalLink?: (relative: string, full: string, link: string) => Promise<void>;
};

// ディレクトリの中を辿り、ファイルとディレクトリを root からの相対パスで渡す (ディレクトリは中より先に渡す)。
// シンボリックリンクは、onInternalLink を渡した場合の中を指すものを除き、リンク先 (ファイルの中身・ディレクトリの中)
// として辿る。自分を含む親のディレクトリを指すリンクは際限なく辿ることになるため、STORAGE_LINK_LOOP で失敗させる
async function walkTree(
    root: string,
    onFile: (relative: string, full: string) => Promise<void>,
    onDirectory: (relative: string) => Promise<void> = async () => undefined,
    options: WalkOptions = {}
): Promise<void> {
    const realRoot = await fs.promises.realpath(root);
    const walk = async (relative: string, ancestors: string[]): Promise<void> => {
        for (const entry of await fs.promises.readdir(path.join(root, relative), { withFileTypes: true })) {
            const childRelative = path.join(relative, entry.name);
            const full = path.join(root, childRelative);
            let real: string;
            if (entry.isSymbolicLink()) {
                const link = await fs.promises.readlink(full);
                const resolved = path.resolve(path.dirname(full), link);
                const insideRoot = !path.isAbsolute(link) && !path.relative(root, resolved).startsWith('..');
                if (options.onInternalLink && insideRoot) {
                    await options.onInternalLink(childRelative, full, link);
                    continue;
                }
                if (!(await fs.promises.stat(full)).isDirectory()) {
                    await onFile(childRelative, full);
                    continue;
                }
                real = await fs.promises.realpath(full);
                if (ancestors.includes(real)) throw new Error(`STORAGE_LINK_LOOP: ${full}`);
            } else if (entry.isDirectory()) {
                real = path.join(ancestors[ancestors.length - 1], entry.name);
            } else {
                await onFile(childRelative, full);
                continue;
            }
            await onDirectory(childRelative);
            await walk(childRelative, [...ancestors, real]);
        }
    };
    await walk('', [realRoot]);
}

// ファイル・フォルダ (相対パス) の中のファイル数・合計サイズ・最終更新日時
async function statsOf(root: string, paths: string[]): Promise<StorageUnitStats> {
    const stats: StorageUnitStats = { fileCount: 0, sizeBytes: 0, modifiedAt: null };
    const add = (stat: fs.Stats) => {
        stats.fileCount += 1;
        stats.sizeBytes += stat.size;
        stats.modifiedAt = Math.max(stats.modifiedAt ?? 0, stat.mtimeMs);
    };
    for (const relative of paths) {
        const full = path.join(root, relative);
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(full);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) {
            add(stat);
            continue;
        }
        await walkTree(full, async (_relative, file) => add(await fs.promises.stat(file)), undefined, {
            onInternalLink: async () => undefined,
        });
    }
    return stats;
}

// --- 計画 ---

type Plan = {
    conflicts: Unit[];
    // 移す単位 (移動元にだけあるもの)
    sourceOnly: Unit[];
    // どの単位にも属さず、移動先に無いファイル (相対パス。共有ファイルを含む)
    others: string[];
    targetUnits: Map<string, Unit>;
};

async function collectOthers(kind: MovableStorage, oldRoot: string, newRoot: string, units: Unit[]): Promise<string[]> {
    const claimed = units.flatMap(unit => unit.paths);
    const special = [
        'manifest.json',
        ...NOT_TRANSFERRED[kind],
        ...(kind === 'model' ? [path.join(...READY_OVERRIDES.split('/'))] : []),
    ];
    const within = (relative: string, item: string) => relative === item || relative.startsWith(item + path.sep);
    const others: string[] = [];
    if (!fs.existsSync(oldRoot)) return others;
    const consider = async (relative: string) => {
        // 作りかけ (名前が . で始まるフォルダの中) と、OS が作る情報は移さない
        if (relative.split(path.sep).some(part => part.startsWith('.') || isIgnorableName(part))) return;
        if (special.some(item => within(relative, item)) || claimed.some(item => within(relative, item))) return;
        if (!fs.existsSync(path.join(newRoot, relative))) others.push(relative);
    };
    await walkTree(oldRoot, consider, undefined, { onInternalLink: consider });
    return others;
}

async function buildPlan(kind: MovableStorage, oldRoot: string, newRoot: string): Promise<Plan> {
    const shared = sharedFiles(kind, oldRoot, newRoot);
    const sourceUnits = unitsOf(kind, oldRoot, shared);
    const targetUnits = new Map(unitsOf(kind, newRoot, shared).map(unit => [unit.key, unit]));
    // 移動先に同じ単位として記録が無くても、同じ場所にファイル・フォルダがある (作りかけ・記録の無いものなど)
    // 場合は、両方にあるものとして利用者に選んでもらう (黙って上書きも失敗もさせないため)
    const inTarget = (unit: Unit) =>
        targetUnits.has(unit.key) || unit.paths.some(relative => fs.existsSync(path.join(newRoot, relative)));
    if (kind === 'model') {
        readOverrides(oldRoot);
        readOverrides(newRoot);
    }
    return {
        conflicts: sourceUnits.filter(inTarget),
        sourceOnly: sourceUnits.filter(unit => !inTarget(unit)),
        others: await collectOthers(kind, oldRoot, newRoot, sourceUnits),
        targetUnits,
    };
}

// 移動の前に、両方にある単位 (上書きするかを選ぶもの) と、移す量を求める
export async function planStorageMove(
    kind: MovableStorage,
    oldRoot: string,
    newRoot: string
): Promise<StorageMovePlan> {
    const plan = await buildPlan(kind, oldRoot, newRoot);
    const conflicts: StorageUnitConflict[] = [];
    for (const unit of plan.conflicts) {
        const { paths, ...info } = unit;
        const target = plan.targetUnits.get(unit.key);
        conflicts.push({
            ...info,
            targetName: target?.name,
            source: await statsOf(oldRoot, paths),
            target: await statsOf(newRoot, target?.paths ?? paths),
        });
    }
    const transfer = await statsOf(oldRoot, [...plan.sourceOnly.flatMap(unit => unit.paths), ...plan.others]);
    return { conflicts, transferCount: plan.sourceOnly.length, transferBytes: transfer.sizeBytes };
}

// --- 実行 ---

async function renameStorage(from: string, to: string): Promise<void> {
    try {
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await renameWithRetry(from, to);
    } catch (error) {
        if (isFileBusyError(error)) throw new Error(`STORAGE_IN_USE: ${from}`);
        throw error;
    }
}

// ファイルを 1 つコピーする。大きなファイルでも中断がすぐ効くよう、少しずつ読み書きする。
// 更新日時は元のファイルのものにする (移動の後も、まとまりの最終更新日時で比べられるようにするため)
async function copyFileCancellable(
    source: string,
    target: string,
    signal: AbortSignal,
    onBytes: (bytes: number) => void
): Promise<void> {
    const input = fs.createReadStream(source, { highWaterMark: COPY_CHUNK_BYTES });
    input.on('data', chunk => onBytes(chunk.length));
    await pipeline(input, fs.createWriteStream(target), { signal });
    const stat = await fs.promises.stat(source);
    await fs.promises.utimes(target, stat.atime, stat.mtime);
    // macOS・Linux では実行の権限も元のものにする (Python 本体などの実行ファイルを、写した後も実行できるようにするため)
    if (process.platform !== 'win32') await fs.promises.chmod(target, stat.mode);
}

// ファイル・フォルダ (相対パス) を dest の同じ相対パスへコピーする。中断されたら KURA_CANCELLED で失敗する。
// 写すものの中を指すシンボリックリンク (Linux の仮想環境の lib64 -> lib など) は、同じリンクとして写す
async function copyPaths(
    root: string,
    dest: string,
    paths: string[],
    onBytes: (bytes: number) => void,
    signal: AbortSignal
): Promise<void> {
    const checkCancelled = () => {
        if (signal.aborted) throw new Error('KURA_CANCELLED');
    };
    try {
        for (const relative of paths) {
            const full = path.join(root, relative);
            checkCancelled();
            const stat = await fs.promises.lstat(full);
            await fs.promises.mkdir(path.dirname(path.join(dest, relative)), { recursive: true });
            if (stat.isSymbolicLink()) {
                await fs.promises.symlink(await fs.promises.readlink(full), path.join(dest, relative));
                continue;
            }
            if (!stat.isDirectory()) {
                await copyFileCancellable(full, path.join(dest, relative), signal, onBytes);
                continue;
            }
            await fs.promises.mkdir(path.join(dest, relative), { recursive: true });
            await walkTree(
                full,
                async (child, file) => {
                    checkCancelled();
                    await copyFileCancellable(file, path.join(dest, relative, child), signal, onBytes);
                },
                async child => {
                    checkCancelled();
                    await fs.promises.mkdir(path.join(dest, relative, child));
                },
                {
                    onInternalLink: async (child, _file, link) => {
                        checkCancelled();
                        await fs.promises.symlink(link, path.join(dest, relative, child));
                    },
                }
            );
        }
    } catch (error) {
        if (signal.aborted) throw new Error('KURA_CANCELLED');
        throw error;
    }
}

// 同じドライブ (ボリューム) か。移動元に小さなファイルを作って移動先へ名前の変更で移せるかを試す
// (ネットワークドライブや仮想ドライブでは、ドライブの識別番号だけでは判定を誤ることがあるため)
async function sameVolume(oldRoot: string, newRoot: string): Promise<boolean> {
    const name = `${PROBE_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
    const probe = path.join(oldRoot, name);
    const moved = path.join(newRoot, name);
    await fs.promises.writeFile(probe, '');
    try {
        await fs.promises.rename(probe, moved);
        await fs.promises.rm(moved, { force: true });
        return true;
    } catch (error) {
        await fs.promises.rm(probe, { force: true });
        if ((error as NodeJS.ErrnoException).code === 'EXDEV') return false;
        throw error;
    }
}

const PROGRESS_INTERVAL_MS = 300;
// コピーで一度に読み書きする大きさ
const COPY_CHUNK_BYTES = 4 * 1024 * 1024;

// エラーの詳細に添える大きさ (GB 単位)
function formatSize(bytes: number): string {
    return `${(bytes / 1e9).toFixed(2)} GB`;
}

// 一時フォルダを消す (中断した書き込みが閉じきるまで、Windows ではしばらく消せないことがあるため再試行する)
async function removeStaging(staging: string): Promise<void> {
    try {
        await fs.promises.rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
        // 残った一時フォルダは次の移動の始めに消す
        console.warn(`failed to remove the temporary folder ${staging}`, error);
    }
}

// 取得記録をマージする (上書きした単位・移動元にだけあった単位の記録を移動元から写す)。
// 記録は移動を始める前に読み、形を確かめておく (書き換えの途中で失敗して中身と記録が食い違わないようにするため)
type Records =
    | {
          kind: 'model';
          source: ModelManifestFile;
          target: ModelManifestFile;
          sourceOverrides: Record<string, unknown> | null;
          targetOverrides: Record<string, unknown> | null;
      }
    | { kind: 'library'; source: LibraryManifestFile; target: LibraryManifestFile };

function readRecords(kind: MovableStorage, oldRoot: string, newRoot: string): Records {
    if (kind === 'model') {
        return {
            kind,
            source: readModelManifest(oldRoot),
            target: readModelManifest(newRoot),
            sourceOverrides: readOverrides(oldRoot),
            targetOverrides: readOverrides(newRoot),
        };
    }
    return { kind, source: readLibraryManifest(oldRoot), target: readLibraryManifest(newRoot) };
}

function writeRecords(records: Records, newRoot: string, moved: Unit[]): void {
    if (records.kind === 'model') {
        const { source, target } = records;
        for (const unit of moved) {
            if (unit.kind === 'download' && source.models[unit.key]) target.models[unit.key] = source.models[unit.key];
        }
        writeJsonFile(path.join(newRoot, 'manifest.json'), target);
        // すぐに使えるモデルの名前と言語の変更は、そのモデル (ダウンロードした単位) と一緒に扱う。
        // 移したモデルは移動元の変更 (無ければ変更なし) にし、上書きしなかったモデルは移動先のままにする
        const overrides = { ...(records.targetOverrides ?? {}) };
        for (const unit of moved) {
            if (!unit.key.startsWith(READY_PREFIX)) continue;
            const name = unit.key.slice(READY_PREFIX.length);
            if (records.sourceOverrides && name in records.sourceOverrides) {
                overrides[name] = records.sourceOverrides[name];
            } else {
                delete overrides[name];
            }
        }
        if (records.targetOverrides || Object.keys(overrides).length > 0) {
            writeJsonFile(path.join(newRoot, READY_OVERRIDES), overrides);
        }
        return;
    }
    const { source, target } = records;
    for (const unit of moved) {
        if (unit.kind === 'python') target.python = source.python;
        if (unit.kind === 'library') {
            const component = unit.key.slice('library:'.length);
            // ライブラリを置き換えた場合は、そのライブラリに属する記録をすべて移動元のものにする
            for (const spec of COMPONENT_SPECS.filter(item => item.env === component)) {
                if (source.components[spec.id]) target.components[spec.id] = source.components[spec.id];
                else delete target.components[spec.id];
            }
        }
    }
    writeJsonFile(path.join(newRoot, 'manifest.json'), target);
}

// 移動元の中身を移動先へマージする。decisions は両方にある単位ごとの選択 (上書きするか)。
// 中断された場合 (置き換えを始める前) は何も変えずに cancelled を返す。移動元は消さない
// (設定を書き換えてから呼び出し側が消す)
export async function mergeStorage(
    jobId: string,
    kind: MovableStorage,
    oldRoot: string,
    newRoot: string,
    decisions: StorageMoveDecisions
): Promise<{ cancelled: boolean }> {
    const controller = new AbortController();
    const stopListening = onJobCancel(jobId, () => controller.abort());
    try {
        return await mergeNow(jobId, kind, oldRoot, newRoot, decisions, controller.signal);
    } finally {
        stopListening();
    }
}

async function mergeNow(
    jobId: string,
    kind: MovableStorage,
    oldRoot: string,
    newRoot: string,
    decisions: StorageMoveDecisions,
    signal: AbortSignal
): Promise<{ cancelled: boolean }> {
    const plan = await buildPlan(kind, oldRoot, newRoot);
    const undecided = plan.conflicts.filter(unit => !decisions[unit.key]);
    if (undecided.length > 0) throw new Error(`STORAGE_MOVE_UNDECIDED: ${undecided.map(unit => unit.key).join(', ')}`);
    const records = readRecords(kind, oldRoot, newRoot);
    const overwrite = plan.conflicts.filter(unit => decisions[unit.key] === 'overwrite');
    const moved = [...plan.sourceOnly, ...overwrite];
    const movedPaths = [...new Set([...moved.flatMap(unit => unit.paths), ...plan.others])].filter(relative =>
        fs.existsSync(path.join(oldRoot, relative))
    );
    if (signal.aborted) return { cancelled: true };
    await fs.promises.mkdir(newRoot, { recursive: true });
    // 前回の移動が途中で終わって残った一時フォルダを消す
    for (const name of fs.readdirSync(newRoot)) {
        if (name.startsWith(STAGING_PREFIX)) await removeStaging(path.join(newRoot, name));
    }

    // 別のドライブは、先に移動先の中の一時フォルダへコピーする (中断・失敗したら一時フォルダを消して元のまま)
    let from = oldRoot;
    let staging: string | null = null;
    if (!(await sameVolume(oldRoot, newRoot))) {
        const total = (await statsOf(oldRoot, movedPaths)).sizeBytes;
        // コピーを始める前に、移動先の空き容量を確かめる (上書きする単位は、コピーし終えてから削除するため、
        // 移すものすべての大きさが必要)
        const disk = await fs.promises.statfs(newRoot);
        const free = disk.bavail * disk.bsize;
        if (total > free) throw new Error(`STORAGE_NO_SPACE: ${formatSize(total)} / ${formatSize(free)}`);
        staging = path.join(newRoot, `${STAGING_PREFIX}${crypto.randomBytes(6).toString('hex')}`);
        let copied = 0;
        let lastSent = 0;
        try {
            await copyPaths(
                oldRoot,
                staging,
                movedPaths,
                bytes => {
                    copied += bytes;
                    const now = Date.now();
                    if (now - lastSent < PROGRESS_INTERVAL_MS) return;
                    lastSent = now;
                    emitJobEvent({ jobId, kind: 'progress', percent: total > 0 ? (copied / total) * 100 : undefined });
                },
                signal
            );
        } catch (error) {
            await removeStaging(staging);
            if (error instanceof Error && error.message === 'KURA_CANCELLED') return { cancelled: true };
            throw error;
        }
        from = staging;
    }
    if (signal.aborted) {
        if (staging) await removeStaging(staging);
        return { cancelled: true };
    }

    // 置き換え (ここからは中断しない): 上書きする単位は、移動先の単位を削除してから移す
    for (const unit of overwrite) {
        const targetPaths = new Set([...(plan.targetUnits.get(unit.key)?.paths ?? []), ...unit.paths]);
        for (const relative of targetPaths) {
            await fs.promises.rm(path.join(newRoot, relative), { recursive: true, force: true });
        }
    }
    // 移し終えたものは、途中で失敗したら元へ戻す (元の場所を使い続けられるようにする。上書きを選んで削除した
    // 移動先の単位は戻らない)
    const done: string[] = [];
    try {
        for (const relative of movedPaths) {
            await renameStorage(path.join(from, relative), path.join(newRoot, relative));
            done.push(relative);
        }
    } catch (error) {
        for (const relative of done.reverse()) {
            try {
                await renameStorage(path.join(newRoot, relative), path.join(from, relative));
            } catch (rollbackError) {
                console.warn(`failed to move ${relative} back to ${from}`, rollbackError);
            }
        }
        if (staging) await removeStaging(staging);
        throw error;
    }
    if (staging) await removeStaging(staging);
    writeRecords(records, newRoot, moved);
    return { cancelled: false };
}

// 移動元を消す。消せなかった場合は false を返す (移動は終わっているため、失敗としては扱わない)
export async function removeStorageRoot(root: string): Promise<boolean> {
    try {
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        return true;
    } catch (error) {
        console.warn(`failed to remove the previous location ${root}`, error);
        return false;
    }
}
