import { emitJobEvent, emitPhase } from '../job-manager';
import type { VoicePhaseId } from '../../../shared/voice/types';

// 音声機能のジョブの進捗と段階を画面へ送る。

// 手順で進むジョブ (重さの違う処理を順に行うもの)。手順ごとにゲージをその手順の進み具合 (0-100%) にし、段階に何番目の
// 手順かを添える (「手順 2 / 4: ノイズを除去しています」。学習と同じ見せ方)。進み具合の分からない段階ではゲージを
// 不定にし、段階の文言だけを変える
const stepJobs = new Map<string, { step: number; steps: number }>();

// 手順で進むジョブとして fn を行う (steps は手順の数。手順に入るときに nextStep を呼ぶ)
export async function withSteps<T>(jobId: string, steps: number, fn: () => Promise<T>): Promise<T> {
    stepJobs.set(jobId, { step: 0, steps: Math.max(1, steps) });
    try {
        const result = await fn();
        // 最後の手順も 100% で終える (最後の進捗を出さずに終わる処理があるため)
        emitJobEvent({ jobId, kind: 'progress', percent: 100 });
        return result;
    } finally {
        stepJobs.delete(jobId);
    }
}

// 次の手順に入る (手順で進むジョブでなければ何もしない)。前の手順は 100% にしてから移る (最後の進捗を出さずに終わる
// 処理 (ffmpeg が 100% を出す前に終わる・最後の処理を飛ばすなど) でも、手順の終わりでゲージが途中で止まらないように)
export function nextStep(jobId: string): void {
    const state = stepJobs.get(jobId);
    if (!state) return;
    if (state.step > 0) emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    state.step = Math.min(state.steps, state.step + 1);
    emitJobEvent({ jobId, kind: 'progress', percent: 0 });
}

// 段階を知らせる (fraction は段階の中の進み具合 0-1。分からない段階では省略する)
export function voicePhase(
    jobId: string,
    id: VoicePhaseId,
    progress: { fraction?: number; current?: number; total?: number; step?: number; steps?: number } = {}
): void {
    const state = stepJobs.get(jobId);
    if (!state) {
        emitPhase(jobId, id, progress);
        return;
    }
    emitJobEvent({
        jobId,
        kind: 'progress',
        // 分からない段階は不定にする (null)
        percent: progress.fraction !== undefined ? progress.fraction * 100 : null,
        phase: {
            id,
            ...progress,
            // 手順が 1 つだけのときは手順を添えない
            ...(state.steps > 1 && state.step > 0 ? { step: state.step, steps: state.steps } : {}),
        },
    });
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
// 全体の進捗 (0-1) は、この要求に割り当てた範囲 [from, to] (percent) に収める。手順で進むジョブでは、ゲージは段階の
// 進み具合で動かすため、全体の進捗の通知は使わない
export function workerEvents(jobId: string, from = 0, to = 100): (event: Record<string, unknown>) => void {
    return event => {
        if (event.kind === 'progress' && typeof event.fraction === 'number') {
            if (stepJobs.has(jobId)) return;
            emitJobEvent({ jobId, kind: 'progress', percent: from + (to - from) * event.fraction });
        } else {
            forwardPhase(jobId, event);
        }
    };
}
