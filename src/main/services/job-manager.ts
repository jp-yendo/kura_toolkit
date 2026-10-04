import type { ChildProcess } from 'child_process';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { JobEvent } from '../../shared/types';

// 長時間処理 (ジョブ) の状態管理。
// jobId は renderer 側で生成され、開始 invoke の引数として渡される。
// invoke の解決 = ジョブ完了。進捗は JOB_EVENT チャンネルで push する。

type JobEntry = {
    children: Set<ChildProcess>;
    // 子プロセスの kill 以外の中断処理 (ダウンロードの中止、子孫プロセスごとの終了など)
    cancelHandlers: Set<() => void>;
    cancelled: boolean;
};

const jobs = new Map<string, JobEntry>();

let mainWindow: BrowserWindow | null = null;

export function setJobWindow(window: BrowserWindow | null): void {
    mainWindow = window;
}

// ジョブを開始登録する
export function startJob(jobId: string): void {
    jobs.set(jobId, { children: new Set(), cancelHandlers: new Set(), cancelled: false });
}

// キャンセル時に呼ぶ処理を登録する。戻り値は登録解除関数。
// 既にキャンセル済みのジョブに登録した場合はその場で呼ぶ。開始していない (または終了した) ジョブには
// 登録できない (キャンセルを受け取れないまま処理が進まないようにするため)
export function onJobCancel(jobId: string, handler: () => void): () => void {
    const entry = jobs.get(jobId);
    if (!entry) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
    if (entry.cancelled) {
        handler();
        return () => undefined;
    }
    entry.cancelHandlers.add(handler);
    return () => {
        entry.cancelHandlers.delete(handler);
    };
}

// ジョブを終了して登録解除する (finally で呼ぶ)
export function finishJob(jobId: string): void {
    jobs.delete(jobId);
}

// 実行中のジョブがあるか
export function hasActiveJobs(): boolean {
    return jobs.size > 0;
}

export function isCancelled(jobId: string): boolean {
    return jobs.get(jobId)?.cancelled ?? false;
}

// ジョブ配下の子プロセスを登録する (キャンセル時に kill される)
export function registerChild(jobId: string, child: ChildProcess): void {
    const entry = jobs.get(jobId);
    if (!entry) return;
    if (entry.cancelled) {
        child.kill();
        return;
    }
    entry.children.add(child);
    child.once('exit', () => {
        entry.children.delete(child);
    });
}

// ジョブをキャンセルする (実行中の子プロセスをすべて kill)
export function cancelJob(jobId: string): void {
    const entry = jobs.get(jobId);
    if (!entry) return;
    entry.cancelled = true;
    for (const child of entry.children) {
        try {
            child.kill();
        } catch {
            // 既に終了している場合は無視
        }
    }
    for (const handler of entry.cancelHandlers) {
        try {
            handler();
        } catch (error) {
            console.error('cancel handler failed', error);
        }
    }
    entry.cancelHandlers.clear();
}

// すべてのジョブをキャンセルする (ウィンドウクローズ時)
export function cancelAllJobs(): void {
    for (const jobId of jobs.keys()) {
        cancelJob(jobId);
    }
}

// ジョブイベントを renderer へ push する
export function emitJobEvent(event: JobEvent): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.JOB_EVENT, event);
    }
}
