import { workerData } from 'worker_threads';
import { traceImageFile, type TraceProgress } from '../services/vector-trace/pipeline';
import type { TraceWorkerInit } from '../services/vector-trace/worker-protocol';
import { serveWorker } from './worker-host';

// 画像 SVG 変換のワーカー。1 枚の画像を変換して、SVG を結果として親へ送る。
// electron は import しない (ワーカーからは使えない)。

const init = workerData as TraceWorkerInit;

serveWorker<TraceProgress, string>(hooks => traceImageFile(init.filePath, init.request, hooks));
