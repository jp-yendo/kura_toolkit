import type { VectorizeRequest } from '../../../shared/types';

// 画像の処理をワーカースレッドで行うときのメッセージ

// 1 枚の画像を変換するワーカーに渡す値 (workerData)
export type TraceWorkerInit = {
    filePath: string;
    request: VectorizeRequest;
};

// 親からワーカーへ
export type WorkerRequest = { type: 'cancel' };

// ワーカーから親へ (started: モジュールを読み込んで処理を始めた。done / cancelled / error のどれかで終わる)。
// P は進み具合の知らせ、R は処理の結果
export type WorkerResponse<P, R> =
    | { type: 'started' }
    | { type: 'progress'; progress: P }
    | { type: 'done'; result: R }
    | { type: 'cancelled' }
    | { type: 'error'; message: string };

// ワーカーで動かす処理が受け取る、取り消し (中止されたら今の処理が終わったところで止める) と進み具合の知らせ
export type WorkerHooks<P> = {
    signal: AbortSignal;
    onProgress(progress: P): void;
};
