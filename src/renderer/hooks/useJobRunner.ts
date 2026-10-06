import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { JobEvent, JobPhase } from '@shared/types';

// 残り時間を示し始めるまでの経過時間 (秒)。始まった直後の見積もりは大きく外れるため
const ETA_MIN_ELAPSED_SEC = 3;

// 今の段階と、残り時間の見積もりに使う値
type PhaseState = JobPhase & {
    // 段階が始まった時刻 (ms) と、そのときの進み具合
    startedAt: number;
    startFraction: number;
};

export type RunningJob = {
    jobId: string;
    title: string;
    percent?: number;
    current?: number;
    total?: number;
    message?: string;
    // ジョブ固有の進捗 (ダウンロードの項目ごとの状態など)
    payload?: unknown;
    // 他の処理が GPU を使い終わるのを待っている
    waiting?: boolean;
    // 途中で中止できる処理か (中止できない処理では中止のボタンを出さない)
    cancellable: boolean;
    phase?: PhaseState;
    // 進捗ダイアログの状況の行 (今の段階と残り時間)
    status?: string;
};

// 残り時間の表記。長さに応じて丸める (10 秒未満は 1 秒、1 分未満は 5 秒、10 分未満は 10 秒、1 時間未満は 1 分、
// それ以上は 5 分単位)
export function formatEta(t: TFunction, seconds: number): string {
    if (seconds < 10) return t('jobEta.seconds', { seconds: Math.max(1, Math.ceil(seconds)) });
    if (seconds < 60) return t('jobEta.seconds', { seconds: Math.max(10, Math.round(seconds / 5) * 5) });
    if (seconds < 600) {
        const total = Math.round(seconds / 10) * 10;
        const minutes = Math.floor(total / 60);
        const rest = total % 60;
        return rest > 0 ? t('jobEta.minutesSeconds', { minutes, seconds: rest }) : t('jobEta.minutes', { minutes });
    }
    if (seconds < 3600) return t('jobEta.minutes', { minutes: Math.round(seconds / 60) });
    const total = Math.round(seconds / 300) * 5;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return minutes > 0 ? t('jobEta.hours', { hours, minutes }) : t('jobEta.hoursOnly', { hours });
}

// 段階の文言 (回数で数えられる段階は回数を添える) と、見積もった残り時間
function phaseStatus(t: TFunction, phase: PhaseState, now: number): string {
    const counted = phase.current !== undefined && phase.total !== undefined;
    const label = counted
        ? t(`jobPhasesCounted.${phase.id}`, { current: phase.current, total: phase.total })
        : t(`jobPhases.${phase.id}`);
    // 手順で進む処理は、何番目の手順かを前に付ける (「手順 2 / 5: 特徴を抽出しています」)
    const text =
        phase.step !== undefined && phase.steps !== undefined
            ? t('jobPhaseStep', { step: phase.step, steps: phase.steps, text: label })
            : label;
    const elapsed = (now - phase.startedAt) / 1000;
    const done = (phase.fraction ?? 0) - phase.startFraction;
    if (phase.fraction === undefined || phase.fraction >= 1 || done <= 0 || elapsed < ETA_MIN_ELAPSED_SEC) return text;
    const remaining = (elapsed / done) * (1 - phase.fraction);
    return `${text}  ${t('jobEta.left', { time: formatEta(t, remaining) })}`;
}

// 新しい段階の通知を反映する。段階が変わったとき、同じ段階の何回目かが変わったとき (アンサンブルの次のモデルなど)、
// または同じ段階で進み具合が戻ったときは、そこから見積もり直す
function nextPhase(previous: PhaseState | undefined, phase: JobPhase): PhaseState {
    const restart =
        !previous ||
        previous.id !== phase.id ||
        (phase.step !== undefined && phase.step !== previous.step) ||
        (phase.current !== undefined && phase.current !== previous.current) ||
        (phase.fraction !== undefined && previous.fraction !== undefined && phase.fraction < previous.fraction);
    if (restart) return { ...phase, startedAt: Date.now(), startFraction: phase.fraction ?? 0 };
    return { ...previous, ...phase };
}

// 長時間処理 (ジョブ) の実行と進捗の購読。進捗ダイアログに渡す状態を持つ
export function useJobRunner() {
    const { t } = useTranslation();
    const [job, setJob] = React.useState<RunningJob | null>(null);
    // 実行中のジョブの ID。開始の直後に届く通知 (GPU の順番待ちなど) を取りこぼさないよう、
    // 購読は常に行い、ジョブの ID は処理を始める前に ref へ設定する
    const activeJobIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        return window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== activeJobIdRef.current) return;
            if (event.kind === 'wait') {
                setJob(previous =>
                    previous && previous.jobId === event.jobId ? { ...previous, waiting: !!event.waiting } : previous
                );
                return;
            }
            if (event.kind !== 'progress') return;
            setJob(previous =>
                previous && previous.jobId === event.jobId
                    ? {
                          ...previous,
                          // null は、進み具合が分からない状態に戻す (不定の進捗バーにする)
                          percent: event.percent === null ? undefined : (event.percent ?? previous.percent),
                          current: event.current ?? previous.current,
                          total: event.total ?? previous.total,
                          message: event.message ?? previous.message,
                          payload: event.payload ?? previous.payload,
                          phase: event.phase ? nextPhase(previous.phase, event.phase) : previous.phase,
                      }
                    : previous
            );
        });
    }, []);

    const run = React.useCallback(
        async <T>(
            title: string,
            task: (jobId: string) => Promise<T>,
            options: { cancellable?: boolean } = {}
        ): Promise<T> => {
            const jobId = crypto.randomUUID();
            activeJobIdRef.current = jobId;
            setJob({ jobId, title, cancellable: options.cancellable ?? true });
            try {
                return await task(jobId);
            } finally {
                if (activeJobIdRef.current === jobId) activeJobIdRef.current = null;
                setJob(previous => (previous?.jobId === jobId ? null : previous));
            }
        },
        []
    );

    const cancel = React.useCallback(() => {
        if (job) void window.kuraToolkit.jobs.cancel(job.jobId);
    }, [job]);

    // 段階がある間は、残り時間の表示を 1 秒ごとに更新する
    const [now, setNow] = React.useState(() => Date.now());
    const hasPhase = !!job?.phase;
    React.useEffect(() => {
        if (!hasPhase) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [hasPhase]);

    // GPU の順番を待っている間は、進捗の欄にその旨を出す
    const shown = React.useMemo(() => {
        if (!job) return job;
        const status = job.phase ? phaseStatus(t, job.phase, Math.max(now, Date.now())) : undefined;
        return job.waiting ? { ...job, status, message: t('voice.common.waitingGpu') } : { ...job, status };
    }, [job, t, now]);

    return { job: shown, run, cancel };
}
