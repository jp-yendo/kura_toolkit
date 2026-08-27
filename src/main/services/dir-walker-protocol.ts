import type { CleanupItem } from '../../shared/types';
import type { CleanupScanConfig } from './cleanup-targets';

// 並列ディレクトリ走査 (dir-walker) の main <-> worker 間プロトコル。
// 型と定数だけを持つモジュールなので、ワーカー側から読み込んでも余計な依存が増えない。

// SharedArrayBuffer 上のフラグの位置 (Int32Array のインデックス)。
// メッセージの往復を待たずに参照できるため、キャンセルと負荷分散の判定に使う
export const FLAG_CANCELLED = 0;
// 手が空いているワーカーの数。0 より大きいとき、走査中のワーカーは
// 自分のローカルキューを分けて main へ返す (spill)
export const FLAG_IDLE_WORKERS = 1;
export const FLAG_COUNT = 2;

// 走査の作業単位。ディレクトリ 1 個だけを単位にすると、
// ファイルが数万ある単一ディレクトリが 1 スレッドに固定されて並列化が効かなくなるため、
// ADS 判定はディレクトリから切り離して分割できるようにしている
export type WalkTask =
    | { kind: 'dir'; path: string }
    // ADS 判定だけを行うファイル群 (dir は進捗表示用の親ディレクトリ)
    | { kind: 'ads'; dir: string; paths: string[] };

// ワーカー起動時に渡す初期データ
export type WalkerInit = {
    // ワーカーの通し番号 (進捗表示の行に対応する)
    index: number;
    config: CleanupScanConfig;
    flags: SharedArrayBuffer;
};

// main -> worker
export type WalkerRequest = { type: 'tasks'; tasks: WalkTask[] };

// worker -> main
export type WalkerResponse =
    // 一定間隔でまとめて送る走査結果と進捗
    | { type: 'report'; index: number; items: CleanupItem[]; errors: string[]; dirs: number; current: string | null }
    // ローカルキューから分けた作業。main が空いているワーカーへ配り直す
    | { type: 'spill'; index: number; tasks: WalkTask[] }
    // ローカルキューが空になった
    | { type: 'idle'; index: number };
