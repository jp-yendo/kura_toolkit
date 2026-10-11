import React from 'react';
import { useTranslation } from 'react-i18next';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { showNotice } from '../../stores/noticeStore';
import { useVideoSplitMergeStore } from '../../stores/videoSplitMergeStore';
import { videoErrorMessage } from './videoFormat';
import type { JobEvent, VideoJobResult } from '@shared/types';

type RunningJob = {
    jobId: string;
    percent?: number;
    current?: number;
    total?: number;
};

// 動画分割・結合の処理 (ジョブ) の実行と、進み具合・結果の状態
export function useVideoJob() {
    const { t } = useTranslation();
    const [job, setJob] = React.useState<RunningJob | null>(null);
    // 処理の前の解析・確認の最中 (取り消せないため、進捗ダイアログに中止のボタンを出さない)
    const [loading, setLoading] = React.useState(false);
    const [resultOutputs, setResultOutputs] = React.useState<string[] | null>(null);
    // 完了ダイアログ内でログを開いているか (実行のたびに閉じた状態から始める)
    const [logOpen, setLogOpen] = React.useState(false);

    const activeJobId = job?.jobId;
    React.useEffect(() => {
        if (!activeJobId) return;
        const unsubscribe = window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== activeJobId) return;
            if (event.kind === 'log' && event.message) {
                useVideoSplitMergeStore.getState().appendLog(event.message);
            } else if (event.kind === 'progress') {
                setJob(previous =>
                    previous && previous.jobId === event.jobId
                        ? {
                              ...previous,
                              percent: event.percent ?? previous.percent,
                              current: event.current ?? previous.current,
                              total: event.total ?? previous.total,
                          }
                        : previous
                );
            }
        });
        return unsubscribe;
    }, [activeJobId]);
    // 全体の進み具合は処理する長さに比例するため、そこから残り時間を見積もる (再エンコードは時間がかかる)
    const remaining = useRemainingTime(activeJobId ?? null, job?.percent);

    // 処理を実行し、終わったら出力したファイルを完了ダイアログで示す (キャンセルした場合は示さない)
    const runJob = async (execute: (jobId: string) => Promise<VideoJobResult>) => {
        const jobId = crypto.randomUUID();
        useVideoSplitMergeStore.getState().clearLogs();
        setLogOpen(false);
        setJob({ jobId });
        try {
            const result = await execute(jobId);
            if (!result.cancelled) {
                setResultOutputs(result.outputs);
            }
        } catch (error) {
            showNotice('warning', videoErrorMessage(t, error));
        } finally {
            setJob(null);
        }
    };

    const cancel = () => {
        if (job) void window.kuraToolkit.jobs.cancel(job.jobId);
    };

    return {
        job,
        loading,
        setLoading,
        busy: job !== null || loading,
        runJob,
        cancel,
        remaining,
        resultOutputs,
        closeResult: () => setResultOutputs(null),
        logOpen,
        toggleLog: () => setLogOpen(open => !open),
    };
}

export type VideoJobControls = Pick<ReturnType<typeof useVideoJob>, 'busy' | 'setLoading' | 'runJob'>;
