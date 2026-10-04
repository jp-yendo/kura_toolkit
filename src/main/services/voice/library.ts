import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { emitJobEvent, finishJob, isCancelled, onJobCancel, startJob } from '../job-manager';
import { getSettings, updateSettings } from '../settings';
import {
    fetchFiles,
    installComponent,
    installPython,
    isSpecFilePresent,
    sourceOwner,
    type InstallContext,
} from './installer';
import { readManifest, updateManifest, type LibraryManifest } from './manifest';
import { envPythonExecutable, libraryPaths, modelPaths, pythonExecutable } from './paths';
import { defaultStorageDir, getLibraryDir, getModelDir, getWorkDir, isSameOrNested, isSamePath } from '../storage';
import { getPlatformInfo } from './platform';
import { buildPythonEnv } from './python-env';
import { runProcess } from './process-runner';
import { stopAllWorkersAndWait } from './python-worker';
import { isFileBusyError, renameWithRetry } from '../../utils/rename-retry';
import {
    forgetSeparatorModelList,
    probeSeparatorSizes,
    readSeparatorModelList,
    refreshSeparatorModelList,
    resolveSeparatorModelFiles,
    separatorModelByItemId,
    separatorModelInstalled,
    separatorModelSource,
} from './separator-models';
import {
    COMPONENT_SPECS,
    componentVariant,
    estimateComponentBytes,
    MODEL_SPECS,
    PYTHON_SPEC,
    separatorFilename,
    separatorItemId,
    type ComponentItemId,
    type ComponentSpec,
    type ModelSpec,
    type SpecFile,
} from './spec';
import type {
    FeatureReadiness,
    LibraryDownloadResult,
    LibraryItem,
    LibraryItemResult,
    LibraryItemStatus,
    LibraryProgress,
    LibraryRemoveResult,
    LibraryStatus,
    VoiceComponentId,
    VoiceFeatureId,
    VoicePlatformInfo,
} from '../../../shared/voice/types';
import type { StorageMoveResult } from '../../../shared/types';

// 音声機能が使う Python 本体・パッケージ一式・モデルの状態の判定、ダウンロード、削除と、
// それらを収める保存場所 (ライブラリ・モデルディレクトリ) の移動。
// すべてのダウンロードは利用者が対象を選んで実行を指示したときだけ行う。

const COMPONENT_ORDER: ComponentItemId[] = ['separator', 'converter', 'tts', 'tts-train'];

// 細かい進捗を画面へ送る間隔。pip はおよそ 10KB ごとに、移動はファイルごとに進捗が出るため、
// そのまま送ると数十万回の通知になり画面の更新が追いつかなくなる
const PROGRESS_INTERVAL_MS = 150;

// 分離モデルのライセンスとクレジット (分離モデルで共通)
const SEPARATOR_LICENSE = { name: 'UVR / model authors', url: 'https://github.com/Anjok07/ultimatevocalremovergui' };
const SEPARATOR_CREDIT = 'Ultimate Vocal Remover (UVR) - Anjok07 and contributors';

function componentItemId(id: ComponentItemId): string {
    return `component:${id}`;
}

function componentFromItemId(itemId: string): ComponentSpec | undefined {
    if (!itemId.startsWith('component:')) return undefined;
    return COMPONENT_SPECS.find(spec => spec.id === itemId.slice('component:'.length));
}

// --- 状態の判定 ---

function pythonStatus(manifest: LibraryManifest): LibraryItemStatus {
    if (!manifest.python) return 'missing';
    if (!fs.existsSync(pythonExecutable())) return 'broken';
    return manifest.python.version === PYTHON_SPEC.version ? 'installed' : 'outdated';
}

function componentStatus(
    spec: ComponentSpec,
    manifest: LibraryManifest,
    platform: VoicePlatformInfo
): LibraryItemStatus {
    const entry = manifest.components[spec.id];
    if (!entry) return 'missing';
    if (entry.broken || !fs.existsSync(envPythonExecutable(spec.env))) return 'broken';
    if (spec.source && !fs.existsSync(libraryPaths().source(sourceOwner(spec)))) return 'broken';
    if (entry.version !== spec.version || entry.variant !== componentVariant(platform)) return 'outdated';
    return 'installed';
}

// 取得の記録が無いモデルは、ファイルがあっても取得していないものとして扱う
function modelStatus(spec: ModelSpec, manifest: LibraryManifest): LibraryItemStatus {
    const entry = manifest.models[spec.id];
    if (!entry) return 'missing';
    if (!spec.files.every(isSpecFilePresent)) return 'broken';
    return entry.version === spec.version ? 'installed' : 'outdated';
}

function sumSizes(files: SpecFile[]): number | null {
    let total = 0;
    for (const file of files) {
        if (file.size === undefined) continue;
        total += file.size;
    }
    return total > 0 ? total : null;
}

function buildItems(platform: VoicePlatformInfo, manifest: LibraryManifest): LibraryItem[] {
    const items: LibraryItem[] = [];
    const supported = platform.supported;
    items.push({
        id: 'python',
        kind: 'python',
        group: 'runtime',
        nameKey: 'voice.library.items.python',
        descriptionKey: 'voice.library.items.pythonDesc',
        sizeBytes: platform.platform === 'unsupported' ? null : (PYTHON_SPEC.assets[platform.platform].size ?? null),
        sizeEstimated: false,
        status: pythonStatus(manifest),
        requires: [],
        usedBy: ['separation', 'conversion', 'conversionTraining', 'tts', 'ttsTraining'],
        license: PYTHON_SPEC.license,
        source: PYTHON_SPEC.source,
        available: supported,
    });
    for (const id of COMPONENT_ORDER) {
        const spec = COMPONENT_SPECS.find(item => item.id === id) as ComponentSpec;
        const trainingOnly = id === 'tts-train';
        const available = supported && (!trainingOnly || platform.ttsTrainingAvailable);
        items.push({
            id: componentItemId(id),
            kind: 'component',
            group: spec.env === 'separator' ? 'separator' : spec.env === 'converter' ? 'converter' : 'tts',
            nameKey: spec.nameKey,
            descriptionKey: spec.descriptionKey,
            sizeBytes: estimateComponentBytes(spec, platform),
            sizeEstimated: true,
            status: componentStatus(spec, manifest, platform),
            requires: spec.requires,
            usedBy: spec.usedBy,
            license: spec.license,
            source: spec.sourceInfo,
            credit: spec.credit,
            available,
            unavailableReasonKey: available
                ? undefined
                : trainingOnly
                  ? 'voice.library.ttsTrainingUnavailable'
                  : undefined,
        });
    }
    for (const spec of MODEL_SPECS) {
        const available = supported && (spec.trainingOnly !== 'tts' || platform.ttsTrainingAvailable);
        items.push({
            id: spec.id,
            kind: 'model',
            group: spec.group,
            nameKey: spec.nameKey,
            name: spec.name,
            descriptionKey: spec.descriptionKey,
            sizeBytes: sumSizes(spec.files),
            sizeEstimated: false,
            status: modelStatus(spec, manifest),
            requires: spec.requires,
            usedBy: spec.usedBy,
            license: spec.license,
            source: spec.source,
            credit: spec.credit,
            available,
            unavailableReasonKey: available ? undefined : 'voice.library.ttsTrainingUnavailable',
        });
    }
    const listed = new Set<string>();
    const list = readSeparatorModelList();
    if (list) {
        for (const model of list.models) {
            const id = separatorItemId(model.filename);
            const source = separatorModelSource(model);
            listed.add(id);
            items.push({
                id,
                kind: 'model',
                group: 'separator',
                name: model.name,
                sizeBytes: source.sizeBytes,
                sizeEstimated: false,
                status: separatorModelInstalled(model) ? 'installed' : 'missing',
                requires: [],
                usedBy: ['separation'],
                license: SEPARATOR_LICENSE,
                // 取得元 (候補のうちファイルが実際にある URL) は、調べ終えてから示す
                source: source.url === null ? undefined : { name: source.url, url: source.url },
                credit: SEPARATOR_CREDIT,
                // 取得元の候補のどこにもファイルが無いモデルは取得できない
                available: supported && !source.notFound,
                unavailableReasonKey: source.notFound ? 'voice.library.separatorModelNotFound' : undefined,
                separator: { category: model.category, arch: model.arch, stems: model.stems },
            });
        }
    }
    // 取得済みで一覧に無い分離モデル (パッケージ一式を削除して一覧が無いときなど) も、削除できるよう
    // ファイル名を名前として示す
    for (const id of Object.keys(manifest.models)) {
        const filename = separatorFilename(id);
        if (filename === null || listed.has(id)) continue;
        items.push({
            id,
            kind: 'model',
            group: 'separator',
            name: filename,
            sizeBytes: null,
            sizeEstimated: false,
            status: 'installed',
            requires: [],
            usedBy: ['separation'],
            license: SEPARATOR_LICENSE,
            credit: SEPARATOR_CREDIT,
            available: supported,
        });
    }
    return items;
}

export async function getLibraryStatus(): Promise<LibraryStatus> {
    const platform = await getPlatformInfo();
    const manifest = readManifest();
    return {
        platform,
        items: buildItems(platform, manifest),
        separatorModelsListed: readSeparatorModelList() !== null,
    };
}

// 機能ごとに最低限必要な項目
const FEATURE_REQUIREMENTS: Record<VoiceFeatureId, string[]> = {
    separation: ['python', componentItemId('separator')],
    conversion: ['python', componentItemId('converter'), 'model:converter:rmvpe', 'model:converter:contentvec'],
    conversionTraining: [
        'python',
        componentItemId('converter'),
        'model:converter:rmvpe',
        'model:converter:contentvec',
        'model:converter:pretrained-40k',
    ],
    tts: ['python', componentItemId('tts'), 'model:tts:bert-ja'],
    ttsTraining: ['python', componentItemId('tts'), componentItemId('tts-train'), 'model:tts:bert-ja'],
};

export async function checkFeature(feature: VoiceFeatureId, extra: string[] = []): Promise<FeatureReadiness> {
    const status = await getLibraryStatus();
    const byId = new Map(status.items.map(item => [item.id, item]));
    const missing = [...FEATURE_REQUIREMENTS[feature], ...extra].filter(id => byId.get(id)?.status !== 'installed');
    return { ready: status.platform.supported && missing.length === 0, missing, platform: status.platform };
}

export function isItemInstalled(id: string): boolean {
    const manifest = readManifest();
    if (id === 'python') return pythonStatus(manifest) === 'installed';
    const component = componentFromItemId(id);
    if (component) return !!manifest.components[component.id] && !manifest.components[component.id].broken;
    const spec = MODEL_SPECS.find(item => item.id === id);
    if (spec) return modelStatus(spec, manifest) === 'installed';
    const separator = separatorModelByItemId(id);
    return separator ? separatorModelInstalled(separator) : false;
}

// アプリの更新で取得し直しが必要になった項目 (起動時の確認に使う)
export async function getPendingUpdates(): Promise<{ items: LibraryItem[]; promptNeeded: boolean }> {
    const status = await getLibraryStatus();
    const items = status.items.filter(item => item.status === 'outdated' || item.status === 'broken');
    const promptNeeded = items.length > 0 && getSettings().voice.updatePromptVersion !== app.getVersion();
    return { items, promptNeeded };
}

export function markUpdatePrompted(): void {
    updateSettings({ voice: { updatePromptVersion: app.getVersion() } });
}

// --- ダウンロード ---

// 全体の進捗に数える大きさ。大きさが分からない項目は全体に含めない
function knownBytes(item: LibraryItem): number {
    return item.sizeBytes ?? 0;
}

// 選ばれた項目に、まだ取得していない前提項目を足して、取得する順番に並べる
function planDownload(ids: string[], items: LibraryItem[]): LibraryItem[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const selected = new Set<string>();
    const visit = (id: string) => {
        const item = byId.get(id);
        if (!item || selected.has(id)) return;
        for (const required of item.requires) {
            if (byId.get(required)?.status !== 'installed') visit(required);
        }
        selected.add(id);
    };
    ids.forEach(visit);
    const rank = (item: LibraryItem) => (item.kind === 'python' ? 0 : item.kind === 'component' ? 1 : 2);
    return items.filter(item => selected.has(item.id)).sort((a, b) => rank(a) - rank(b));
}

// ライブラリの中身を変える処理 (ダウンロード・削除・移動) は 1 つずつ順に行う。
// 画面ごとに別のジョブとして同時に始められるため (プリセットの声の取得とダウンロードの画面など)、
// 同じ仮想環境への同時の導入や、導入中の pip のキャッシュの削除が起きないようにする
let libraryQueue: Promise<unknown> = Promise.resolve();

function withLibraryLock<T>(task: () => Promise<T>): Promise<T> {
    const run = libraryQueue.then(task, task);
    libraryQueue = run.catch(() => undefined);
    return run;
}

export async function downloadItems(jobId: string, ids: string[]): Promise<LibraryDownloadResult> {
    startJob(jobId);
    const controller = new AbortController();
    const unregister = onJobCancel(jobId, () => controller.abort());
    const results: LibraryItemResult[] = [];
    try {
        // 先に始まった処理が終わるまで待つ (待っている間も中断できる)
        if (ids[0]) {
            emitJobEvent({
                jobId,
                kind: 'progress',
                payload: { itemId: ids[0], state: 'waiting', receivedBytes: 0, totalBytes: null },
            });
        }
        return await withLibraryLock(() => runDownload(jobId, ids, controller, results));
    } finally {
        unregister();
        finishJob(jobId);
    }
}

async function runDownload(
    jobId: string,
    ids: string[],
    controller: AbortController,
    results: LibraryItemResult[]
): Promise<LibraryDownloadResult> {
    const platform = await getPlatformInfo(true);
    if (!platform.supported) throw new Error('PLATFORM_UNSUPPORTED');
    const status = await getLibraryStatus();
    const plan = planDownload(ids, status.items);
    const totalBytes = plan.reduce((sum, item) => sum + knownBytes(item), 0);
    let doneBytes = 0;
    const failed = new Set<string>();

    // パッケージを入れ替える間は、仮想環境のファイルを使っている常駐プロセスを止める (終了を待つ)
    if (plan.some(item => item.kind !== 'model')) await stopAllWorkersAndWait();

    // 項目や状態が変わったときは必ず送り、同じ状態の途中経過は間引く
    let lastSent = { key: '', at: 0 };
    const emit = (progress: LibraryProgress) => {
        const key = `${progress.itemId}:${progress.state}`;
        const now = Date.now();
        if (key === lastSent.key && now - lastSent.at < PROGRESS_INTERVAL_MS) return;
        lastSent = { key, at: now };
        const size = knownBytes(plan.find(item => item.id === progress.itemId)!);
        const current = Math.min(progress.receivedBytes, size);
        emitJobEvent({
            jobId,
            kind: 'progress',
            percent: totalBytes > 0 ? ((doneBytes + current) / totalBytes) * 100 : undefined,
            payload: progress,
        });
    };

    for (const item of plan) {
        if (controller.signal.aborted || isCancelled(jobId)) {
            results.push({ id: item.id, ok: false, cancelled: true });
            continue;
        }
        // 前提が失敗した項目は取得しない
        if (item.requires.some(required => failed.has(required))) {
            failed.add(item.id);
            results.push({ id: item.id, ok: false, error: 'PREREQUISITE_FAILED' });
            continue;
        }
        emit({ itemId: item.id, state: 'downloading', receivedBytes: 0, totalBytes: item.sizeBytes });
        const context: InstallContext = {
            jobId,
            signal: controller.signal,
            onProgress: progress =>
                emit({
                    itemId: item.id,
                    state: progress.installing ? 'installing' : 'downloading',
                    receivedBytes: progress.received,
                    totalBytes: progress.total ?? item.sizeBytes,
                    detail: progress.detail,
                }),
        };
        try {
            await installItem(item, platform, context);
            doneBytes += knownBytes(item);
            emit({ itemId: item.id, state: 'done', receivedBytes: 0, totalBytes: item.sizeBytes });
            results.push({ id: item.id, ok: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message === 'KURA_CANCELLED' || controller.signal.aborted) {
                emit({ itemId: item.id, state: 'cancelled', receivedBytes: 0, totalBytes: item.sizeBytes });
                results.push({ id: item.id, ok: false, cancelled: true });
                continue;
            }
            console.error(`failed to install ${item.id}`, error);
            failed.add(item.id);
            doneBytes += knownBytes(item);
            emit({
                itemId: item.id,
                state: 'failed',
                receivedBytes: 0,
                totalBytes: item.sizeBytes,
                detail: message,
            });
            results.push({ id: item.id, ok: false, error: message });
        }
    }
    const cancelled = controller.signal.aborted || isCancelled(jobId);
    // pip のキャッシュ (PyTorch など数 GB) は、全て成功したら消す。失敗・中断した場合は再試行に使うため残す
    if (!cancelled && failed.size === 0) {
        await fs.promises.rm(libraryPaths().pipCache, { recursive: true, force: true });
    }
    return { results, cancelled };
}

async function installItem(item: LibraryItem, platform: VoicePlatformInfo, context: InstallContext): Promise<void> {
    if (item.kind === 'python') {
        await installPython(platform, context);
        return;
    }
    const component = componentFromItemId(item.id);
    if (component) {
        await installComponent(component, platform, estimateComponentBytes(component, platform), context);
        if (component.id === 'separator') {
            // 分離モデルの一覧は導入したパッケージから取得する (取得できなければこの項目を失敗とする)
            forgetSeparatorModelList();
            await refreshSeparatorModelList();
            void probeSeparatorSizes();
        }
        return;
    }
    const spec = MODEL_SPECS.find(model => model.id === item.id);
    if (spec) {
        await fetchFiles(spec.files, context, sumSizes(spec.files));
        updateManifest(manifest => {
            manifest.models[spec.id] = {
                version: spec.version,
                installedAt: Date.now(),
                files: spec.files.map(file => file.dest),
            };
        });
        return;
    }
    const separator = separatorModelByItemId(item.id);
    if (separator) {
        // 取得元 (候補のうちファイルが実際にある URL) を確かめ、その URL からだけ取得する
        const files = await resolveSeparatorModelFiles(separator, context.signal);
        await fetchFiles(files, context, sumSizes(files));
        updateManifest(manifest => {
            manifest.models[item.id] = {
                version: '1',
                installedAt: Date.now(),
                files: files.map(file => file.dest),
            };
        });
        return;
    }
    throw new Error(`UNKNOWN_ITEM: ${item.id}`);
}

// --- 削除 ---

function removeEmptyDirs(start: string, stopAt: string): void {
    let dir = start;
    while (dir.startsWith(stopAt) && dir !== stopAt) {
        try {
            if (fs.readdirSync(dir).length > 0) return;
            fs.rmdirSync(dir);
        } catch {
            return;
        }
        dir = path.dirname(dir);
    }
}

// 取得途中で止まったファイル (続きの取得に使う .part) を消す。項目を削除したら再利用しないため
function removePartial(dest: string): void {
    fs.rmSync(`${dest}.part`, { force: true });
}

async function removeComponent(id: ComponentItemId): Promise<void> {
    const lib = libraryPaths();
    const models = modelPaths();
    const spec = COMPONENT_SPECS.find(item => item.id === id) as ComponentSpec;
    // 読み上げの仮想環境を消すと学習用の追加分も使えなくなるため、学習用のソース一式も一緒に消す
    if (id === 'tts') await removeComponent('tts-train');
    // パッケージ一式と一緒に取得したファイル (モデルディレクトリに置いたもの)
    for (const file of spec.files) {
        const full = models.file(file.dest);
        await fs.promises.rm(full, { force: true });
        removePartial(full);
        removeEmptyDirs(path.dirname(full), models.root);
    }
    if (id === 'tts-train') {
        // 読み上げの仮想環境に追加で入れたものなので、仮想環境は残してソース一式 (と取得途中の書庫) だけを消す
        await fs.promises.rm(lib.source('tts'), { recursive: true, force: true });
        removePartial(lib.sourceArchive('tts'));
    } else {
        // ライブラリのディレクトリごと消す (仮想環境・ソース一式・キャッシュ)
        await fs.promises.rm(lib.library(spec.env), { recursive: true, force: true });
    }
    updateManifest(manifest => {
        delete manifest.components[id];
        // 読み上げの仮想環境を消すと学習用の追加分も無くなる
        if (id === 'tts') delete manifest.components['tts-train'];
    });
    if (id === 'separator') forgetSeparatorModelList();
}

// 消すのは、取得したときにモデルの記録へ残したファイルだけ (記録の無い項目には消すものが無い)
async function removeModel(itemId: string): Promise<void> {
    const manifest = readManifest();
    const entry = manifest.models[itemId];
    if (!entry) return;
    const models = modelPaths();
    // 他の取得済みモデルと共有しているファイル (分離モデルの設定ファイルなど) は残す
    const shared = new Set<string>();
    for (const [otherId, other] of Object.entries(manifest.models)) {
        if (otherId !== itemId) other.files.forEach(file => shared.add(file));
    }
    for (const file of entry.files) {
        if (shared.has(file)) continue;
        const full = models.file(file);
        await fs.promises.rm(full, { recursive: true, force: true });
        removePartial(full);
        if (file.endsWith('.zip')) {
            // 展開したデータも消す
            await fs.promises.rm(full.slice(0, -'.zip'.length), { recursive: true, force: true });
        }
        removeEmptyDirs(path.dirname(full), models.root);
    }
    updateManifest(next => {
        delete next.models[itemId];
    });
}

export function removeItems(ids: string[], options: { removePython?: boolean } = {}): Promise<LibraryRemoveResult> {
    return withLibraryLock(async () => removeItemsNow(ids, options));
}

async function removeItemsNow(ids: string[], options: { removePython?: boolean }): Promise<LibraryRemoveResult> {
    // 消すファイルを常駐プロセスが掴んでいると消せないため、終了を待ってから消す
    await stopAllWorkersAndWait();
    const removed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const targets = new Set(ids);
    // Python 本体を消すと、すべての仮想環境が使えなくなるため一緒に消す
    const removingPython = targets.has('python') || options.removePython === true;
    if (removingPython) {
        COMPONENT_ORDER.forEach(id => targets.add(componentItemId(id)));
        targets.add('python');
    }
    for (const id of targets) {
        try {
            if (id === 'python') continue;
            const component = componentFromItemId(id);
            if (component) {
                await removeComponent(component.id);
            } else {
                await removeModel(id);
            }
            removed.push(id);
        } catch (error) {
            failed.push({ id, error: error instanceof Error ? error.message : String(error) });
        }
    }
    if (removingPython) {
        try {
            await fs.promises.rm(libraryPaths().python, { recursive: true, force: true });
            removePartial(libraryPaths().pythonArchive);
            updateManifest(next => {
                next.python = null;
            });
            removed.push('python');
        } catch (error) {
            failed.push({ id: 'python', error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { removed, failed };
}

// --- 保存場所 (ライブラリ・モデルディレクトリ) の移動 ---

// ディレクトリの中を辿り、ファイルとディレクトリを root からの相対パスで渡す (ディレクトリは中より先に渡す)。
// シンボリックリンクはリンクとしては扱わず、リンク先 (ファイルの中身・ディレクトリの中) として辿る。
// 自分を含む親のディレクトリを指すリンクは際限なく辿ることになるため、STORAGE_LINK_LOOP で失敗させる
async function walkTree(
    root: string,
    onFile: (relative: string, full: string) => Promise<void>,
    onDirectory: (relative: string) => Promise<void> = async () => undefined
): Promise<void> {
    const walk = async (relative: string, ancestors: string[]): Promise<void> => {
        for (const entry of await fs.promises.readdir(path.join(root, relative), { withFileTypes: true })) {
            const childRelative = path.join(relative, entry.name);
            const full = path.join(root, childRelative);
            let real: string;
            if (entry.isSymbolicLink()) {
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
    await walk('', [await fs.promises.realpath(root)]);
}

// 中身の大きさの合計 (コピーの進捗の表示用。リンク先もコピーと同じように数える)
async function directorySize(root: string): Promise<number> {
    let total = 0;
    await walkTree(root, async (_relative, full) => {
        total += (await fs.promises.stat(full)).size;
    });
    return total;
}

// 別のドライブへの移動で、中身を移動先のフォルダ (既にあるもの) へコピーする。
// リンクは作らず、シンボリックリンクはリンク先の中身 (ファイルの中身、またはディレクトリの中) を写す
async function copyTree(source: string, dest: string, onBytes: (bytes: number) => void, jobId: string): Promise<void> {
    await walkTree(
        source,
        async (relative, full) => {
            if (isCancelled(jobId)) throw new Error('KURA_CANCELLED');
            const target = path.join(dest, relative);
            await fs.promises.copyFile(full, target);
            onBytes((await fs.promises.stat(target)).size);
        },
        async relative => {
            if (isCancelled(jobId)) throw new Error('KURA_CANCELLED');
            await fs.promises.mkdir(path.join(dest, relative));
        }
    );
}

// 仮想環境は元の Python 本体の場所を pyvenv.cfg に記録しているため、移動後に新しい場所へ書き換える。
// Windows はドライブ名の大文字小文字が違う表記で記録されることがあるため、大文字小文字を区別せずに置き換える
function relocateVenv(component: VoiceComponentId, oldRoot: string, newRoot: string): void {
    const cfg = path.join(libraryPaths(newRoot).env(component), 'pyvenv.cfg');
    if (!fs.existsSync(cfg)) return;
    const pattern = new RegExp(oldRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const text = fs.readFileSync(cfg, 'utf-8');
    // 置き換え後の文字列は関数で渡す (場所に $ が含まれていても置換パターンとして解釈させないため)
    fs.writeFileSync(
        cfg,
        text.replace(pattern, () => newRoot),
        'utf-8'
    );
}

async function verifyVenv(component: VoiceComponentId): Promise<boolean> {
    try {
        const result = await runProcess(
            envPythonExecutable(component),
            ['-c', 'import sys, torch; print(sys.prefix)'],
            {
                env: buildPythonEnv(component),
            }
        );
        return result.code === 0;
    } catch {
        return false;
    }
}

type MovableStorage = 'library' | 'model';

// 保存場所を移動する。中身を選んだフォルダへ移し、そのフォルダを新しい保存場所にする。
// targetDir が null の場合は既定の場所 (~/.kura_toolkit の下) へ戻す
export async function moveStorage(
    jobId: string,
    kind: MovableStorage,
    targetDir: string | null
): Promise<StorageMoveResult> {
    startJob(jobId);
    try {
        const newRoot = moveTarget(kind, targetDir);
        // 既定の場所へ移した場合は設定を空にする (既定の場所に従わせる)
        const setting = isSamePath(newRoot, defaultStorageDir(kind)) ? '' : newRoot;
        return await withLibraryLock(() =>
            kind === 'library' ? moveLibraryNow(jobId, newRoot, setting) : moveModelDirNow(jobId, newRoot, setting)
        );
    } finally {
        finishJob(jobId);
    }
}

// 移動先 (targetDir が null の場合は既定の場所)
function moveTarget(kind: MovableStorage, targetDir: string | null): string {
    return targetDir === null ? defaultStorageDir(kind) : path.resolve(targetDir);
}

// 移動を始める前に、移動先を選べるかを確かめる (確認画面を出す前に知らせるため)
export function checkStorageMove(kind: MovableStorage, targetDir: string | null): void {
    const oldRoot = kind === 'library' ? getLibraryDir() : getModelDir();
    const newRoot = moveTarget(kind, targetDir);
    if (!isSamePath(oldRoot, newRoot)) checkMoveTarget(kind, oldRoot, newRoot);
}

// 移動先の確認。今の場所の中・外側、ほかの保存場所や作業ディレクトリと重なる場所は選べない。
// 移動先は空のフォルダ (または無いフォルダ) に限る (他のファイルと混ぜないため)
function checkMoveTarget(kind: MovableStorage, oldRoot: string, newRoot: string): void {
    if (isSameOrNested(oldRoot, newRoot)) throw new Error('STORAGE_MOVE_NESTED');
    const other = kind === 'library' ? getModelDir() : getLibraryDir();
    if (isSameOrNested(other, newRoot) || isSameOrNested(getWorkDir(), newRoot)) {
        throw new Error('STORAGE_OVERLAP');
    }
    if (fs.existsSync(newRoot) && fs.readdirSync(newRoot).length > 0) {
        throw new Error(`STORAGE_TARGET_NOT_EMPTY: ${newRoot}`);
    }
}

// 同じドライブ (ボリューム) か。移動先が無い場合は、移動先を作る親のフォルダで調べる
function sameVolume(source: string, target: string): boolean {
    const probe = fs.existsSync(target) ? target : path.dirname(target);
    return fs.statSync(source).dev === fs.statSync(probe).dev;
}

// 名前を変えて移す。ほかのプログラムがファイルを開いていて移せなければ、使用中として止める
async function renameStorage(from: string, to: string): Promise<void> {
    try {
        await renameWithRetry(from, to);
    } catch (error) {
        if (isFileBusyError(error)) throw new Error(`STORAGE_IN_USE: ${from}`);
        throw error;
    }
}

// 同じドライブで、移動先のフォルダ (空) の中へ元の場所の項目を 1 つずつ名前を変えて移し、空になった元の場所を消す。
// 途中で失敗したら、移した項目を元の場所へ戻してから失敗を返す。元の場所を消せなかった場合は false を返す
async function moveEntriesInto(oldRoot: string, newRoot: string): Promise<boolean> {
    const moved: string[] = [];
    try {
        for (const name of await fs.promises.readdir(oldRoot)) {
            await renameStorage(path.join(oldRoot, name), path.join(newRoot, name));
            moved.push(name);
        }
    } catch (error) {
        for (const name of moved.reverse()) {
            await renameStorage(path.join(newRoot, name), path.join(oldRoot, name));
        }
        throw error;
    }
    // 中身はすべて移動先にあり、以後は移動先を使う。空になった元の場所を消せなかった場合も移動は成功として扱う
    try {
        await fs.promises.rmdir(oldRoot);
        return true;
    } catch (error) {
        console.warn(`failed to remove the previous location ${oldRoot}`, error);
        return false;
    }
}

// 中身を移動先へ移す。利用者が選んだフォルダ (移動先) は消したり置き換えたりしない。
// - 同じドライブ: 移動先のフォルダがあればその中へ項目ごとに名前を変えて移し、無ければ元の場所の名前を変えて移動先にする
// - 別のドライブ: 移動先へコピーしてから元を消す (移動先のフォルダは無い場合だけ作る)。コピー中は進捗を出し、
//   中断・失敗したらコピーしたものだけを消して (移動先のフォルダはこの移動で作った場合だけ消す) 元の場所を使い続ける
// 結果は、中断されたか (cancelled) と、移動は終わったが消せなかった元の場所 (remainingPath)
async function relocateTree(
    jobId: string,
    oldRoot: string,
    newRoot: string
): Promise<{ cancelled: boolean; remainingPath: string | null }> {
    const targetExists = fs.existsSync(newRoot);
    if (sameVolume(oldRoot, newRoot)) {
        if (!targetExists) {
            await renameStorage(oldRoot, newRoot);
            return { cancelled: false, remainingPath: null };
        }
        const removed = await moveEntriesInto(oldRoot, newRoot);
        return { cancelled: false, remainingPath: removed ? null : oldRoot };
    }
    // 移動先は空のため、移動先の中の、元の場所の項目と同じ名前のものがコピーしたもの
    const names = await fs.promises.readdir(oldRoot);
    const total = await directorySize(oldRoot);
    if (!targetExists) await fs.promises.mkdir(newRoot);
    let copied = 0;
    let lastSent = 0;
    try {
        await copyTree(
            oldRoot,
            newRoot,
            bytes => {
                copied += bytes;
                const now = Date.now();
                if (now - lastSent < PROGRESS_INTERVAL_MS) return;
                lastSent = now;
                emitJobEvent({ jobId, kind: 'progress', percent: total > 0 ? (copied / total) * 100 : undefined });
            },
            jobId
        );
    } catch (error) {
        if (targetExists) {
            for (const name of names) await fs.promises.rm(path.join(newRoot, name), { recursive: true, force: true });
        } else {
            await fs.promises.rm(newRoot, { recursive: true, force: true });
        }
        if (error instanceof Error && error.message === 'KURA_CANCELLED') {
            return { cancelled: true, remainingPath: null };
        }
        throw error;
    }
    // コピーは完了しており、以後は移動先を使う。元の場所を消せなかった場合も移動は成功として扱う
    try {
        await fs.promises.rm(oldRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        return { cancelled: false, remainingPath: null };
    } catch (error) {
        console.warn(`failed to remove the previous location ${oldRoot}`, error);
        return { cancelled: false, remainingPath: oldRoot };
    }
}

// 移動先を保存場所として設定に書き込む。書き込めなかった場合は、移動は終わっているが次の起動で元の場所を
// 使ってしまうため失敗として知らせる
function saveStorageSetting(kind: MovableStorage, setting: string): void {
    const result = updateSettings({ storage: kind === 'library' ? { libraryDir: setting } : { modelDir: setting } });
    if (result.saveError) throw new Error(`SETTINGS_SAVE_FAILED: ${result.saveError}`);
}

async function moveLibraryNow(jobId: string, newRoot: string, setting: string): Promise<StorageMoveResult> {
    await stopAllWorkersAndWait();
    const oldRoot = getLibraryDir();
    if (isSamePath(oldRoot, newRoot)) return { cancelled: false, rebuildRequired: [], remainingPath: null };
    checkMoveTarget('library', oldRoot, newRoot);

    let remainingPath: string | null = null;
    if (fs.existsSync(oldRoot)) {
        const relocated = await relocateTree(jobId, oldRoot, newRoot);
        if (relocated.cancelled) return { cancelled: true, rebuildRequired: [], remainingPath: null };
        remainingPath = relocated.remainingPath;
    } else {
        fs.mkdirSync(newRoot, { recursive: true });
    }

    saveStorageSetting('library', setting);
    forgetSeparatorModelList();

    // 仮想環境の記録を書き換えて動作を確かめ、失敗した場合だけ作り直しの対象にする
    const manifest = readManifest({ library: newRoot });
    const rebuildRequired: string[] = [];
    for (const spec of COMPONENT_SPECS) {
        if (!manifest.components[spec.id] || spec.id === 'tts-train') continue;
        relocateVenv(spec.env, oldRoot, newRoot);
        if (!(await verifyVenv(spec.env))) {
            rebuildRequired.push(componentItemId(spec.id));
            if (spec.id === 'tts' && manifest.components['tts-train'])
                rebuildRequired.push(componentItemId('tts-train'));
        }
    }
    if (rebuildRequired.length > 0) {
        updateManifest(
            next => {
                for (const id of rebuildRequired) {
                    const key = id.slice('component:'.length);
                    if (next.components[key]) next.components[key].broken = true;
                }
            },
            { library: newRoot }
        );
    }
    return { cancelled: false, rebuildRequired, remainingPath };
}

// モデルディレクトリの移動 (補助プロセスはモデルの場所を起動時に受け取るため、止めてから移す)
async function moveModelDirNow(jobId: string, newRoot: string, setting: string): Promise<StorageMoveResult> {
    await stopAllWorkersAndWait();
    const oldRoot = getModelDir();
    if (isSamePath(oldRoot, newRoot)) return { cancelled: false, rebuildRequired: [], remainingPath: null };
    checkMoveTarget('model', oldRoot, newRoot);

    let remainingPath: string | null = null;
    if (fs.existsSync(oldRoot)) {
        const relocated = await relocateTree(jobId, oldRoot, newRoot);
        if (relocated.cancelled) return { cancelled: true, rebuildRequired: [], remainingPath: null };
        remainingPath = relocated.remainingPath;
    } else {
        fs.mkdirSync(newRoot, { recursive: true });
    }
    saveStorageSetting('model', setting);
    return { cancelled: false, rebuildRequired: [], remainingPath };
}
