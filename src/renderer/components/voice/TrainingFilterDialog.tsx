import React from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import Panel from '../common/Panel';
import SectionLabel from '../common/SectionLabel';
import ProgressDialog from '../common/ProgressDialog';
import SyncPlayer from './SyncPlayer';
import {
    DereverbFields,
    filterSummary,
    LoudnessFields,
    NoiseRemovalFields,
    resolvedDereverbOption,
    resolvedNoiseOption,
    SilenceFields,
    useDereverbModels,
    useNoiseRemovalModels,
    type FilterModel,
} from './AudioFilterFields';
import { newWorkKey } from './voiceFormat';
import { isCancelledError, voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { hasTrainingFilter, trainingFilterDefaults, type TrainingFilterOptions } from '@shared/voice/audio-filters';
import type { MediaRef, TrainingAudio, VoiceModelFeature } from '@shared/voice/types';

type Props = {
    open: boolean;
    feature: VoiceModelFeature;
    setId: string;
    // 個々の音のフィルターでは対象の音。null は学習セットのすべての音に適用する
    audio: TrainingAudio | null;
    onClose(): void;
    // 学習セットの音を置き換えた (画面の一覧を読み直す)
    onChanged(): void;
};

type FilterResult = { id: string; media: MediaRef; summary: string };

// 加工の内容の欄。処理の順 (残響・エコーの除去 → ノイズ除去 → 無音部分の除去 → 音量をそろえる) に並べる
function FilterOptionFields({
    value,
    onChange,
    disabled,
    dereverbModels,
    noiseModels,
}: {
    value: TrainingFilterOptions;
    onChange(value: TrainingFilterOptions): void;
    disabled?: boolean;
    dereverbModels: FilterModel[];
    noiseModels: FilterModel[];
}) {
    return (
        <Stack spacing={1}>
            <DereverbFields
                models={dereverbModels}
                value={value.dereverb}
                disabled={disabled}
                onChange={dereverb => onChange({ ...value, dereverb })}
            />
            <NoiseRemovalFields
                models={noiseModels}
                value={value.noiseRemoval}
                disabled={disabled}
                onChange={noiseRemoval => onChange({ ...value, noiseRemoval })}
            />
            <SilenceFields
                mode='remove'
                value={value.removeSilence}
                disabled={disabled}
                onChange={removeSilence => onChange({ ...value, removeSilence })}
            />
            <LoudnessFields
                value={value.loudness}
                disabled={disabled}
                onChange={loudness => onChange({ ...value, loudness })}
            />
        </Stack>
    );
}

// 学習用の音のフィルター。
// - 個々の音: 「加工」を押すたびに、元の音から作った結果を下に足す (加工した結果をさらに加工することはしない)。
//   元の音と結果は、カードのクリックか再生で選び、確定で選んだ結果に置き換える。作った結果は、確定でもキャンセルでも
//   閉じる前に消す (確定した結果は学習セットへ移すため、消えるのは確定しなかったもの)
// - 学習セットのすべての音: 指定した加工をすべての音にかけて置き換える (結果は聞き比べない)
export default function TrainingFilterDialog({ open, feature, setId, audio, onClose, onChanged }: Props) {
    const { t } = useTranslation();
    const scope = audio ? 'audio' : 'set';
    const [options, setOptions] = React.useState<TrainingFilterOptions>(trainingFilterDefaults(scope));
    const [results, setResults] = React.useState<FilterResult[]>([]);
    // 選んでいる適用結果 (確定で学習セットの音と置き換えるもの。元の音は選べない)
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [workKey, setWorkKey] = React.useState(newWorkKey);
    const { job, run, cancel } = useJobRunner();
    const noiseModels = useNoiseRemovalModels();
    const dereverbModels = useDereverbModels();
    // 確定 (学習セットの音の置き換え) の途中
    const [confirming, setConfirming] = React.useState(false);
    const busy = job !== null || confirming;

    // 開くたびに初期の状態に戻す (作業も新しくする)
    React.useEffect(() => {
        if (!open) return;
        setOptions(trainingFilterDefaults(audio ? 'audio' : 'set'));
        setResults([]);
        setSelectedId(null);
        setWorkKey(newWorkKey());
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点で初期化する
    }, [open]);

    // 閉じる。作った結果は消す (確定した結果は学習セットへ移してあるため残らない)
    const close = () => {
        void window.kuraToolkit.voice.media.discardWork(workKey);
        onClose();
    };

    const handleError = (error: unknown) => {
        if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
        else showNotice('error', voiceErrorMessage(t, error), 12000);
    };

    const request = (): TrainingFilterOptions => ({
        ...options,
        dereverb: resolvedDereverbOption(options.dereverb, dereverbModels),
        noiseRemoval: resolvedNoiseOption(options.noiseRemoval, noiseModels),
    });

    const process = async () => {
        if (!audio) return;
        const current = request();
        try {
            const result = await run(t('voice.filters.processing'), jobId =>
                window.kuraToolkit.voice.trainingSets.filterAudio(jobId, feature, setId, audio.id, workKey, current)
            );
            const id = crypto.randomUUID();
            setResults(previous => [
                ...previous,
                {
                    id,
                    media: result.media,
                    summary: filterSummary(t, current, [...dereverbModels, ...noiseModels]).join(' / '),
                },
            ]);
            setSelectedId(id);
        } catch (error) {
            handleError(error);
        }
    };

    const confirm = async () => {
        if (!audio) return;
        const chosen = results.find(item => item.id === selectedId);
        setConfirming(true);
        try {
            if (chosen) {
                await window.kuraToolkit.voice.trainingSets.replaceAudio(
                    feature,
                    setId,
                    audio.id,
                    workKey,
                    chosen.media.path
                );
                showNotice('success', t('voice.filters.replaced'));
                onChanged();
            }
            close();
        } catch (error) {
            handleError(error);
        } finally {
            setConfirming(false);
        }
    };

    const applyAll = async () => {
        const current = request();
        try {
            await run(t('voice.filters.applyingAll'), jobId =>
                window.kuraToolkit.voice.trainingSets.filterAll(jobId, feature, setId, current)
            );
            showNotice('success', t('voice.filters.appliedAll'));
            onChanged();
            close();
        } catch (error) {
            handleError(error);
        }
    };

    // 2 列のときの列 (列ごとにスクロールする)
    const columnSx = {
        pt: 1,
        minHeight: 0,
        overflowY: { md: 'auto' },
        scrollbarGutter: { md: 'stable' },
        pr: { md: 1.5 },
    } as const;

    // 音のカード。適用結果はクリック (再生を含む) で選ぶ。元の音は聞き比べるためのもので、選べない
    // (元の音のままにする場合はキャンセルで閉じる)
    const card = (id: string, label: string, summary: string | null, media: MediaRef, selectable: boolean) => (
        <Panel
            key={id}
            selected={selectable && selectedId === id}
            onClick={selectable ? () => setSelectedId(id) : undefined}
        >
            <Stack spacing={0.5}>
                <Typography variant='body2' sx={{ fontWeight: 600 }}>
                    {label}
                </Typography>
                {summary && (
                    <Typography variant='caption' color='text.secondary'>
                        {summary}
                    </Typography>
                )}
                <SyncPlayer source={{ key: id, url: media.url }} keepPosition={false} />
            </Stack>
        </Panel>
    );

    return (
        <>
            <AppDialog
                open={open}
                onClose={busy ? undefined : close}
                maxWidth={audio ? 'lg' : 'md'}
                fullWidth
                // 個々の音では、高さは中身によらず一定にし、列ごとにスクロールする (分岐のダイアログと同じ)
                slotProps={audio ? { paper: { sx: { height: 'min(760px, calc(100% - 64px))' } } } : undefined}
            >
                <DialogTitle sx={{ overflowWrap: 'anywhere' }}>
                    {audio ? t('voice.filters.filterTitle', { name: audio.name }) : t('voice.filters.filterAllTitle')}
                </DialogTitle>
                {audio ? (
                    // 個々の音: 左に加工の設定 (幅は 400px に抑える)、右に波形のプレビュー (元の音と加工の結果を聞き比べ、選ぶ。
                    // 残りの幅を使う)。2 列のときは列ごとに
                    // スクロールし、1 列のときは全体をスクロールする。列はスクロールバーの幅を常に空け、右に余白を取る
                    <DialogContent
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '400px minmax(0, 1fr)' },
                            gridTemplateRows: { md: 'minmax(0, 1fr)' },
                            columnGap: 3,
                            rowGap: 2,
                            overflowY: { xs: 'auto', md: 'hidden' },
                        }}
                    >
                        <Stack sx={columnSx}>
                            <FilterOptionFields
                                value={options}
                                onChange={setOptions}
                                disabled={busy}
                                dereverbModels={dereverbModels}
                                noiseModels={noiseModels}
                            />
                        </Stack>
                        <Stack spacing={2} sx={columnSx}>
                            <SectionLabel>{t('voice.filters.preview')}</SectionLabel>
                            {card('original', t('voice.filters.original'), null, audio.media, false)}
                            {/* 元の音の下に目立つように置く。押すたびに、チェックしているフィルターを元の音にかけた結果を下に足す */}
                            <Button
                                variant='contained'
                                fullWidth
                                startIcon={<GraphicEqIcon />}
                                disabled={busy || !hasTrainingFilter(options)}
                                onClick={() => void process()}
                            >
                                {t('voice.filters.process')}
                            </Button>
                            {results.map((item, index) =>
                                card(
                                    item.id,
                                    t('voice.filters.processResult', { index: index + 1 }),
                                    item.summary,
                                    item.media,
                                    true
                                )
                            )}
                        </Stack>
                    </DialogContent>
                ) : (
                    <DialogContent>
                        <Stack spacing={2} sx={{ pt: 1 }}>
                            <FilterOptionFields
                                value={options}
                                onChange={setOptions}
                                disabled={busy}
                                dereverbModels={dereverbModels}
                                noiseModels={noiseModels}
                            />
                        </Stack>
                    </DialogContent>
                )}
                <DialogActions>
                    <Button onClick={close} disabled={busy}>
                        {t('common.cancel')}
                    </Button>
                    {audio ? (
                        <Button
                            variant='contained'
                            disabled={busy || selectedId === null}
                            onClick={() => void confirm()}
                        >
                            {t('voice.filters.confirm')}
                        </Button>
                    ) : (
                        <Button
                            variant='contained'
                            disabled={busy || !hasTrainingFilter(options)}
                            onClick={() => void applyAll()}
                        >
                            {t('voice.filters.applyAll')}
                        </Button>
                    )}
                </DialogActions>
            </AppDialog>
            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                status={job?.status}
                message={job?.message ?? ''}
                onCancel={cancel}
            />
        </>
    );
}
