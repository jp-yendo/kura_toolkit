import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { countActiveJobsExcept, emitJobEvent, finishJob, isCancelled, onJobCancel, startJob } from '../job-manager';
import { getSettings, saveSettings, updateSettings } from '../settings';
import {
    fetchFiles,
    installComponent,
    installPython,
    isSpecFilePresent,
    sourceOwner,
    type InstallContext,
    installLeftoversRemoved,
} from './installer';
import { readManifest, updateManifest, type LibraryManifest } from './manifest';
import { requiredItems } from '../../../shared/voice/requirements';
import { isFeatureAvailable, separationModelsAvailable } from '../../../shared/voice/availability';
import { envPythonExecutable, libraryCacheDirOf, libraryPaths, modelPaths } from './paths';
import { clearReadyModelOverride } from './ready-model-overrides';
import {
    defaultStorageDir,
    getCacheDir,
    getLibraryDir,
    getModelDir,
    getWorkDir,
    isSameOrNested,
    isSamePath,
} from '../storage';
import { getPlatformInfo } from './platform';
import { buildPythonEnv } from './python-env';
import { runProcess, WINDOWS_DLL_NOT_FOUND } from './process-runner';
import { stopAllWorkersAndWait } from './python-worker';
import {
    ensureSeparatorModelList,
    forgetSeparatorModelList,
    probeSeparatorSizes,
    readSeparatorModelList,
    resolveSeparatorModelFiles,
    separatorModelByItemId,
    separatorModelInstalled,
    separatorModelSource,
} from './separator-models';
import {
    COMPONENT_SPECS,
    componentSpec,
    estimateComponentBytes,
    isVariantUsable,
    JVNV_MODEL_NAMES,
    resolveComponentSpec,
    SEPARATOR_LITE_VERSION,
    MODEL_SPECS,
    readyItemId,
    PYTHON_SPEC,
    pythonExecutable,
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
    LibraryItemGroup,
    LibraryItemResult,
    LibraryItemStatus,
    LibraryProgress,
    LibraryRemoveResult,
    LibraryStatus,
    VoiceComponentId,
    VoiceFeatureId,
    VoicePlatformInfo,
} from '../../../shared/voice/types';
import type {
    MovableStorageKind,
    StorageMoveDecisions,
    StorageMovePlan,
    StorageMoveResult,
} from '../../../shared/types';
import { checkMergeTarget, mergeStorage, planStorageMove, removeStorageRoot } from './storage-merge';
import { whileStorageMoving } from './training-sets';

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
    componentSpec: ComponentSpec,
    manifest: LibraryManifest,
    platform: VoicePlatformInfo
): LibraryItemStatus {
    // その環境で使う定義 (PyTorch を使えない環境の分離・加工は軽いパッケージ一式) と照らし合わせる
    const spec = resolveComponentSpec(componentSpec, platform);
    const entry = manifest.components[spec.id];
    if (!entry) return 'missing';
    if (entry.broken || !fs.existsSync(envPythonExecutable(spec.env))) return 'broken';
    if (spec.source && !fs.existsSync(libraryPaths().source(sourceOwner(spec)))) return 'broken';
    if (entry.version !== spec.version || !isVariantUsable(entry.variant, platform)) return 'outdated';
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

// その環境で確実に使えない項目か (ダウンロードの画面に出さず、取得もさせない)。PyTorch の配布物が無い環境
// (Intel 版 Mac・macOS 14 より前の macOS) の、音声変換・読み上げのもの (パッケージ一式・モデル) と分離のモデルが当てはまる
function isItemHidden(platform: VoicePlatformInfo, group: LibraryItemGroup, kind: LibraryItem['kind']): boolean {
    if (!platform.supported || separationModelsAvailable(platform)) return false;
    return group === 'converter' || group === 'tts' || (group === 'separator' && kind === 'model');
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
        const spec = resolveComponentSpec(COMPONENT_SPECS.find(item => item.id === id) as ComponentSpec, platform);
        const group: LibraryItemGroup =
            spec.env === 'separator' ? 'separator' : spec.env === 'converter' ? 'converter' : 'tts';
        if (isItemHidden(platform, group, 'component')) continue;
        const trainingOnly = id === 'tts-train';
        const available = supported && (!trainingOnly || platform.ttsTrainingAvailable);
        items.push({
            id: componentItemId(id),
            kind: 'component',
            group,
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
        if (isItemHidden(platform, spec.group, 'model')) continue;
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
            readsLanguages: spec.readsLanguages,
        });
    }
    // 分離のモデルは、使えない環境では一覧も取得済みのものも出さない
    if (isItemHidden(platform, 'separator', 'model')) return items;
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
                separator: {
                    category: model.category,
                    arch: model.arch,
                    stems: model.stems,
                    sdr: model.sdr,
                },
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
    const list = readSeparatorModelList();
    return {
        platform,
        items: buildItems(platform, manifest),
        separatorModelsListed: list !== null,
        separatorEnsembles: (list?.ensembles ?? []).map(ensemble => ({
            id: ensemble.id,
            name: ensemble.name,
            category: ensemble.category,
            models: ensemble.models.map(separatorItemId),
        })),
    };
}

export async function checkFeature(feature: VoiceFeatureId, extra: string[] = []): Promise<FeatureReadiness> {
    const status = await getLibraryStatus();
    const byId = new Map(status.items.map(item => [item.id, item]));
    const missing = [...requiredItems(feature), ...extra].filter(id => byId.get(id)?.status !== 'installed');
    return {
        ready: isFeatureAvailable(status.platform, feature) && missing.length === 0,
        missing,
        platform: status.platform,
    };
}

// パッケージ一式が取得済みで、版がこのアプリの定義と合っているか (更新が必要なものは含めない)
export async function isComponentCurrent(id: ComponentItemId): Promise<boolean> {
    return componentStatus(componentSpec(id), readManifest(), await getPlatformInfo()) === 'installed';
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
// 画面ごとに別のジョブとして同時に始められるため (すぐに使えるモデルの取得とダウンロードの画面など)、
// 同じ仮想環境への同時の導入や、導入中の pip のキャッシュの削除が起きないようにする
let libraryQueue: Promise<unknown> = Promise.resolve();

// 起動時の、前回の導入の残りの削除が終わってから始める (削除と導入が同じファイルを扱わないように)
function withLibraryLock<T>(task: () => Promise<T>): Promise<T> {
    const start = () => installLeftoversRemoved().then(task);
    const run = libraryQueue.then(start, start);
    libraryQueue = run.catch(() => undefined);
    return run;
}

// ライブラリの中身を変える処理は、ほかの処理 (学習・分離・変換など) の実行中は行わない。
// それらの処理は仮想環境やモデルのファイルを使っており、入れ替え・削除・移動すると処理が失敗したり、
// 使用中のファイルを消せずに中途半端な状態が残ったりするため。ownJobId はその処理自身のジョブ
function checkLibraryIdle(ownJobId: string | null): void {
    if (countActiveJobsExcept(ownJobId) > 0) throw new Error('LIBRARY_BUSY');
}

export async function downloadItems(jobId: string, ids: string[]): Promise<LibraryDownloadResult> {
    startJob(jobId);
    const controller = new AbortController();
    const unregister = onJobCancel(jobId, () => controller.abort());
    const results: LibraryItemResult[] = [];
    try {
        checkLibraryIdle(jobId);
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
    // pip のキャッシュ (PyTorch など数 GB) は、全て成功した場合とキャンセルした場合 (取得しなかったことにする) に消す。
    // 意図しない失敗の場合は、アプリを起動している間の再試行に使うため残す (次の起動時に消す)
    // (消せなかった場合は、次の起動時に消す。removeInstallLeftovers)
    if (cancelled || failed.size === 0) {
        await fs.promises
            .rm(libraryPaths().pipCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
            .catch(error => console.warn('failed to remove the pip cache', error));
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
        // 分離のモデルを使えない環境のパッケージ一式には、モデルの一覧を作るためのライブラリ (audio-separator) が無い
        if (component.id === 'separator' && separationModelsAvailable(platform)) {
            // 分離モデルの一覧は導入したパッケージから取得する (取得できなければこの項目を失敗とする)
            // (一覧を開いている画面からの同時の作成と、問い合わせを 1 回にまとめる)
            forgetSeparatorModelList();
            await ensureSeparatorModelList();
            void probeSeparatorSizes().catch(error => console.warn('failed to look up separation model sizes', error));
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
        // ライブラリのディレクトリごと消す (仮想環境・ソース一式)。キャッシュディレクトリのそのライブラリの
        // ディレクトリ (ライブラリが作ったキャッシュ・分離のモデル一覧) も、使うものが無くなるため一緒に消す
        await fs.promises.rm(lib.library(spec.env), { recursive: true, force: true });
        await fs.promises
            .rm(libraryCacheDirOf(spec.env), { recursive: true, force: true })
            .catch(error => console.warn(`failed to remove the cache of ${spec.env}`, error));
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
            // 展開したデータと、展開の途中で止まったもの (.staging) も消す
            const extracted = full.slice(0, -'.zip'.length);
            await fs.promises.rm(extracted, { recursive: true, force: true });
            await fs.promises.rm(`${extracted}.staging`, { recursive: true, force: true });
        }
        removeEmptyDirs(path.dirname(full), models.root);
    }
    updateManifest(next => {
        delete next.models[itemId];
    });
    // 読み上げのすぐに使えるモデルは、名前と言語の変更の記録も消す (取得し直したときは元の名前と言語で使う)
    const readyModel = JVNV_MODEL_NAMES.find(name => readyItemId(name) === itemId);
    if (readyModel !== undefined) clearReadyModelOverride(readyModel);
}

export async function removeItems(
    ids: string[],
    options: { removePython?: boolean } = {}
): Promise<LibraryRemoveResult> {
    checkLibraryIdle(null);
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

// 仮想環境は Python 本体の場所を pyvenv.cfg に記録しているため、移動後に新しい場所へ書き換える。
// 記録の home (Python 本体の実行ファイルのあるフォルダ) から、仮想環境を作ったときのライブラリディレクトリを求めて
// 置き換える (別の場所や別の端末から写したライブラリも、この端末の場所を指すようにするため)。
// Windows はドライブ名の大文字小文字が違う表記で記録されることがあるため、大文字小文字を区別せずに置き換える
// 書き換えられない (記録が無い・記録の場所がこのアプリの配置ではない) 場合は false を返す (作り直しの対象にする。
// 元の場所の Python を指したままだと、確かめた時点では動いても、元の場所を消した後に動かなくなるため)
function relocateVenv(component: VoiceComponentId, newRoot: string): boolean {
    const cfg = path.join(libraryPaths(newRoot).env(component), 'pyvenv.cfg');
    if (!fs.existsSync(cfg)) return false;
    const text = fs.readFileSync(cfg, 'utf-8');
    const home = /^home\s*=\s*(.+)$/m.exec(text)?.[1].trim();
    const homeRelative = process.platform === 'win32' ? 'python' : path.join('python', 'bin');
    if (!home || !home.toLowerCase().endsWith(`${path.sep}${homeRelative}`.toLowerCase())) return false;
    const fromRoot = home.slice(0, home.length - homeRelative.length - 1);
    const pattern = new RegExp(fromRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    // 置き換え後の文字列は関数で渡す (場所に $ が含まれていても置換パターンとして解釈させないため)
    fs.writeFileSync(
        cfg,
        text.replace(pattern, () => newRoot),
        'utf-8'
    );
    return true;
}

// 移動先 (libraryRoot) の仮想環境が動くかを確かめる。Python が起動して失敗した場合だけ動かない (false) とし、
// 起動できない場合 (作業ディレクトリが無い・実行環境が足りないなど) は仮想環境の問題ではないため、そのまま失敗させる
// probeModule: 読み込んで確かめるモジュール (PyTorch を含めない分離・加工のパッケージ一式では pedalboard)
async function verifyVenv(component: VoiceComponentId, libraryRoot: string, probeModule: string): Promise<boolean> {
    // 仮想環境の Python が無い (写したときに欠けたなど) 場合は、仮想環境が動かないものとする
    if (!fs.existsSync(envPythonExecutable(component, libraryRoot))) return false;
    const result = await runProcess(
        envPythonExecutable(component, libraryRoot),
        ['-c', `import sys, ${probeModule}; print(sys.prefix)`],
        { env: buildPythonEnv(component, {}, libraryRoot) }
    );
    if (result.code === WINDOWS_DLL_NOT_FOUND) throw new Error('VC_RUNTIME_MISSING');
    return result.code === 0;
}

type MovableStorage = MovableStorageKind;

// 今の保存場所
function storageRoot(kind: MovableStorage): string {
    if (kind === 'library') return getLibraryDir();
    if (kind === 'model') return getModelDir();
    return getCacheDir();
}

// 保存場所を移動する。中身を選んだフォルダへ移し (中身がある場合はまとまりごとにマージする)、
// そのフォルダを新しい保存場所にする。targetDir が null の場合は既定の場所 (~/.kura_toolkit の下) へ戻す。
// decisions は、両方にあるまとまりごとの選択 (上書きするか。planStorageMoveTo で求めたもの)
export async function moveStorage(
    jobId: string,
    kind: MovableStorage,
    targetDir: string | null,
    decisions: StorageMoveDecisions
): Promise<StorageMoveResult> {
    startJob(jobId);
    try {
        checkLibraryIdle(jobId);
        const newRoot = moveTarget(kind, targetDir);
        // 既定の場所へ移した場合は設定を空にする (既定の場所に従わせる)
        const setting = isSamePath(newRoot, defaultStorageDir(kind)) ? '' : newRoot;
        // 学習セットへの音声の追加 (録音の保存はジョブではない) の途中や、移動中に学習セットを変えると、
        // 古い場所に書かれて移動から漏れるため、移動の前後で学習セットの操作を断る
        return await whileStorageMoving(() => withLibraryLock(() => moveNow(jobId, kind, newRoot, setting, decisions)));
    } finally {
        finishJob(jobId);
    }
}

// 移動先 (targetDir が null の場合は既定の場所)
function moveTarget(kind: MovableStorage, targetDir: string | null): string {
    return targetDir === null ? defaultStorageDir(kind) : path.resolve(targetDir);
}

// 移動を始める前に、移動先を選べるかを確かめ、両方にあるまとまり (上書きするかを選ぶもの) を求める
// (確認画面を出す前に知らせるため)
export async function planStorageMoveTo(kind: MovableStorage, targetDir: string | null): Promise<StorageMovePlan> {
    const oldRoot = storageRoot(kind);
    const newRoot = moveTarget(kind, targetDir);
    if (isSamePath(oldRoot, newRoot)) return { conflicts: [], transferCount: 0, transferBytes: 0 };
    checkMoveTarget(kind, oldRoot, newRoot);
    return planStorageMove(kind, oldRoot, newRoot);
}

// 移動先の確認。今の場所の中・外側、ほかの保存場所や作業ディレクトリと重なる場所は選べない。
// 中身のある移動先は、同じ種類の保存場所に限る (他のファイルと混ぜないため)
function checkMoveTarget(kind: MovableStorage, oldRoot: string, newRoot: string): void {
    if (isSameOrNested(oldRoot, newRoot) || isSameOrNested(newRoot, oldRoot)) throw new Error('STORAGE_MOVE_NESTED');
    const others = (['library', 'model', 'cache'] as const).filter(item => item !== kind).map(storageRoot);
    if ([...others, getWorkDir()].some(other => isSameOrNested(other, newRoot))) {
        throw new Error('STORAGE_OVERLAP');
    }
    checkMergeTarget(kind, newRoot);
}

// 移動先を保存場所として設定に書き込む。書き込めなかった場合は、移動は終わっているが次の起動で元の場所を
// 使ってしまうため SETTINGS_SAVE_FAILED で失敗として知らせる (起動中の設定も元の場所のまま変えない)
function saveStorageSetting(kind: MovableStorage, setting: string): void {
    const keys = { library: 'libraryDir', model: 'modelDir', cache: 'cacheDir' } as const;
    saveSettings({ storage: { [keys[kind]]: setting } });
}

const CANCELLED_MOVE: StorageMoveResult = { cancelled: true, rebuildRequired: [], remainingPath: null };

// 移動先の仮想環境の記録 (pyvenv.cfg) を新しい場所へ書き換えて動作を確かめ、動かないものを作り直しの対象として
// 移動先の取得状況の記録に残す。作り直しの対象を返す
async function relocateVenvs(newRoot: string): Promise<string[]> {
    const manifest = readManifest({ library: newRoot });
    const rebuildRequired: string[] = [];
    const specs = COMPONENT_SPECS.filter(spec => manifest.components[spec.id] && spec.id !== 'tts-train');
    // 記録の書き換えは、確認で失敗しても残りの仮想環境が元の場所を指したまま残らないよう、先にすべて行う
    const relocated = new Map(specs.map(spec => [spec.id, relocateVenv(spec.env, newRoot)]));
    // 確認そのものができなかった場合 (VC_RUNTIME_MISSING など) も、残りの仮想環境を確かめてから知らせる
    let verifyError: unknown = null;
    for (const spec of specs) {
        let works: boolean;
        try {
            // PyTorch を含めない分離・加工のパッケージ一式 (PyTorch を使えない環境で入れたもの) は pedalboard で確かめる
            const probeModule =
                manifest.components[spec.id]?.version === SEPARATOR_LITE_VERSION ? 'pedalboard' : 'torch';
            works = relocated.get(spec.id) === true && (await verifyVenv(spec.env, newRoot, probeModule));
        } catch (error) {
            verifyError ??= error;
            continue;
        }
        if (!works) {
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
    if (verifyError !== null) throw verifyError;
    return rebuildRequired;
}

// 補助プロセスは保存場所を起動時に受け取るため、止めてから移す
async function moveNow(
    jobId: string,
    kind: MovableStorage,
    newRoot: string,
    setting: string,
    decisions: StorageMoveDecisions
): Promise<StorageMoveResult> {
    // 先に始まった処理を待つ間と、補助プロセスの終了を待つ間に中断された場合は、何も移さずに終える
    if (isCancelled(jobId)) return CANCELLED_MOVE;
    await stopAllWorkersAndWait();
    if (isCancelled(jobId)) return CANCELLED_MOVE;
    const oldRoot = storageRoot(kind);
    if (isSamePath(oldRoot, newRoot)) return { cancelled: false, rebuildRequired: [], remainingPath: null };
    checkMoveTarget(kind, oldRoot, newRoot);

    if (fs.existsSync(oldRoot)) {
        const merged = await mergeStorage(jobId, kind, oldRoot, newRoot, decisions);
        if (merged.cancelled) return CANCELLED_MOVE;
    } else {
        fs.mkdirSync(newRoot, { recursive: true });
    }

    // 仮想環境の記録の書き換えと動作の確認は、設定を書き換える前に行う (設定を保存できなかったときに、
    // 仮想環境が元の場所を指したまま残らないようにするため)。確認そのものができなかった場合も、中身は移し終えて
    // いるため設定は書き換えてから失敗を知らせる
    let rebuildRequired: string[] = [];
    let relocateError: unknown = null;
    if (kind === 'library') {
        try {
            rebuildRequired = await relocateVenvs(newRoot);
        } catch (error) {
            relocateError = error;
        }
    }
    saveStorageSetting(kind, setting);
    // 分離のモデル一覧はキャッシュディレクトリに置き、ライブラリの版で作り直すため、どちらを移しても読み直させる
    if (kind === 'library' || kind === 'cache') forgetSeparatorModelList();
    // 移動元は、上書きしなかったまとまりも含めて最後に消す
    const removed = fs.existsSync(oldRoot) ? await removeStorageRoot(oldRoot) : true;
    if (relocateError !== null) throw relocateError;
    return { cancelled: false, rebuildRequired, remainingPath: removed ? null : oldRoot };
}
