import React from 'react';
import { useTranslation } from 'react-i18next';
import { voiceErrorMessage } from './voiceErrors';
import { showNotice } from '../../stores/noticeStore';
import type { TrainingSetSummary, VoiceModelFeature } from '@shared/voice/types';

// 機能ごとに最後に選んだ学習セット (画面を移っても選んだものを保つ。アプリを起動し直すと、更新の新しいものを選ぶ)
const lastSelected: Partial<Record<VoiceModelFeature, string>> = {};

export type TrainingSetsState = {
    sets: TrainingSetSummary[];
    // 一覧を読み終えたか (読み終えるまでは、学習セットが無いという案内を出さない)
    loaded: boolean;
    selected: TrainingSetSummary | null;
    select(id: string): void;
    reload(): Promise<void>;
};

// 学習セットの一覧と、選んでいる学習セット
export function useTrainingSets(feature: VoiceModelFeature): TrainingSetsState {
    const { t } = useTranslation();
    const [sets, setSets] = React.useState<TrainingSetSummary[]>([]);
    const [loaded, setLoaded] = React.useState(false);
    const [selectedId, setSelectedId] = React.useState(lastSelected[feature] ?? '');

    const select = React.useCallback(
        (id: string) => {
            lastSelected[feature] = id;
            setSelectedId(id);
        },
        [feature]
    );

    const reload = React.useCallback(async () => {
        try {
            setSets(await window.kuraToolkit.voice.trainingSets.list(feature));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 12000);
        } finally {
            setLoaded(true);
        }
    }, [feature, t]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    // 選んでいる学習セットが無くなった (削除した・まだ選んでいない) 場合は、更新の新しいものを選ぶ
    const selected = sets.find(set => set.id === selectedId) ?? sets[0] ?? null;
    return { sets, loaded, selected, select, reload };
}
