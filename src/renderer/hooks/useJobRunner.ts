import React from 'react';
import { useTranslation } from 'react-i18next';
import type { JobEvent } from '@shared/types';

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
};

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
                          percent: event.percent ?? previous.percent,
                          current: event.current ?? previous.current,
                          total: event.total ?? previous.total,
                          message: event.message ?? previous.message,
                          payload: event.payload ?? previous.payload,
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

    // GPU の順番を待っている間は、進捗の欄にその旨を出す
    const shown = React.useMemo(
        () => (job?.waiting ? { ...job, message: t('voice.common.waitingGpu') } : job),
        [job, t]
    );

    return { job: shown, run, cancel };
}
