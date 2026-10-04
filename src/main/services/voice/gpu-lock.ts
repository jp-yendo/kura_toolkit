import { emitJobEvent, onJobCancel } from '../job-manager';

// GPU を使う処理をアプリ全体で 1 つずつ順番に実行するための排他制御。
// 複数のコンポーネントが同時に GPU を使うとメモリが不足するため、分離・変換・読み上げ・学習のすべてが
// この順番待ちを通る。待っている間にジョブがキャンセルされた場合は順番待ちから外れる。

type Waiter = {
    owner: string;
    resolve(): void;
};

let current: string | null = null;
const queue: Waiter[] = [];
// GPU の持ち主が変わる直前に呼ぶ処理 (他のコンポーネントが確保したメモリを手放させる)
let beforeSwitch: ((nextOwner: string) => Promise<void>) | null = null;

export function setGpuSwitchHandler(handler: (nextOwner: string) => Promise<void>): void {
    beforeSwitch = handler;
}

function next(): void {
    const waiter = queue.shift();
    if (!waiter) {
        current = null;
        return;
    }
    current = waiter.owner;
    waiter.resolve();
}

// GPU の順番を待ってから fn を実行する。owner はコンポーネント名 (separator / converter / tts)。
// 待つ間は、待っていることを画面に示せるようジョブの状態として通知する (学習中などは長く待つため)
export async function withGpu<T>(jobId: string, owner: string, fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve, reject) => {
        if (current === null) {
            current = owner;
            resolve();
            return;
        }
        let stopWatchingCancel: () => void = () => undefined;
        const waiter: Waiter = {
            owner,
            resolve: () => {
                stopWatchingCancel();
                emitJobEvent({ jobId, kind: 'wait', waiting: false });
                resolve();
            },
        };
        queue.push(waiter);
        emitJobEvent({ jobId, kind: 'wait', waiting: true });
        stopWatchingCancel = onJobCancel(jobId, () => {
            const index = queue.indexOf(waiter);
            if (index >= 0) {
                queue.splice(index, 1);
                reject(new Error('KURA_CANCELLED'));
            }
        });
    });
    try {
        if (beforeSwitch) await beforeSwitch(owner);
        return await fn();
    } finally {
        next();
    }
}
