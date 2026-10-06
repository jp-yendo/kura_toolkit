import { isCancelled } from '../job-manager';
import { resolveFfprobePath, runTool } from './ffmpeg';

// ffprobe を JSON 出力モードで実行するラッパ

export type FfprobeOptions = {
    jobId?: string;
};

// ffprobe を実行して JSON をパースした結果を返す。
// 失敗時は FFPROBE_FAILED、未検出時は FFPROBE_NOT_FOUND を投げる。
export async function probeJson<T = unknown>(args: string[], options: FfprobeOptions = {}): Promise<T> {
    const ffprobePath = resolveFfprobePath();
    if (!ffprobePath) {
        throw new Error('FFPROBE_NOT_FOUND');
    }
    const fullArgs = ['-hide_banner', '-loglevel', 'error', '-print_format', 'json', ...args];
    const result = await runTool(ffprobePath, fullArgs, { jobId: options.jobId });
    if (options.jobId && isCancelled(options.jobId)) {
        throw new Error('KURA_CANCELLED');
    }
    if (result.code !== 0) {
        throw new Error(`FFPROBE_FAILED: ${result.stderr}`);
    }
    try {
        return JSON.parse(result.stdout) as T;
    } catch {
        throw new Error('FFPROBE_FAILED: invalid json output');
    }
}
