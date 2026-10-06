import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getSettings } from '../settings';
import { isCancelled, registerChild } from '../job-manager';
import { discardLater, toolTempEnv } from '../work-dir';
import type { FfmpegDetectResult } from '../../../shared/types';

// ffmpeg/ffprobe の実行基盤。
// 引数は常に配列で渡し shell を使わない (日本語パスや cp932 の引用問題を避けるため)。
// 出力のパースは JSON / -progress の機械可読出力のみに依存する。

export type RunResult = {
    code: number | null;
    stdout: string;
    stderr: string;
};

export type RunOptions = {
    jobId?: string;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
};

// PATH に加えて探索する既定のインストール先。
// macOS や Linux で Finder/ランチャーからアプリを起動すると PATH が最小限
// (/usr/bin:/bin:/usr/sbin:/sbin) になり、Homebrew などの導入先が含まれないため補う。
function extraSearchDirs(): string[] {
    if (process.platform === 'darwin') {
        return [
            '/opt/homebrew/bin', // Homebrew (Apple Silicon)
            '/usr/local/bin', // Homebrew (Intel)
            '/opt/local/bin', // MacPorts
            '/sw/bin', // Fink
            '/usr/bin',
            '/bin',
        ];
    }
    if (process.platform === 'linux') {
        return ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', '/var/lib/flatpak/exports/bin'];
    }
    return [];
}

// PATH から実行ファイルを探す (which/where の出力パースは文字コード依存のため行わない)
function findInPath(baseName: string): string | null {
    const pathEnv = process.env.PATH ?? '';
    const dirs = [...new Set([...pathEnv.split(path.delimiter).filter(Boolean), ...extraSearchDirs()])];
    const names = process.platform === 'win32' ? [`${baseName}.exe`] : [baseName];
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                if (fs.statSync(candidate).isFile()) {
                    return candidate;
                }
            } catch {
                // 存在しない/権限なしは無視して次を探す
            }
        }
    }
    return null;
}

// 設定値を優先しつつ ffmpeg のパスを解決する
export function resolveFfmpegPath(): string | null {
    const configured = getSettings().ffmpeg.ffmpegPath;
    if (configured) {
        return fs.existsSync(configured) ? configured : null;
    }
    return findInPath('ffmpeg');
}

// 設定値を優先しつつ ffprobe のパスを解決する
export function resolveFfprobePath(): string | null {
    const configured = getSettings().ffmpeg.ffprobePath;
    if (configured) {
        return fs.existsSync(configured) ? configured : null;
    }
    // ffprobe が未設定で ffmpeg が設定済みなら、同じディレクトリの ffprobe を優先して探す
    const ffmpegConfigured = getSettings().ffmpeg.ffmpegPath;
    if (ffmpegConfigured && fs.existsSync(ffmpegConfigured)) {
        const sibling = path.join(
            path.dirname(ffmpegConfigured),
            process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
        );
        if (fs.existsSync(sibling)) return sibling;
    }
    return findInPath('ffprobe');
}

export function detectTools(): FfmpegDetectResult {
    return {
        ffmpegPath: resolveFfmpegPath(),
        ffprobePath: resolveFfprobePath(),
    };
}

// 行単位のコールバック用バッファ処理
function createLineSplitter(callback?: (line: string) => void): (chunk: string) => void {
    let buffer = '';
    return (chunk: string) => {
        if (!callback) return;
        buffer += chunk;
        let index = buffer.search(/[\r\n]/);
        while (index >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (line.length > 0) callback(line);
            index = buffer.search(/[\r\n]/);
        }
    };
}

// 外部コマンドを実行して出力を収集する (shell 不使用)。
// 一時ファイルの置き場は、プロセスごとに作業ディレクトリに作って TEMP / TMP / TMPDIR に渡し、終了したら消す
export function runTool(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const temp = toolTempEnv();
    const release = () => {
        if (temp) discardLater(temp.dir);
    };
    return new Promise<RunResult>((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, ...(temp ? { env: temp.env } : {}) });
        if (options.jobId) {
            registerChild(options.jobId, child);
        }
        let stdout = '';
        let stderr = '';
        const stdoutSplitter = createLineSplitter(options.onStdoutLine);
        const stderrSplitter = createLineSplitter(options.onStderrLine);

        child.stdout?.setEncoding('utf-8');
        child.stderr?.setEncoding('utf-8');
        child.stdout?.on('data', (chunk: string) => {
            stdout += chunk;
            stdoutSplitter(chunk);
        });
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
            stderrSplitter(chunk);
        });
        child.on('error', error => {
            reject(error);
        });
        child.on('close', code => {
            resolve({ code, stdout, stderr });
        });
    }).finally(release);
}

export type FfmpegRunOptions = RunOptions & {
    // 進捗計算用: 処理対象の長さ (秒)。指定時は -progress pipe:1 を付与して onProgress を呼ぶ
    totalSec?: number;
    onProgress?: (percent: number) => void;
};

// ffmpeg を実行する。失敗時 (非 0 終了) は stderr を含むエラーを投げる。
// ジョブがキャンセルされた場合は KURA_CANCELLED エラーを投げる。
export async function runFfmpeg(args: string[], options: FfmpegRunOptions = {}): Promise<RunResult> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) {
        throw new Error('FFMPEG_NOT_FOUND');
    }
    let finalArgs = args;
    let onStdoutLine = options.onStdoutLine;
    if (options.onProgress && options.totalSec && options.totalSec > 0) {
        finalArgs = ['-progress', 'pipe:1', '-nostats', ...args];
        const totalUs = options.totalSec * 1_000_000;
        const onProgress = options.onProgress;
        const userStdoutLine = options.onStdoutLine;
        onStdoutLine = (line: string) => {
            const match = /^out_time_us=(\d+)/.exec(line);
            if (match) {
                const percent = Math.max(0, Math.min(100, (Number(match[1]) / totalUs) * 100));
                onProgress(percent);
            }
            userStdoutLine?.(line);
        };
    }
    const result = await runTool(ffmpegPath, finalArgs, {
        jobId: options.jobId,
        onStdoutLine,
        onStderrLine: options.onStderrLine,
    });
    if (options.jobId && isCancelled(options.jobId)) {
        throw new Error('KURA_CANCELLED');
    }
    if (result.code !== 0) {
        throw new Error(`FFMPEG_FAILED: ${result.stderr}`);
    }
    return result;
}

// キャンセル済みかを表す共通判定 (エラーメッセージ規約)
export function isCancelledError(error: unknown): boolean {
    return error instanceof Error && error.message === 'KURA_CANCELLED';
}
