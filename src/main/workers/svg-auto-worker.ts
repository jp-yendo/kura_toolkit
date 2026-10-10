import { workerData } from 'worker_threads';
import { autoConvert, type SvgAutoProgress, type SvgAutoWorkerInit } from '../services/svg-auto/auto-convert';
import type { VersionIndex } from '../services/svg-auto/version-index';
import { serveWorker } from './worker-host';

// SVG 自動変換のワーカー。1 枚の画像の変換の設定を探して版のファイルを作り、版の一覧を結果として親へ送る。
// electron は import しない (ワーカーからは使えない)。

const init = workerData as SvgAutoWorkerInit;

serveWorker<SvgAutoProgress, VersionIndex>(hooks => autoConvert(init, hooks));
