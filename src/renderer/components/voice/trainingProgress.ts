import type { TFunction } from 'i18next';
import type { TrainingProgress } from '@shared/voice/types';

// 学習の進捗 (段階と回数) を進捗ダイアログの一行にする
export function trainingStatus(t: TFunction, payload: unknown): string | undefined {
    const progress = payload as TrainingProgress | undefined;
    if (!progress?.stage) return undefined;
    const stage = t(`voice.training.stages.${progress.stage}`);
    if (progress.epoch && progress.totalEpochs) {
        return t('voice.training.epochStatus', { stage, epoch: progress.epoch, total: progress.totalEpochs });
    }
    return stage;
}
