import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { voicePhase } from './job-progress';
import { isCancelledError } from '../ffmpeg/ffmpeg';
import { encodeExport } from './audio-tools';
import { isInsideWork } from '../work-dir';
import type { AudioExportSettings, ExportItem, ExportResult } from '../../../shared/voice/types';

// 音声の書き出し (分離・変換・読み上げで共通)。形式は MP3 と FLAC。
// 書き出し先のフォルダは作らない (利用者が選んだフォルダが無ければ EXPORT_FOLDER_MISSING で失敗させる)。

// 書き出し先のうち、既に存在するもの (上書きの確認に使う)
export function existingPaths(paths: string[]): string[] {
    return paths.filter(item => fs.existsSync(item));
}

export async function exportAudio(
    jobId: string,
    workKey: string,
    items: ExportItem[],
    settings: AudioExportSettings
): Promise<ExportResult> {
    startJob(jobId);
    const outputs: string[] = [];
    const failed: { dest: string; error: string }[] = [];
    try {
        for (let index = 0; index < items.length; index++) {
            if (isCancelled(jobId)) break;
            const item = items[index];
            emitJobEvent({
                jobId,
                kind: 'progress',
                percent: (index / items.length) * 100,
                current: index + 1,
                total: items.length,
                message: path.basename(item.dest),
            });
            voicePhase(jobId, 'encode', { fraction: index / items.length, current: index + 1, total: items.length });
            try {
                if (!isInsideWork(workKey, item.source)) throw new Error('INVALID_PATH');
                const folder = path.dirname(item.dest);
                if (!fs.existsSync(folder)) throw new Error(`EXPORT_FOLDER_MISSING: ${folder}`);
                await encodeExport(item.source, item.dest, settings, jobId, percent =>
                    voicePhase(jobId, 'encode', {
                        fraction: (index + percent / 100) / items.length,
                        current: index + 1,
                        total: items.length,
                    })
                );
                outputs.push(item.dest);
            } catch (error) {
                if (isCancelledError(error) || isCancelled(jobId)) break;
                failed.push({ dest: item.dest, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { outputs, failed, cancelled: isCancelled(jobId) };
    } finally {
        finishJob(jobId);
    }
}
