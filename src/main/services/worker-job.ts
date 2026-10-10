import path from 'path';
import { Worker } from 'worker_threads';
import { emitJobEvent, isCancelled, onJobCancel } from './job-manager';
import { isTraceCancelled } from './vector-trace/types';
import type { WorkerHooks, WorkerRequest, WorkerResponse } from './vector-trace/worker-protocol';

// 画像の処理 (vector-trace/ を使うもの) をワーカースレッドで行うジョブ。
// main プロセスのイベントループを塞がないよう、画素ごとの処理と変換ライブラリの呼び出しはワーカーで行う

type WorkerJob<P, R> = {
    // ワーカーのエントリ (workers/ の中のファイル名。拡張子 .js)
    script: string;
    // ワーカーに渡す値 (workerData)
    workerData: unknown;
    onProgress(progress: P): void;
    // ワーカースレッドを起動できないときに、このスレッドで同じ処理を行う
    runInProcess(hooks: WorkerHooks<P>): Promise<R>;
};

// 取り消した後も動き続けているワーカーの終わり (エントリごと)。変換ライブラリの呼び出しは途中で止められないため、
// 取り消したワーカーは今の呼び出しが終わるまで動く。次の処理はその終わりを待ってから始める
// (重なって動くと、メモリと CPU を取り合うため)
const runningWorkers = new Map<string, Promise<void>>();

// 取り消した前のワーカーの終わりを待っていることを知らせる (段階 waitPrevious。進捗バーは不定)
function emitWaitingPrevious(jobId: string): void {
    emitJobEvent({ jobId, kind: 'progress', percent: null, phase: { id: 'waitPrevious' } });
}

// 動いているワーカー (取り消した後も変換ライブラリの呼び出しが終わらずに動いているものを含む) があるか
export function hasRunningImageWorkers(): boolean {
    return runningWorkers.size > 0;
}

// 動いているワーカーがすべて終わるまで待つ。timeoutMs までに終わらなければ待つのをやめる
export async function waitForImageWorkers(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
        Promise.all(runningWorkers.values()),
        new Promise<void>(resolve => {
            timer = setTimeout(resolve, timeoutMs);
        }),
    ]);
    clearTimeout(timer);
}

// エラーの文を、コード付きにする (「コード: 詳細」の形でない文は VECTORIZE_FAILED にする。
// メモリ不足でワーカーが止まったとき (ERR_WORKER_OUT_OF_MEMORY) などは、コードの無い文で届く)
function codedError(message: string): Error {
    return new Error(/^[A-Z][A-Z0-9_]+:/.test(message) ? message : `VECTORIZE_FAILED: ${message}`);
}

// このスレッドで処理を行う。取り消したときは null
async function runInProcess<P, R>(jobId: string, job: WorkerJob<P, R>): Promise<R | null> {
    const controller = new AbortController();
    const stopCancel = onJobCancel(jobId, () => controller.abort());
    try {
        return await job.runInProcess({ signal: controller.signal, onProgress: progress => job.onProgress(progress) });
    } catch (error) {
        if (isTraceCancelled(error)) return null;
        throw codedError(error instanceof Error ? error.message : String(error));
    } finally {
        stopCancel();
    }
}

// 処理をワーカースレッドで行い (ジョブ jobId の取り消しを受け付ける)、結果を返す。取り消したときは、ワーカーの終わりを
// 待たずに null を返す (ワーカーは今の処理が終わったところで止まり、終わりの知らせを受けて片付ける。変換ライブラリの
// 処理中に止めると、ネイティブの処理が終わる前に環境を壊すおそれがあるため)。
// 同じエントリのワーカーが取り消した後も動いているときは、その終わりを待ってから始める。
// 失敗はコード付きのエラーにする (ワーカーが途中で終わったとき (メモリ不足など) とコードの無い失敗は VECTORIZE_FAILED)
export async function runWorkerJob<P, R>(jobId: string, job: WorkerJob<P, R>): Promise<R | null> {
    // sharp は、ワーカースレッドで使う前にこのスレッドで読み込んでおく (共有ライブラリをワーカーの終了後も
    // 読み込んだままにするため。sharp の説明書の求め)
    await import('sharp');
    const previous = runningWorkers.get(job.script);
    if (previous) {
        emitWaitingPrevious(jobId);
        // 待つ間に取り消されたら、待つのをやめる
        let stopWaitCancel: () => void = () => undefined;
        const cancelled = new Promise<void>(resolve => {
            stopWaitCancel = onJobCancel(jobId, resolve);
        });
        await Promise.race([previous, cancelled]);
        stopWaitCancel();
    }
    if (isCancelled(jobId)) return null;
    // asar の中のファイルもそのまま Worker のエントリにできる
    const worker = new Worker(path.join(__dirname, '..', 'workers', job.script), { workerData: job.workerData });
    const exited = new Promise<void>(resolve => worker.once('exit', () => resolve()));
    runningWorkers.set(job.script, exited);
    void exited.then(() => {
        if (runningWorkers.get(job.script) === exited) runningWorkers.delete(job.script);
    });
    return new Promise<R | null>((resolve, reject) => {
        let settled = false;
        let started = false;
        let stopCancel: (() => void) | null = null;
        const settle = (action: () => void) => {
            if (settled) return;
            settled = true;
            stopCancel?.();
            action();
        };
        worker.on('message', (message: WorkerResponse<P, R>) => {
            switch (message.type) {
                case 'started':
                    started = true;
                    break;
                case 'progress':
                    if (!settled) job.onProgress(message.progress);
                    break;
                case 'done':
                    void worker.terminate();
                    settle(() => resolve(message.result));
                    break;
                case 'cancelled':
                    void worker.terminate();
                    settle(() => resolve(null));
                    break;
                case 'error':
                    void worker.terminate();
                    settle(() => reject(codedError(message.message)));
                    break;
            }
        });
        worker.on('error', error => {
            if (!started) {
                // ワーカーでモジュールを読み込めない環境では、このスレッドで処理する
                console.warn(`${job.script}: worker thread unavailable, running in the main thread: ${error.message}`);
                settle(() => resolve(runInProcess(jobId, job)));
                return;
            }
            settle(() => reject(codedError(error.message)));
        });
        worker.on('exit', code => settle(() => reject(new Error(`VECTORIZE_FAILED: worker exited (${code})`))));
        stopCancel = onJobCancel(jobId, () => {
            worker.postMessage({ type: 'cancel' } satisfies WorkerRequest);
            settle(() => resolve(null));
        });
    });
}
