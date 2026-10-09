import React from 'react';
import { Alert, AlertTitle, Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { itemLabel } from './libraryItems';
import { openVoiceLibrary, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import type { FeatureReadiness, LibraryStatus, VoiceFeatureId } from '@shared/voice/types';
import { featureUnavailableReasonKey } from '@shared/voice/availability';

type ReadinessState = {
    feature: VoiceFeatureId;
    readiness: FeatureReadiness | null;
    status: LibraryStatus | null;
    refresh(): Promise<void>;
};

// 機能を使う前に、必要なもの (Python 本体・パッケージ一式・モデル) が揃っているかを調べる。
// ダウンロードで取得状況が変わったら (呼び出したダイアログを閉じる前でも) 読み直す
export function useFeatureReadiness(feature: VoiceFeatureId, extra: string[] = []): ReadinessState {
    const [readiness, setReadiness] = React.useState<FeatureReadiness | null>(null);
    const [status, setStatus] = React.useState<LibraryStatus | null>(null);
    const version = useVoiceLibraryStore(state => state.version);
    const extraKey = extra.join(',');
    const refresh = React.useCallback(async () => {
        const items = extraKey ? extraKey.split(',') : [];
        const [nextReadiness, nextStatus] = await Promise.all([
            window.kuraToolkit.voice.library.checkFeature(feature, items),
            window.kuraToolkit.voice.library.getStatus(),
        ]);
        setReadiness(nextReadiness);
        setStatus(nextStatus);
    }, [feature, extraKey]);
    React.useEffect(() => {
        void refresh();
    }, [refresh, version]);
    return { feature, readiness, status, refresh };
}

// 指定の項目がそろっていれば action を実行し、足りなければそれを選んだ状態でダウンロードを開く
export function whenInstalled(state: ReadinessState, required: string[], action: () => void): void {
    const byId = new Map((state.status?.items ?? []).map(item => [item.id, item]));
    const missing = required.filter(id => byId.get(id)?.status !== 'installed');
    if (missing.length > 0) openVoiceLibrary({ select: missing, focus: state.feature });
    else action();
}

type Props = {
    state: ReadinessState;
};

// 機能を使うのに必要なものが足りない場合の案内。ダウンロードは画面の「ダウンロード管理」から開く (案内にはボタンを
// 置かない。同じボタンが画面に 2 つ並ばないように)
export default function ReadinessAlert({ state }: Props) {
    const { t } = useTranslation();
    const { readiness, status } = state;
    if (!readiness) return null;
    // その環境で使えない機能 (音声機能全体を使えない環境と、ライブラリの配布物が無い機能)
    const unavailableKey = featureUnavailableReasonKey(readiness.platform, state.feature);
    if (unavailableKey) {
        return (
            <Alert severity='error'>
                <AlertTitle>
                    {t(
                        readiness.platform.supported
                            ? 'voice.platform.featureUnavailableTitle'
                            : 'voice.platform.unsupportedTitle'
                    )}
                </AlertTitle>
                {t(unavailableKey)}
            </Alert>
        );
    }
    if (readiness.ready) return null;
    const byId = new Map((status?.items ?? []).map(item => [item.id, item]));
    return (
        <Alert severity='info'>
            <AlertTitle>{t('voice.readiness.title')}</AlertTitle>
            <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                {t('voice.readiness.message')}
            </Typography>
            <Box component='ul' sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {readiness.missing.map(id => {
                    const item = byId.get(id);
                    return (
                        <Typography component='li' variant='body2' key={id}>
                            {item ? itemLabel(t, item) : id}
                        </Typography>
                    );
                })}
            </Box>
        </Alert>
    );
}
