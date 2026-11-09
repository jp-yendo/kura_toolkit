import type { CleanupItem } from '../../shared/types';
import type { CleanupScanConfig } from './cleanup-targets';

// 並列ディレクトリ走査 (dir-walker) の main <-> worker 間プロトコル。
// 型と定数、共有メモリの読み書きだけを持つモジュールなので、ワーカー側から読み込んでも余計な依存が増えない。

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
    // ワーカーが今処理しているディレクトリ (createCurrentPathBuffer で作る)
    current: SharedArrayBuffer;
};

// main -> worker
export type WalkerRequest = { type: 'tasks'; tasks: WalkTask[] };

// worker -> main
export type WalkerResponse =
    // 一定間隔でまとめて送る走査結果と進捗
    | { type: 'report'; index: number; items: CleanupItem[]; errors: string[]; dirs: number }
    // ローカルキューから分けた作業。main が空いているワーカーへ配り直す
    | { type: 'spill'; index: number; tasks: WalkTask[] }
    // ローカルキューが空になった
    | { type: 'idle'; index: number };

// 現在位置の共有領域。
// ワーカーは 1 回の fs 呼び出しの中で長く止まることがあり (応答しないネットワークドライブなど)、
// その間はメッセージを送れない。処理を始める時点で共有メモリへ書いておけば、
// main はワーカーを待たずに、止まっているディレクトリまで読み取れる。
//
// 並び: Int32 [更新番号, 文字数] + UTF-16 の文字列。
// 更新番号は書き込み中だけ奇数になり、読む側は前後で番号が変わっていなければ採用する (seqlock)
const CURRENT_SEQ = 0;
const CURRENT_LENGTH = 1;
const CURRENT_HEADER_BYTES = 2 * Int32Array.BYTES_PER_ELEMENT;
// 保持する最大文字数。これより長いパスは先頭だけを保持し、末尾を省略して表示する
const CURRENT_MAX_CHARS = 4096;
// 文字数がこの値のときは処理中のディレクトリが無い
const CURRENT_NONE = -1;
// 書き込みと重なった場合に読み直す回数
const CURRENT_READ_ATTEMPTS = 3;
const TRUNCATED_SUFFIX = '...';

export type CurrentPathView = { header: Int32Array; chars: Uint16Array };

export function createCurrentPathBuffer(): SharedArrayBuffer {
    const buffer = new SharedArrayBuffer(CURRENT_HEADER_BYTES + CURRENT_MAX_CHARS * Uint16Array.BYTES_PER_ELEMENT);
    new Int32Array(buffer, 0, 2)[CURRENT_LENGTH] = CURRENT_NONE;
    return buffer;
}

export function currentPathView(buffer: SharedArrayBuffer): CurrentPathView {
    return {
        header: new Int32Array(buffer, 0, 2),
        chars: new Uint16Array(buffer, CURRENT_HEADER_BYTES, CURRENT_MAX_CHARS),
    };
}

// 現在位置を書き込む。null は処理中のディレクトリが無いことを表す
export function writeCurrentPath(view: CurrentPathView, value: string | null): void {
    Atomics.add(view.header, CURRENT_SEQ, 1);
    if (value === null) {
        Atomics.store(view.header, CURRENT_LENGTH, CURRENT_NONE);
    } else {
        const stored = Math.min(value.length, CURRENT_MAX_CHARS);
        for (let i = 0; i < stored; i++) view.chars[i] = value.charCodeAt(i);
        // 元の長さを残し、読む側が省略したかどうかを判断できるようにする
        Atomics.store(view.header, CURRENT_LENGTH, value.length);
    }
    Atomics.add(view.header, CURRENT_SEQ, 1);
}

// 現在位置を読む。書き込みと重なり続けて読めなかった場合は undefined を返す
export function readCurrentPath(view: CurrentPathView): string | null | undefined {
    for (let attempt = 0; attempt < CURRENT_READ_ATTEMPTS; attempt++) {
        const before = Atomics.load(view.header, CURRENT_SEQ);
        if (before % 2 !== 0) continue;
        const length = Atomics.load(view.header, CURRENT_LENGTH);
        let value: string | null = null;
        if (length !== CURRENT_NONE) {
            // 共有メモリから切り離した複製を文字列にする
            const copied = view.chars.slice(0, Math.min(length, CURRENT_MAX_CHARS));
            value = String.fromCharCode(...copied);
            if (length > CURRENT_MAX_CHARS) value += TRUNCATED_SUFFIX;
        }
        if (Atomics.load(view.header, CURRENT_SEQ) === before) return value;
    }
    return undefined;
}
