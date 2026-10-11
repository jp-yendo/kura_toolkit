import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { isCancelledError } from '../ffmpeg/ffmpeg';
import { probeTrackFile } from './probe';
import { probeFrames } from './frames';
import { probeWaveform } from './waveform';
import { discardPreview, makePreview, previewSource } from './preview';
import { checkSave, saveEdited } from './save';
import { exportTrack } from './export-track';
import type {
    TrackTagExportRequest,
    TrackTagFile,
    TrackTagFrames,
    TrackTagPreview,
    TrackTagSaveCheck,
    TrackTagSaveRequest,
    TrackTagWaveform,
    VideoJobResult,
} from '../../../shared/types';

// 動画トラック・タグ管理の処理 (ジョブとして実行するものは、進み具合を知らせ、取り消せる)

export function trackTagProbe(input: string): Promise<TrackTagFile> {
    return probeTrackFile(input);
}

export function trackTagFrames(input: string): Promise<TrackTagFrames> {
    return probeFrames(input);
}

export function trackTagWaveform(
    source: string,
    streamIndex: number,
    durationSec: number | null
): Promise<TrackTagWaveform> {
    return probeWaveform(source, streamIndex, durationSec);
}

export function trackTagPreview(input: string): TrackTagPreview {
    return previewSource(input);
}

// ジョブとして実行し、進み具合を知らせる。取り消した場合は null を返す
async function runJob<T>(jobId: string, run: (onProgress: (percent: number) => void) => Promise<T>): Promise<T | null> {
    startJob(jobId);
    try {
        return await run(percent => emitJobEvent({ jobId, kind: 'progress', percent }));
    } catch (error) {
        if (isCancelledError(error)) return null;
        throw error;
    } finally {
        finishJob(jobId);
    }
}

// 元の動画を再生できない場合のプレビュー用の動画を作る (取り消した場合は null)
export function trackTagMakePreview(
    jobId: string,
    input: string,
    durationSec: number | null
): Promise<TrackTagPreview | null> {
    return runJob(jobId, onProgress => makePreview(jobId, input, durationSec, onProgress));
}

// 作ったプレビュー用の動画を片付ける
export function trackTagDiscard(): void {
    discardPreview();
}

export function trackTagCheckSave(request: TrackTagSaveRequest): Promise<TrackTagSaveCheck> {
    return checkSave(request);
}

export async function trackTagSave(jobId: string, request: TrackTagSaveRequest): Promise<VideoJobResult> {
    const done = await runJob(jobId, onProgress => saveEdited(jobId, request, onProgress).then(() => true));
    return done ? { outputs: [request.output], cancelled: false } : { outputs: [], cancelled: true };
}

export async function trackTagExport(jobId: string, request: TrackTagExportRequest): Promise<VideoJobResult> {
    const done = await runJob(jobId, onProgress => exportTrack(jobId, request, onProgress).then(() => true));
    return done ? { outputs: [request.output], cancelled: false } : { outputs: [], cancelled: true };
}
