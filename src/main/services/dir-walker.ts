import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import {
    ADS_CHUNK_SIZE,
    classifyDirectoryEntries,
    scanAdsCandidatesAsync,
    type CleanupScanConfig,
    type DirectoryScanResult,
} from './cleanup-targets';
import {
    createCurrentPathBuffer,
    currentPathView,
    FLAG_CANCELLED,
    FLAG_COUNT,
    FLAG_IDLE_WORKERS,
    readCurrentPath,
    type WalkerInit,
    type WalkerRequest,
    type WalkerResponse,
    type WalkTask,
} from './dir-walker-protocol';
import { appendAll } from '../utils/array';
import type { CleanupItem } from '../../shared/types';

// ディレクトリ走査の並列実行。
// 作業単位はディレクトリ 1 個で、ワーカーは受け取ったディレクトリを起点に自分のローカルキューで
// 再帰し、手が空いたワーカーがいるときだけキューを分けて返す (spill)。
// 1 ディレクトリごとに親と往復すると、走査そのものよりメッセージの往復が高くつくため。
// fs の呼び出しはすべてワーカーか非同期 API で行い、main プロセスのイベントループを塞がない
// (応答しないネットワークドライブなどで 1 回の呼び出しが長く返らないことがあるため)。

// 空いたワーカーへ一度に渡すディレクトリ数
const DISPATCH_BATCH = 8;
// キャンセル要求を拾う間隔
const CANCEL_POLL_MS = 100;
// キャンセル後、ワーカーが手を止めて報告してくるのを待つ時間。
// これを過ぎても戻らないワーカー (fs の呼び出しの中で止まっているもの) は待たずに終える
const CANCEL_GRACE_MS = 1000;
// 進捗を呼び出し元へ通知する間隔
const PROGRESS_INTERVAL_MS = 150;

type WalkOptions = {
    roots: string[];
    config: CleanupScanConfig;
    // 走査に使うスレッド (ワーカー) の数
    threads: number;
    isCancelled: () => boolean;
    // 走査済みディレクトリ数・発見件数・スレッドごとの現在位置
    onProgress: (visitedDirs: number, foundCount: number, workers: (string | null)[]) => void;
};

type WalkResult = {
    items: CleanupItem[];
    errors: string[];
    cancelled: boolean;
};

// ワーカーの実体パス。asar の中のファイルもそのまま Worker のエントリにできるため、
// asarUnpack で展開する必要はない (Electron 45 で確認済み)
function resolveWorkerPath(): string {
    return path.join(__dirname, '..', 'workers', 'dir-walker-worker.js');
}

// 走査結果をディレクトリ単位で並列に集める。
// ワーカーを起動できない環境でも動くよう、失敗時は main プロセス上の非同期の走査に落とす
export async function walkCleanupTargets(options: WalkOptions): Promise<WalkResult> {
    try {
        return await walkWithWorkers(options);
    } catch (error) {
        // ワーカーが起動できない/途中で落ちた場合。結果が欠けたまま返さないよう逐次走査でやり直す。
        // 黙って遅いまま動き続けないよう理由を残す
        console.warn(
            `dir-walker: worker threads unavailable, falling back to in-process scan: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
    return walkInProcess(options);
}

function walkWithWorkers(options: WalkOptions): Promise<WalkResult> {
    const workerPath = resolveWorkerPath();
    const threads = Math.max(1, options.threads);
    const flagsBuffer = new SharedArrayBuffer(FLAG_COUNT * Int32Array.BYTES_PER_ELEMENT);
    const flags = new Int32Array(flagsBuffer);
    const currentBuffers = Array.from({ length: threads }, () => createCurrentPathBuffer());
    const currentViews = currentBuffers.map(currentPathView);
    const workers: Worker[] = [];
    try {
        for (let index = 0; index < threads; index++) {
            const init: WalkerInit = {
                index,
                config: options.config,
                flags: flagsBuffer,
                current: currentBuffers[index],
            };
            workers.push(new Worker(workerPath, { workerData: init }));
        }
    } catch (error) {
        for (const worker of workers) void worker.terminate();
        throw error;
    }

    return new Promise<WalkResult>((resolve, reject) => {
        // 最初はルートだけを配り、走査中のワーカーが手の空いたワーカーへ分けていく
        const queue: WalkTask[] = options.roots.map(root => ({ kind: 'dir', path: root }));
        const items: CleanupItem[] = [];
        const errors: string[] = [];
        // 共有メモリを読めなかった (書き込みと重なった) ときに出す、前回読めた現在位置
        const lastPaths: (string | null)[] = new Array<string | null>(workers.length).fill(null);
        const idle = new Set<number>();
        // 起動に失敗したり途中で落ちたワーカー。仕事を渡す相手からも完了判定からも除く
        // (これをしないと、返事の来ないワーカーを待ち続けて終わらなくなる)
        const dead = new Set<number>();
        let visitedDirs = 0;
        let cancelled = false;
        let settled = false;
        let cancelGraceTimer: NodeJS.Timeout | undefined;

        // 現在位置はワーカーとのメッセージではなく共有メモリから読む。
        // fs の呼び出しの中で止まっているワーカーも、止まっているディレクトリが分かる
        const readWorkerPaths = (): (string | null)[] =>
            currentViews.map((view, index) => {
                if (dead.has(index)) return null;
                const value = readCurrentPath(view);
                if (value !== undefined) lastPaths[index] = value;
                return lastPaths[index];
            });

        const emitProgress = () => options.onProgress(visitedDirs, items.length, readWorkerPaths());

        const finish = () => {
            if (settled) return;
            settled = true;
            clearInterval(cancelTimer);
            clearInterval(progressTimer);
            clearTimeout(cancelGraceTimer);
            // fs の呼び出しの中で止まっているワーカーは、その呼び出しが返るまで実際には終わらないが、
            // 終わりは待たない (待つと、止まったワーカーのために走査全体が終わらなくなる)
            for (const worker of workers) void worker.terminate();
            // ワーカーが 1 つでも落ちていたら、そのワーカーに渡してあった分は取り戻せず
            // 結果が欠けている。検出漏れを黙って返さないよう、呼び出し元の逐次走査でやり直す。
            // キャンセルした場合は結果が途中までなのが前提なので、やり直さずにそのまま返す
            if (dead.size > 0 && !cancelled) {
                reject(new Error(errors[0] ?? 'a walker thread failed'));
                return;
            }
            options.onProgress(
                visitedDirs,
                items.length,
                workers.map(() => null)
            );
            resolve({ items, errors, cancelled });
        };

        const cancelTimer = setInterval(() => {
            if (cancelled || !options.isCancelled()) return;
            cancelled = true;
            // メッセージの往復を待たずに全ワーカーへ伝わる
            Atomics.store(flags, FLAG_CANCELLED, 1);
            // 手を止めたワーカーの報告を少しだけ待ち、戻らないワーカーがいても終える
            cancelGraceTimer = setTimeout(finish, CANCEL_GRACE_MS);
        }, CANCEL_POLL_MS);
        const progressTimer = setInterval(emitProgress, PROGRESS_INTERVAL_MS);

        // 待機中と脱落を合わせて全員そろえば、これ以上進まないので終了する
        const finishIfDone = () => {
            if (idle.size + dead.size === workers.length) finish();
        };

        // 待機中のワーカーで割り切れる量をまとめて渡す。
        // 1 回に少しずつ渡すと、そのたびにワーカーが手を止めて次の指示を待つことになる
        const dispatch = (index: number) => {
            if (idle.delete(index)) Atomics.sub(flags, FLAG_IDLE_WORKERS, 1);
            const share = Math.ceil(queue.length / Math.max(idle.size + 1, 1));
            const tasks = queue.splice(0, Math.max(DISPATCH_BATCH, share));
            const request: WalkerRequest = { type: 'tasks', tasks };
            workers[index].postMessage(request);
        };

        // 仕事を渡してよい状態か (キャンセル後は渡しても即座に戻ってくるだけなので渡さない)
        const canDispatch = () => !settled && !cancelled && queue.length > 0;

        // 走査を終えたワーカーに次の仕事を渡す。渡すものが無ければ待機させる
        const markIdle = (index: number) => {
            if (!dead.has(index) && canDispatch()) {
                dispatch(index);
                return;
            }
            if (!dead.has(index) && !idle.has(index)) {
                idle.add(index);
                Atomics.add(flags, FLAG_IDLE_WORKERS, 1);
            }
            finishIfDone();
        };

        // 待機中のワーカーへキューを配り直す
        const feedIdleWorkers = () => {
            for (const index of [...idle]) {
                if (!canDispatch()) break;
                dispatch(index);
            }
        };

        // ワーカーが落ちたとき。渡してあった仕事は取り戻せないが、
        // 少なくとも待ち続けて終わらなくなることは避ける
        const markDead = (index: number, reason: string) => {
            if (settled || dead.has(index)) return;
            errors.push(`walker#${index}: ${reason}`);
            if (idle.delete(index)) Atomics.sub(flags, FLAG_IDLE_WORKERS, 1);
            dead.add(index);
            if (idle.size + dead.size === workers.length) {
                finish();
                return;
            }
            // 生き残りへ配り直す
            feedIdleWorkers();
        };

        workers.forEach((worker, index) => {
            worker.on('message', (message: WalkerResponse) => {
                if (settled) return;
                if (message.type === 'report') {
                    appendAll(items, message.items);
                    appendAll(errors, message.errors);
                    visitedDirs += message.dirs;
                    return;
                }
                if (message.type === 'spill') {
                    appendAll(queue, message.tasks);
                    feedIdleWorkers();
                    return;
                }
                markIdle(message.index);
            });
            worker.on('error', error => {
                markDead(index, error instanceof Error ? error.message : String(error));
            });
            worker.on('exit', code => {
                // 正常終了は finish() の terminate() 経由なので settled 済み。
                // それ以外で消えた場合だけ脱落として扱う
                markDead(index, `worker exited with code ${code}`);
            });
        });

        // 初期のディレクトリを配る。渡すものが無いワーカーは待機させ、
        // 走査中のワーカーが早めにキューを分けてくれるようにする
        for (let index = 0; index < workers.length; index++) {
            if (queue.length > 0) {
                dispatch(index);
            } else {
                idle.add(index);
                Atomics.add(flags, FLAG_IDLE_WORKERS, 1);
            }
        }
        finishIfDone();
    });
}

// キャンセルされたことを表す値 (Promise.race で fs の呼び出しと競わせる)
const CANCELLED = Symbol('cancelled');

// ADS 判定を一定数ずつ非同期に行う。一度に全件の stat を出すと、
// ファイルが数万あるディレクトリで未完了の要求が積み上がるため区切る
async function scanAdsInChunks(
    paths: string[],
    cancelSignal: Promise<typeof CANCELLED>
): Promise<CleanupItem[] | typeof CANCELLED> {
    const items: CleanupItem[] = [];
    for (let offset = 0; offset < paths.length; offset += ADS_CHUNK_SIZE) {
        const found = await Promise.race([
            scanAdsCandidatesAsync(paths.slice(offset, offset + ADS_CHUNK_SIZE)),
            cancelSignal,
        ]);
        if (found === CANCELLED) return CANCELLED;
        appendAll(items, found);
    }
    return items;
}

// ワーカーを使えないときの走査。main プロセス上で動くため、fs は非同期 API だけを使う。
// fs の呼び出しが返らないままでもキャンセルで抜けられるよう、各呼び出しをキャンセルと競わせる
async function walkInProcess(options: WalkOptions): Promise<WalkResult> {
    const stack: string[] = [...options.roots];
    const items: CleanupItem[] = [];
    const errors: string[] = [];
    const out: DirectoryScanResult = { items: [], subdirs: [], adsCandidates: [], errors: [] };
    let visitedDirs = 0;
    let cancelled = false;
    let currentDir: string | null = null;

    let cancelTimer: NodeJS.Timeout | undefined;
    const cancelSignal = new Promise<typeof CANCELLED>(resolve => {
        cancelTimer = setInterval(() => {
            if (options.isCancelled()) resolve(CANCELLED);
        }, CANCEL_POLL_MS);
    });
    // 処理中の呼び出しが返らなくても、止まっているディレクトリを出し続ける
    const progressTimer = setInterval(
        () => options.onProgress(visitedDirs, items.length, [currentDir]),
        PROGRESS_INTERVAL_MS
    );

    try {
        while (stack.length > 0) {
            if (options.isCancelled()) {
                cancelled = true;
                break;
            }
            const dir = stack.pop() as string;
            currentDir = dir;
            const entries = await Promise.race([
                // アクセスできないディレクトリはスキップ
                fs.promises.readdir(dir, { withFileTypes: true }).catch(() => null),
                cancelSignal,
            ]);
            if (entries === CANCELLED) {
                cancelled = true;
                break;
            }
            visitedDirs += 1;
            if (entries === null) continue;
            out.items.length = 0;
            out.subdirs.length = 0;
            out.adsCandidates.length = 0;
            out.errors.length = 0;
            classifyDirectoryEntries(dir, entries, options.config, out);
            appendAll(items, out.items);
            appendAll(errors, out.errors);
            for (const subdir of out.subdirs) stack.push(subdir);
            if (out.adsCandidates.length > 0) {
                const found = await scanAdsInChunks(out.adsCandidates, cancelSignal);
                if (found === CANCELLED) {
                    cancelled = true;
                    break;
                }
                appendAll(items, found);
            }
        }
    } finally {
        clearInterval(cancelTimer);
        clearInterval(progressTimer);
    }
    options.onProgress(visitedDirs, items.length, [null]);
    return { items, errors, cancelled };
}
