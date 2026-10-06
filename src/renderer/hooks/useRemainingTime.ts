import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatEta } from './useJobRunner';

// 残り時間を示し始めるまでの経過時間 (秒)。始まった直後の見積もりは大きく外れるため
const ETA_MIN_ELAPSED_SEC = 3;

// 全体の進み具合 (%) から見積もった残り時間の表記 (「残り 約 …」)。全体の進み具合が処理の量 (音声の長さや
// コピーするバイト数) に比例している処理で使う。jobKey が変わったら (別の処理が始まったら) 見積もり直す。
// 見積もれない間 (始まった直後・進んでいない・終わった) は undefined
export function useRemainingTime(jobKey: string | null, percent: number | undefined): string | undefined {
    const { t } = useTranslation();
    // 見積もりの起点 (処理が始まって最初に進み具合が届いた時刻と、そのときの進み具合)
    const [origin, setOrigin] = React.useState<{ key: string; at: number; percent: number } | null>(null);
    const [now, setNow] = React.useState(() => Date.now());

    React.useEffect(() => {
        if (!jobKey || percent === undefined) return;
        setOrigin(previous => (previous?.key === jobKey ? previous : { key: jobKey, at: Date.now(), percent }));
    }, [jobKey, percent]);

    // 処理の間は、残り時間の表示を 1 秒ごとに更新する
    React.useEffect(() => {
        if (!jobKey) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [jobKey]);

    if (!jobKey || percent === undefined || origin?.key !== jobKey || percent >= 100) return undefined;
    const elapsed = (now - origin.at) / 1000;
    const done = percent - origin.percent;
    if (elapsed < ETA_MIN_ELAPSED_SEC || done <= 0) return undefined;
    const remaining = (elapsed / done) * (100 - percent);
    return t('jobEta.left', { time: formatEta(t, remaining) });
}
