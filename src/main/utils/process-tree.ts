import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';

// 子孫プロセスまで含めて終了させるための起動と終了の処理。
// Python の学習処理などは自分でさらにプロセスを起こすため、直接の子だけを kill すると孫が残る。

// 子孫ごと終了できるように起動する (POSIX では新しいプロセスグループにする)
export function spawnGroup(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
    return spawn(command, args, {
        windowsHide: true,
        ...options,
        detached: process.platform !== 'win32',
    });
}

// プロセスグループのプロセスがすべて終了済みであることを表すエラーか
function isGroupGone(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
}

// プロセスを子孫ごと終了させる。終了させられなかった場合はエラーとしてログに残す
// (呼び出し元はキャンセルやアプリ終了の後片付けの途中で、残りの後片付けを続けるため例外にはしない)
export function killTree(child: ChildProcess): void {
    const pid = child.pid;
    if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', error => console.error(`failed to run taskkill for process ${pid}`, error));
        killer.once('exit', code => {
            if (code !== null && code !== 0) console.error(`taskkill could not end process ${pid} (exit code ${code})`);
        });
        return;
    }
    try {
        process.kill(-pid, 'SIGTERM');
    } catch (error) {
        if (!isGroupGone(error)) console.error(`failed to terminate process group ${pid}`, error);
        return;
    }
    // 終了しない場合は強制終了する
    const timer = setTimeout(() => {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch (error) {
            if (!isGroupGone(error)) console.error(`failed to kill process group ${pid}`, error);
        }
    }, 5000);
    child.once('exit', () => clearTimeout(timer));
}
