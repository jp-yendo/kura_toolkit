import { emitJobEvent, emitPhase } from '../job-manager';
import type { VoicePhaseId } from '../../../shared/voice/types';

// 音声機能のジョブの進捗と段階を画面へ送る。

// 段階を知らせる (fraction は段階の中の進み具合 0-1。分からない段階では省略する)
export function voicePhase(
    jobId: string,
    id: VoicePhaseId,
    progress: { fraction?: number; current?: number; total?: number } = {}
): void {
    emitPhase(jobId, id, progress);
}

// ffmpeg の進捗 (0-100) を段階の進み具合として送る関数を返す。段階はこの時点で始まったことにする
export function ffmpegPhase(jobId: string, id: VoicePhaseId): (percent: number) => void {
    voicePhase(jobId, id, { fraction: 0 });
    return percent => voicePhase(jobId, id, { fraction: percent / 100 });
}

// Python の補助プロセスからの段階の通知を画面へ送る。段階の通知だった場合は true
export function forwardPhase(jobId: string, event: Record<string, unknown>): boolean {
    if (event.kind !== 'phase' || typeof event.phase !== 'string') return false;
    voicePhase(jobId, event.phase as VoicePhaseId, {
        ...(typeof event.fraction === 'number' ? { fraction: event.fraction } : {}),
        // 繰り返す段階の何回目か (アンサンブルの何番目のモデルかなど)
        ...(typeof event.current === 'number' && typeof event.total === 'number'
            ? { current: event.current, total: event.total }
            : {}),
    });
    return true;
}

// Python の補助プロセスからの通知 (全体の進捗と段階) をジョブの通知にする。
// 全体の進捗 (0-1) は、この要求に割り当てた範囲 [from, to] (percent) に収める
export function workerEvents(jobId: string, from = 0, to = 100): (event: Record<string, unknown>) => void {
    return event => {
        if (event.kind === 'progress' && typeof event.fraction === 'number') {
            emitJobEvent({ jobId, kind: 'progress', percent: from + (to - from) * event.fraction });
        } else {
            forwardPhase(jobId, event);
        }
    };
}
