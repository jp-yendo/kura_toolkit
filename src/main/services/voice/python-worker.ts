import type { ChildProcess } from 'child_process';
import path from 'path';
import { killTree, spawnGroup } from '../../utils/process-tree';
import { pythonLog } from './log';
import { createLineReader } from './output-lines';
import { isCancelled, onJobCancel } from '../job-manager';
import { newTempDir, discardLater } from '../work-dir';
import { bundledResourceDir, envPythonExecutable, libraryPaths } from './paths';
import { buildPythonEnv } from './python-env';
import type { VoiceComponentId } from '../../../shared/voice/types';

// 仮想環境の Python で常駐させる補助プロセス (src/python/kura_voice/worker.py) との通信。
// 標準入出力で 1 行 1 件の JSON をやり取りする。読み込んだモデルを保持したまま次の要求に応えられるため、
// 候補を作り直すたびにモデルを読み直す時間を省ける。
// 中断は要求の途中では行えないため、ジョブがキャンセルされたらプロセスごと終了させ、次の要求で起動し直す。

type PendingRequest = {
    resolve(value: unknown): void;
    reject(error: Error): void;
    onEvent?(event: Record<string, unknown>): void;
};

type WorkerMessage = {
    id?: number;
    result?: unknown;
    error?: { code?: string; message?: string; detail?: string };
    event?: Record<string, unknown>;
    ready?: boolean;
};

type WorkerRequestOptions = {
    jobId?: string;
    onEvent?(event: Record<string, unknown>): void;
};

// プロセスが終了済みか (起動できなかったプロセスは pid を持たず、exit も来ない)
function hasExited(child: ChildProcess): boolean {
    return child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
}

// プロセスの終了を待つ。時間内に終了しなければ PYTHON_STOP_TIMEOUT で失敗させる
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (hasExited(child)) {
            resolve();
            return;
        }
        const timer = setTimeout(() => reject(new Error('PYTHON_STOP_TIMEOUT')), timeoutMs);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

class PythonWorker {
    private child: ChildProcess | null = null;
    // 終了させたが、まだ終了していないプロセス。ファイルを掴んだままの可能性があるため、終了するまで覚えておき、
    // killAndWait で終了を待てるようにする
    private stopping = new Set<ChildProcess>();
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    // 処理中の要求の間に出た標準エラー (異常終了時の原因として返す)。
    // 常駐プロセスの出力を溜め続けないよう、要求ごとに改める
    private stderrLines: string[] = [];
    // 要求は 1 件ずつ順番に処理する (Python 側も 1 件ずつしか処理しない)
    private chain: Promise<unknown> = Promise.resolve();
    // 送った (または順番を待っている) 要求の数。0 になったときに、今の機能で使わない処理役なら止める
    private inFlight = 0;

    constructor(
        private readonly component: VoiceComponentId,
        private readonly cwd: () => string
    ) {}

    get running(): boolean {
        return this.child !== null;
    }

    private start(): ChildProcess {
        if (this.child) return this.child;
        const python = envPythonExecutable(this.component);
        const script = path.join(bundledResourceDir('python'), 'kura_voice', 'worker.py');
        // このプロセスの一時ファイルの置き場。プロセスが終了したら消す
        const temp = newTempDir();
        let child: ChildProcess;
        try {
            child = spawnGroup(python, ['-u', script, '--component', this.component], {
                cwd: this.cwd(),
                env: { ...buildPythonEnv(this.component), TEMP: temp, TMP: temp, TMPDIR: temp },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            // プロセスを起動できなかった場合は、終了の知らせが来ないため、ここで置き場を消す
            discardLater(temp);
            throw error;
        }
        child.once('exit', () => discardLater(temp));
        child.once('error', () => discardLater(temp));
        this.child = child;
        this.stderrLines = [];
        // 終了しかけのプロセスへの書き込みは EPIPE になる。終了は exit で扱うため、ここでは無視する
        child.stdin?.on('error', () => undefined);

        let stdoutBuffer = '';
        child.stdout?.setEncoding('utf-8');
        child.stdout?.on('data', (chunk: string) => {
            stdoutBuffer += chunk;
            let index = stdoutBuffer.indexOf('\n');
            while (index >= 0) {
                const line = stdoutBuffer.slice(0, index).trim();
                stdoutBuffer = stdoutBuffer.slice(index + 1);
                if (line) this.handleLine(line);
                index = stdoutBuffer.indexOf('\n');
            }
        });
        child.stderr?.setEncoding('utf-8');
        child.stderr?.on(
            'data',
            createLineReader((line, overwrite) => {
                pythonLog(`python:${this.component}`, line);
                // 切り離した古いプロセスの出力は、新しいプロセスの異常終了の詳細に混ぜない
                if (this.child !== child) return;
                // \r で書き換えられた行 (進捗表示) は、端末に最後に残る内容だけを残す
                if (overwrite && this.stderrLines.length > 0) {
                    this.stderrLines[this.stderrLines.length - 1] = line;
                } else {
                    this.stderrLines.push(line);
                }
            })
        );
        child.on('error', error => this.handleExit(child, error.message));
        child.on('exit', (code, signal) => this.handleExit(child, `exit code ${code ?? signal}`));
        return child;
    }

    private handleLine(line: string): void {
        let message: WorkerMessage;
        try {
            message = JSON.parse(line) as WorkerMessage;
        } catch {
            pythonLog(`python:${this.component}`, line);
            return;
        }
        if (message.id === undefined) return;
        const request = this.pending.get(message.id);
        if (!request) return;
        if (message.event) {
            request.onEvent?.(message.event);
            return;
        }
        this.pending.delete(message.id);
        if (message.error) {
            const code = message.error.code ?? 'PYTHON_ERROR';
            const detail = message.error.message;
            const error = new Error(detail ? `${code}: ${detail}` : code);
            (error as Error & { detail?: string }).detail = message.error.detail;
            request.reject(error);
        } else {
            request.resolve(message.result);
        }
    }

    // 処理中の要求をすべて失敗させる
    private rejectPending(error: Error): void {
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }

    // プロセスが終了した (止めたプロセスは kill() で切り離し済みなので、ここでは扱わない)
    private handleExit(child: ChildProcess, reason: string): void {
        if (this.child !== child) return;
        this.child = null;
        this.rejectPending(new Error(`PYTHON_WORKER_EXITED: ${reason}\n${this.stderrLines.join('\n')}`));
    }

    // 要求を送り、結果を待つ。途中経過は onEvent で受け取る
    request<T>(method: string, params: unknown, options: WorkerRequestOptions = {}): Promise<T> {
        const run = () =>
            new Promise<T>((resolve, reject) => {
                // 順番を待つ間にキャンセルされた要求は、プロセスを起動せずに終える
                if (options.jobId && isCancelled(options.jobId)) {
                    reject(new Error('KURA_CANCELLED'));
                    return;
                }
                const child = this.start();
                this.stderrLines = [];
                const id = this.nextId++;
                let unregister = () => undefined as void;
                this.pending.set(id, {
                    resolve: value => {
                        unregister();
                        resolve(value as T);
                    },
                    reject: error => {
                        unregister();
                        reject(error);
                    },
                    onEvent: options.onEvent,
                });
                if (options.jobId) {
                    unregister = onJobCancel(options.jobId, () => this.kill(true));
                }
                child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
            });
        this.inFlight++;
        const result = this.chain.then(run, run).finally(() => {
            this.inFlight--;
            if (this.inFlight === 0) stopIfUnused(this.component);
        });
        // 失敗しても後続の要求は処理する
        this.chain = result.catch(() => undefined);
        return result;
    }

    get idle(): boolean {
        return this.inFlight === 0;
    }

    // プロセスを終了させ、終了させたことのあるプロセスも含めてすべて終了するまで待つ。
    // 時間内に終了しなければ PYTHON_STOP_TIMEOUT で失敗させる
    async killAndWait(timeoutMs: number): Promise<void> {
        this.kill(false);
        await Promise.all([...this.stopping].map(child => waitForExit(child, timeoutMs)));
    }

    // プロセスを終了させる。cancelled = true の場合、処理中の要求はキャンセルとして失敗させる。
    // 終了を待たずにすぐ切り離すため、直後の要求は新しく起動したプロセスで処理する
    // (終了しかけの古いプロセスに要求が届くと、更新前のコードや設定のまま処理されてしまうため)
    kill(cancelled = false): void {
        const child = this.child;
        if (!child) return;
        this.child = null;
        if (!hasExited(child)) {
            this.stopping.add(child);
            child.once('exit', () => this.stopping.delete(child));
        }
        this.rejectPending(cancelled ? new Error('KURA_CANCELLED') : new Error('PYTHON_WORKER_EXITED: stopped'));
        killTree(child);
    }
}

const workers = new Map<VoiceComponentId, PythonWorker>();

// 機能 (画面の経路の先頭 2 つ。renderer の featureOf) ごとに、その機能を開いている間だけ保持する処理役 (その機能で
// 使いうるもの)。
// 処理役は最初に使ったときに起動し、その機能を離れたら止める (機能ごとに保持するため、Python を使う機能が
// 増えても、同時に動く処理役はその機能で使うものだけになる)。ほかの機能から一時的に使った処理役
// (ダウンロード画面での分離モデルの一覧作りなど) は、使い終わったら止める
const FEATURE_WORKERS: Record<string, VoiceComponentId[]> = {
    'audio/separation': ['separator'],
    'audio/conversion': ['separator', 'converter'],
    // 読み上げの学習用の音のフィルターで、モデルでノイズを除去する場合は分離の処理役を使う
    'audio/tts': ['tts', 'separator'],
};

let keptComponents = new Set<VoiceComponentId>();

function stopIfUnused(component: VoiceComponentId): void {
    const worker = workers.get(component);
    if (worker && worker.running && worker.idle && !keptComponents.has(component)) worker.kill(false);
}

// 開いている機能を切り替える。前の機能でだけ使っていた処理役は、処理中でなければすぐ止め、処理中なら終わったときに止める
export function setVoiceFeature(feature: string | null): void {
    keptComponents = new Set(feature ? (FEATURE_WORKERS[feature] ?? []) : []);
    for (const component of workers.keys()) stopIfUnused(component);
}

// 常駐プロセスの作業ディレクトリ (Applio は作業ディレクトリを基準に設定やモデルを探すため、ソース一式の場所で動かす)
function workerCwd(component: VoiceComponentId): string {
    const lib = libraryPaths();
    return component === 'converter' ? lib.source('converter') : lib.library(component);
}

export function getWorker(component: VoiceComponentId): PythonWorker {
    let worker = workers.get(component);
    if (!worker) {
        worker = new PythonWorker(component, () => workerCwd(component));
        workers.set(component, worker);
    }
    return worker;
}

// GPU を別のコンポーネントへ渡す前に、ほかの常駐プロセスが確保しているモデルを手放させる。
// 手放させる要求が失敗したプロセスは、確保したメモリを確実に解放するため終了させる
export async function unloadOtherWorkers(except: string): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    for (const [component, worker] of workers) {
        if (component === except || !worker.running) continue;
        tasks.push(
            worker.request('unload', {}).catch(error => {
                console.warn(`failed to unload the ${component} worker, stopping it`, error);
                worker.kill(false);
            })
        );
    }
    await Promise.all(tasks);
}

// すべての常駐プロセスを終了させる (アプリ終了時)
export function stopAllWorkers(): void {
    for (const worker of workers.values()) worker.kill(false);
}

// 常駐プロセスの終了を待つ時間
const WORKER_EXIT_TIMEOUT_MS = 15_000;

// 常駐プロセスをすべて止め、終了するまで待つ。仮想環境やモデルのファイルを移動・削除・入れ替える前と、アプリの終了時に使う
// (Windows では、終了しきっていないプロセスが読み込んだ DLL やモデルのファイルを掴んでいて、移動や削除が失敗するため)。
// 時間内に終了しないプロセスがあれば PYTHON_STOP_TIMEOUT で失敗する
export async function stopAllWorkersAndWait(): Promise<void> {
    await Promise.all([...workers.values()].map(worker => worker.killAndWait(WORKER_EXIT_TIMEOUT_MS)));
}

export function stopWorker(component: VoiceComponentId): void {
    workers.get(component)?.kill(false);
}
