import React from 'react';
import type { JobEvent } from '@shared/types';

// 動画トラック・タグ管理の処理 (ジョブ) の実行と、進捗ダイアログに出す内容 (題名・進み具合)
export function useTrackTagJob() {
    const [jobId, setJobId] = React.useState<string | null>(null);
    const [percent, setPercent] = React.useState<number | undefined>(undefined);
    // 処理の前の読み込み・確認の最中か (取り消せないため、進捗ダイアログに中止のボタンを出さない)
    const [preparing, setPreparing] = React.useState(false);
    // 進捗ダイアログの題名 (何をしているか)。閉じる間に空にならないよう、次に始めるまで残す
    const [title, setTitle] = React.useState('');

    React.useEffect(() => {
        if (!jobId) return;
        return window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== jobId || event.kind !== 'progress') return;
            setPercent(event.percent ?? undefined);
        });
    }, [jobId]);

    // 処理を実行する (失敗はそのまま投げる)
    const run = async <T>(jobTitle: string, execute: (id: string) => Promise<T>): Promise<T> => {
        const id = crypto.randomUUID();
        setTitle(jobTitle);
        setPercent(undefined);
        setJobId(id);
        try {
            return await execute(id);
        } finally {
            setJobId(null);
        }
    };

    // 処理の前の読み込み・確認を始める (activity は進捗ダイアログの題名) か、終える (null)
    const setActivity = (activity: string | null) => {
        setPreparing(activity !== null);
        if (activity !== null) setTitle(activity);
    };

    return {
        busy: jobId !== null || preparing,
        title,
        percent: jobId ? percent : undefined,
        cancel: jobId ? () => void window.kuraToolkit.jobs.cancel(jobId) : undefined,
        run,
        setActivity,
    };
}

export type TrackTagJob = ReturnType<typeof useTrackTagJob>;
