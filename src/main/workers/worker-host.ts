import { parentPort, type MessagePort } from 'worker_threads';
import { isTraceCancelled } from '../services/vector-trace/types';
import type { WorkerHooks, WorkerRequest, WorkerResponse } from '../services/vector-trace/worker-protocol';

// 画像の処理のワーカースレッドで、処理を 1 つ動かして進み具合と結果を親へ送る。
// 取り消しの知らせを受けたら signal を中止し、処理は今の処理 (変換ライブラリの 1 回の呼び出しなど) が終わったところで止まる。
// electron は import しない (ワーカーからは使えない)。

function requireParentPort(): MessagePort {
    if (!parentPort) throw new Error('the image worker must be started as a worker thread');
    return parentPort;
}

// task を動かし、終わったら done (結果)・cancelled (取り消し)・error (失敗) のどれかを親へ送る
export function serveWorker<P, R>(task: (hooks: WorkerHooks<P>) => Promise<R>): void {
    const port = requireParentPort();
    const controller = new AbortController();
    const send = (message: WorkerResponse<P, R>) => port.postMessage(message);
    const onMessage = (message: WorkerRequest) => {
        if (message.type === 'cancel') controller.abort();
    };
    port.on('message', onMessage);
    send({ type: 'started' });

    task({ signal: controller.signal, onProgress: progress => send({ type: 'progress', progress }) })
        .then(result => send({ type: 'done', result }))
        .catch((error: unknown) => {
            if (isTraceCancelled(error)) send({ type: 'cancelled' });
            else send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => port.off('message', onMessage));
}
