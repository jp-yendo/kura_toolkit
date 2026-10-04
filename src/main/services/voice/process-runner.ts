import type { ChildProcess, SpawnOptions } from 'child_process';
import { killTree, spawnGroup } from '../../utils/process-tree';
import { onJobCancel } from '../job-manager';
import { processTempDir, removeTemp } from '../work-dir';

// 外部プロセス (Python: pip・学習スクリプト・動作確認など) を行単位の出力を受け取りながら実行する。
// ジョブがキャンセルされたら子孫プロセスごと終了させ、KURA_CANCELLED で失敗させる。
// プロセスごとに作業ディレクトリに一時ファイルの置き場を作って TEMP / TMP / TMPDIR に渡し、
// プロセスが終了した時点で (成否・キャンセルを問わず) 消す。

type ProcessResult = {
    code: number | null;
    // 標準エラー (と標準出力) の末尾 (失敗時の原因の表示用)
    tail: string[];
};

type ProcessOptions = Omit<SpawnOptions, 'env'> & {
    // 子プロセスの環境変数 (buildPythonEnv で作ったもの。一時ファイルの置き場はここに加えて渡す)
    env: NodeJS.ProcessEnv;
    jobId?: string;
    onLine?(line: string, stream: 'stdout' | 'stderr'): void;
    // 末尾として残す行数
    tailLines?: number;
};

// 失敗時に返す出力の行数
const DEFAULT_TAIL = 40;

export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
    const { jobId, onLine, tailLines = DEFAULT_TAIL, env: baseEnv, ...spawnOptions } = options;
    const temp = processTempDir();
    const env = { ...baseEnv, TEMP: temp, TMP: temp, TMPDIR: temp };
    const running = new Promise<ProcessResult>((resolve, reject) => {
        let child: ChildProcess;
        try {
            child = spawnGroup(command, args, { ...spawnOptions, env, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            reject(error);
            return;
        }
        let cancelled = false;
        const unregister = jobId
            ? onJobCancel(jobId, () => {
                  cancelled = true;
                  killTree(child);
              })
            : () => undefined;
        const tail: string[] = [];
        const handle = (stream: 'stdout' | 'stderr') => {
            let buffer = '';
            return (chunk: Buffer) => {
                buffer += chunk.toString('utf-8');
                // tqdm などは \r で行を書き換えるため、\r も行の区切りとして扱う
                const parts = buffer.split(/\r\n|\r|\n/);
                buffer = parts.pop() ?? '';
                for (const part of parts) {
                    const line = part.trimEnd();
                    if (!line) continue;
                    tail.push(line);
                    if (tail.length > tailLines) tail.shift();
                    onLine?.(line, stream);
                }
            };
        };
        child.stdout?.on('data', handle('stdout'));
        child.stderr?.on('data', handle('stderr'));
        child.on('error', error => {
            unregister();
            reject(error);
        });
        child.on('close', code => {
            unregister();
            if (cancelled) {
                reject(new Error('KURA_CANCELLED'));
                return;
            }
            resolve({ code, tail });
        });
    });
    // プロセスが終了したら一時ファイルを消す (close はプロセスの終了後に来る)
    return running.finally(() => removeTemp(temp));
}

// Windows で必要な DLL が見つからずにプロセスが起動できなかったことを表す終了コード (STATUS_DLL_NOT_FOUND)
export const WINDOWS_DLL_NOT_FOUND = 3221225781;
