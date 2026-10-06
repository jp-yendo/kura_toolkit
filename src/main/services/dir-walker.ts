import path from 'path';
import { Worker } from 'worker_threads';
import {
    ADS_CHUNK_SIZE,
    scanAdsCandidates,
    scanCleanupDirectory,
    type CleanupScanConfig,
    type DirectoryScanResult,
} from './cleanup-targets';
import {
    FLAG_CANCELLED,
    FLAG_COUNT,
    FLAG_IDLE_WORKERS,
    type WalkerInit,
    type WalkerRequest,
    type WalkerResponse,
    type WalkTask,
} from './dir-walker-protocol';
import type { CleanupItem } from '../../shared/types';

// ディレクトリ走査の並列実行。
// 作業単位はディレクトリ 1 個で、ワーカーは受け取ったディレクトリを起点に自分のローカルキューで
// 再帰し、手が空いたワーカーがいるときだけキューを分けて返す (spill)。
// 1 ディレクトリごとに親と往復すると、走査そのものよりメッセージの往復が高くつくため。

// 空いたワーカーへ一度に渡すディレクトリ数
const DISPATCH_BATCH = 8;
// キャンセル要求を拾う間隔
const CANCEL_POLL_MS = 100;
// 進捗を呼び出し元へ通知する間隔
const PROGRESS_INTERVAL_MS = 150;
// main 側で先読み展開するときの目安 (1 スレッドあたりのディレクトリ数) と最大階層
const SEED_DIRS_PER_THREAD = 8;
const SEED_MAX_DEPTH = 2;
// ワーカーを使わない場合に、イベントループへ譲るまでのディレクトリ数。
// main プロセス上で動くため、ワーカー内より短い間隔で譲る
const INPROCESS_YIELD_EVERY_DIRS = 32;

type WalkOptions = {
    roots: string[];
    config: CleanupScanConfig;
    // 走査に使うスレッド数 (1 ならワーカーを起こさず同一プロセスで走査する)
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
// asarUnpack で展開する必要はない (Electron 43 で確認済み)
function resolveWorkerPath(): string {
    return path.join(__dirname, '..', 'workers', 'dir-walker-worker.js');
}

// 走査結果をディレクトリ単位で並列に集める。
// ワーカーを起動できない環境でも動くよう、失敗時は同一プロセスの走査に落とす
export async function walkCleanupTargets(options: WalkOptions): Promise<WalkResult> {
    if (options.threads > 1) {
        try {
            const seed = await seedQueue(options);
            const result = await walkWithWorkers(options, seed);
            return {
                items: [...seed.items, ...result.items],
                errors: [...seed.errors, ...result.errors],
                cancelled: result.cancelled,
            };
        } catch (error) {
            // ワーカーが起動できない/途中で落ちた場合。結果が欠けたまま返さないよう逐次走査でやり直す。
            // 黙って遅いまま動き続けないよう理由を残す
            console.warn(
                `dir-walker: worker threads unavailable, falling back to single-threaded scan: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }
    return walkInProcess(options);
}

// ワーカーへ配る前に、ルートの浅い階層だけを main 側で展開しておく。
// 最初から全スレッドへ十分な量が行き渡るようにするためで、
// これが無いと序盤は 1 スレッドしか動けず、走査中のやり取りも増える
type SeedResult = { queue: WalkTask[]; items: CleanupItem[]; errors: string[]; visitedDirs: number };

async function seedQueue(options: WalkOptions): Promise<SeedResult> {
    const items: CleanupItem[] = [];
    const errors: string[] = [];
    const adsTasks: WalkTask[] = [];
    const out: DirectoryScanResult = { items: [], subdirs: [], adsCandidates: [], errors: [] };
    let visitedDirs = 0;
    let level = [...options.roots];
    // 1 スレッドあたり数個ずつ行き渡る量を目安にする
    const target = options.threads * SEED_DIRS_PER_THREAD;

    for (let depth = 0; depth < SEED_MAX_DEPTH && level.length < target && level.length > 0; depth++) {
        const next: string[] = [];
        for (const dir of level) {
            if (options.isCancelled()) break;
            out.items.length = 0;
            out.subdirs.length = 0;
            out.adsCandidates.length = 0;
            out.errors.length = 0;
            scanCleanupDirectory(dir, options.config, out);
            visitedDirs += 1;
            if (out.items.length > 0) items.push(...out.items);
            errors.push(...out.errors);
            next.push(...out.subdirs);
            // 展開したディレクトリ自身の ADS 判定はワーカーへ回す (main を止めないため)
            for (let offset = 0; offset < out.adsCandidates.length; offset += ADS_CHUNK_SIZE) {
                adsTasks.push({ kind: 'ads', dir, paths: out.adsCandidates.slice(offset, offset + ADS_CHUNK_SIZE) });
            }
        }
        level = next;
        // 展開のあいだ main プロセスを止めないよう階層ごとに譲る
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    const queue: WalkTask[] = level.map(dir => ({ kind: 'dir', path: dir }));
    return { queue: [...adsTasks, ...queue], items, errors, visitedDirs };
}

function walkWithWorkers(options: WalkOptions, seed: SeedResult): Promise<WalkResult> {
    const workerPath = resolveWorkerPath();
    const flagsBuffer = new SharedArrayBuffer(FLAG_COUNT * Int32Array.BYTES_PER_ELEMENT);
    const flags = new Int32Array(flagsBuffer);
    const workers: Worker[] = [];
    try {
        for (let index = 0; index < options.threads; index++) {
            const init: WalkerInit = { index, config: options.config, flags: flagsBuffer };
            workers.push(new Worker(workerPath, { workerData: init }));
        }
    } catch (error) {
        for (const worker of workers) void worker.terminate();
        throw error;
    }

    return new Promise<WalkResult>((resolve, reject) => {
        const queue: WalkTask[] = [...seed.queue];
        const items: CleanupItem[] = [];
        const errors: string[] = [];
        const workerPaths: (string | null)[] = new Array<string | null>(workers.length).fill(null);
        const idle = new Set<number>();
        // 起動に失敗したり途中で落ちたワーカー。仕事を渡す相手からも完了判定からも除く
        // (これをしないと、返事の来ないワーカーを待ち続けて終わらなくなる)
        const dead = new Set<number>();
        // 先読みで走査した分を進捗の初期値にする (最終結果と件数がずれないようにするため)
        let visitedDirs = seed.visitedDirs;
        let cancelled = false;
        let settled = false;

        const emitProgress = () => options.onProgress(visitedDirs, seed.items.length + items.length, [...workerPaths]);

        const cancelTimer = setInterval(() => {
            if (cancelled || !options.isCancelled()) return;
            cancelled = true;
            // メッセージの往復を待たずに全ワーカーへ伝わる
            Atomics.store(flags, FLAG_CANCELLED, 1);
        }, CANCEL_POLL_MS);
        const progressTimer = setInterval(emitProgress, PROGRESS_INTERVAL_MS);

        const finish = () => {
            if (settled) return;
            settled = true;
            clearInterval(cancelTimer);
            clearInterval(progressTimer);
            for (const worker of workers) void worker.terminate();
            workerPaths.fill(null);
            // ワーカーが 1 つでも落ちていたら、そのワーカーに渡してあった分は取り戻せず
            // 結果が欠けている。検出漏れを黙って返さないよう、呼び出し元の逐次走査でやり直す
            if (dead.size > 0) {
                reject(new Error(errors[0] ?? 'a walker thread failed'));
                return;
            }
            emitProgress();
            resolve({ items, errors, cancelled });
        };

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

        // 走査を終えたワーカーに次の仕事を渡す。渡すものが無ければ待機させる
        const markIdle = (index: number) => {
            if (!settled && !dead.has(index) && queue.length > 0) {
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
                if (queue.length === 0) break;
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
            workerPaths[index] = null;
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
                    if (message.items.length > 0) items.push(...message.items);
                    errors.push(...message.errors);
                    visitedDirs += message.dirs;
                    workerPaths[message.index] = message.current;
                    return;
                }
                if (message.type === 'spill') {
                    queue.push(...message.tasks);
                    feedIdleWorkers();
                    return;
                }
                workerPaths[message.index] = null;
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

// ワーカーを使わない走査。スレッド数 1 の指定時とワーカー起動失敗時の両方で使う
async function walkInProcess(options: WalkOptions): Promise<WalkResult> {
    const stack: string[] = [...options.roots];
    const items: CleanupItem[] = [];
    const errors: string[] = [];
    const out: DirectoryScanResult = { items: [], subdirs: [], adsCandidates: [], errors: [] };
    let visitedDirs = 0;
    let cancelled = false;
    let lastProgressAt = 0;
    let sinceYield = 0;
    let currentDir: string | null = null;

    while (stack.length > 0) {
        if (options.isCancelled()) {
            cancelled = true;
            break;
        }
        const dir = stack.pop() as string;
        currentDir = dir;
        out.items.length = 0;
        out.subdirs.length = 0;
        out.adsCandidates.length = 0;
        out.errors.length = 0;
        scanCleanupDirectory(dir, options.config, out);
        // 1 スレッドなので分割する意味は無く、その場でまとめて判定する
        scanAdsCandidates(out.adsCandidates, out.items);
        visitedDirs += 1;
        if (out.items.length > 0) items.push(...out.items);
        errors.push(...out.errors);
        for (const subdir of out.subdirs) stack.push(subdir);

        if (Date.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            lastProgressAt = Date.now();
            options.onProgress(visitedDirs, items.length, [currentDir]);
        }
        if (++sinceYield >= INPROCESS_YIELD_EVERY_DIRS) {
            sinceYield = 0;
            await new Promise<void>(resolve => setImmediate(resolve));
        }
    }
    options.onProgress(visitedDirs, items.length, [null]);
    return { items, errors, cancelled };
}
