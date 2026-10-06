import type { ChildProcess, SpawnOptions } from 'child_process';
import { killTree, spawnGroup } from '../../utils/process-tree';
import { onJobCancel } from '../job-manager';
import { newTempDir, discardLater } from '../work-dir';
import { createLineReader } from './output-lines';

// 外部プロセス (Python: pip・学習スクリプト・動作確認など) を行単位の出力を受け取りながら実行する。
// ジョブがキャンセルされたら子孫プロセスごと終了させ、KURA_CANCELLED で失敗させる。
// プロセスごとに作業ディレクトリに一時ファイルの置き場を作って TEMP / TMP / TMPDIR に渡し、
// プロセスが終了した時点で (成否・キャンセルを問わず) 消す。

type ProcessResult = {
    code: number | null;
    // 標準出力と標準エラーのすべての行 (失敗時の原因の表示用)。
    // \r で書き換えられた行は、端末に最後に残る内容だけを持つ
    output: string[];
};

type ProcessOptions = Omit<SpawnOptions, 'env'> & {
    // 子プロセスの環境変数 (buildPythonEnv で作ったもの。一時ファイルの置き場はここに加えて渡す)
    env: NodeJS.ProcessEnv;
    jobId?: string;
    onLine?(line: string, stream: 'stdout' | 'stderr'): void;
};

export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
    const { jobId, onLine, env: baseEnv, ...spawnOptions } = options;
    const temp = newTempDir();
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
        const output: string[] = [];
        const handle = (stream: 'stdout' | 'stderr') => {
            // この出力の直前の行の位置 (\r で書き換えられたときに置き換える)
            let last = -1;
            return createLineReader((line, overwrite) => {
                if (overwrite && last >= 0) {
                    output[last] = line;
                } else {
                    last = output.push(line) - 1;
                }
                onLine?.(line, stream);
            });
        };
        // 文字の途中で区切られた出力を正しく読むため、文字列として受け取る
        child.stdout?.setEncoding('utf-8');
        child.stderr?.setEncoding('utf-8');
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
            resolve({ code, output });
        });
    });
    // プロセスが終了したら一時ファイルを消す (close はプロセスの終了後に来る)
    return running.finally(() => discardLater(temp));
}

// Windows で必要な DLL が見つからずにプロセスが起動できなかったことを表す終了コード (STATUS_DLL_NOT_FOUND)
export const WINDOWS_DLL_NOT_FOUND = 3221225781;
