import { parentPort, workerData, type MessagePort } from 'worker_threads';
import {
    ADS_CHUNK_SIZE,
    scanAdsCandidates,
    scanCleanupDirectory,
    type DirectoryScanResult,
} from '../services/cleanup-targets';
import {
    currentPathView,
    FLAG_CANCELLED,
    FLAG_IDLE_WORKERS,
    writeCurrentPath,
    type WalkerInit,
    type WalkerRequest,
    type WalkerResponse,
    type WalkTask,
} from '../services/dir-walker-protocol';
import type { CleanupItem } from '../../shared/types';

// ディレクトリ走査ワーカー。
// 作業単位はディレクトリ 1 個か、ADS 判定だけを行うファイル群。配下のサブディレクトリは
// 自分のローカルキューに積んでそのまま再帰し、手が空いたワーカーがいるときだけ分けて親へ返す。
//
// fs は同期版 (readdirSync / statSync) を使う。ワーカーのイベントループは塞いでよく、
// 非同期版の libuv ディスパッチ往復を丸ごと省けるため実測で明確に速い。
//
// electron は import しない (ワーカーからは使えない)。

// 進捗と結果をまとめて送る間隔
const REPORT_INTERVAL_MS = 150;
// このタスク数ごとにイベントループへ譲り、親からのメッセージを受け取れるようにする
const YIELD_EVERY_TASKS = 256;
// 手が空いたワーカーへ渡す前に、自分のローカルキューへ最低限残す数
const SPILL_KEEP = 2;

function requireParentPort(): MessagePort {
    if (!parentPort) throw new Error('dir-walker-worker must be started as a worker thread');
    return parentPort;
}

const init = workerData as WalkerInit;
const port = requireParentPort();

const flags = new Int32Array(init.flags);
const current = currentPathView(init.current);

// ローカルの作業キュー (深さ優先。末尾から取り出す)
const stack: WalkTask[] = [];
let running = false;

// 前回の報告以降にたまったぶん
let pendingItems: CleanupItem[] = [];
let pendingErrors: string[] = [];
let pendingDirs = 0;
let lastReportAt = 0;

// scanCleanupDirectory の受け皿 (使い回して確保を減らす)
const out: DirectoryScanResult = { items: [], subdirs: [], adsCandidates: [], errors: [] };

function post(message: WalkerResponse): void {
    port.postMessage(message);
}

function isCancelled(): boolean {
    return Atomics.load(flags, FLAG_CANCELLED) !== 0;
}

function report(): void {
    lastReportAt = Date.now();
    const items = pendingItems;
    const errors = pendingErrors;
    pendingItems = [];
    pendingErrors = [];
    const dirs = pendingDirs;
    pendingDirs = 0;
    post({ type: 'report', index: init.index, items, errors, dirs });
}

// 手が空いているワーカーがいれば、ローカルキューの半分を親へ返す。
// キューの先頭側 (浅い階層) を渡すことで、渡した側は深さ優先の局所性を保てる
function spillIfNeeded(): void {
    if (stack.length <= SPILL_KEEP) return;
    if (Atomics.load(flags, FLAG_IDLE_WORKERS) <= 0) return;
    const giveCount = Math.floor(stack.length / 2);
    if (giveCount <= 0) return;
    post({ type: 'spill', index: init.index, tasks: stack.splice(0, giveCount) });
}

// ディレクトリ 1 個を走査し、サブディレクトリと ADS 判定をローカルキューへ積む
function runDirectoryTask(dir: string): void {
    out.items.length = 0;
    out.subdirs.length = 0;
    out.adsCandidates.length = 0;
    out.errors.length = 0;
    scanCleanupDirectory(dir, init.config, out);
    pendingDirs += 1;
    if (out.items.length > 0) pendingItems.push(...out.items);
    if (out.errors.length > 0) pendingErrors.push(...out.errors);
    for (const subdir of out.subdirs) stack.push({ kind: 'dir', path: subdir });
    // ファイルが多いディレクトリは ADS 判定を切り出して他スレッドへ回せるようにする。
    // 少ないうちは切り出さずその場で済ませる (タスク化のほうが高くつくため)
    if (out.adsCandidates.length === 0) return;
    if (out.adsCandidates.length <= ADS_CHUNK_SIZE) {
        scanAdsCandidates(out.adsCandidates, pendingItems);
        return;
    }
    for (let offset = 0; offset < out.adsCandidates.length; offset += ADS_CHUNK_SIZE) {
        stack.push({ kind: 'ads', dir, paths: out.adsCandidates.slice(offset, offset + ADS_CHUNK_SIZE) });
    }
}

// ADS 判定のチャンクは 1 個あたり数 ms で終わるため、
// キャンセルの判定は呼び出し元のループ先頭だけで足りる
function runAdsTask(paths: string[]): void {
    scanAdsCandidates(paths, pendingItems);
}

async function run(): Promise<void> {
    running = true;
    let sinceYield = 0;
    while (stack.length > 0) {
        if (isCancelled()) break;
        const task = stack.pop() as WalkTask;
        // 処理を始める前に書く。fs の呼び出しの中で止まっても、止まっている場所が main から見える
        writeCurrentPath(current, task.kind === 'dir' ? task.path : task.dir);
        if (task.kind === 'dir') {
            runDirectoryTask(task.path);
        } else {
            runAdsTask(task.paths);
        }

        spillIfNeeded();
        if (Date.now() - lastReportAt >= REPORT_INTERVAL_MS) report();
        if (++sinceYield >= YIELD_EVERY_TASKS) {
            sinceYield = 0;
            await new Promise<void>(resolve => setImmediate(resolve));
        }
    }
    running = false;
    writeCurrentPath(current, null);
    report();
    post({ type: 'idle', index: init.index });
}

port.on('message', (message: WalkerRequest) => {
    if (message.type !== 'tasks') return;
    for (const task of message.tasks) stack.push(task);
    // 走査を終えて待機していた場合はここから再開する
    if (!running) void run();
});
