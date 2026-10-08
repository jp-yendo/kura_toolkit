import React from 'react';
import {
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import SectionLabel from '../common/SectionLabel';
import {
    DereverbFields,
    filterSummary,
    LoudnessFields,
    NoiseRemovalFields,
    resolvedDereverbOption,
    resolvedNoiseOption,
    SilenceFields,
    type FilterModel,
} from './AudioFilterFields';
import { EffectFields, effectsSummary } from './AudioEffectFields';
import { SEPARATION_LOUDNESS_DEFAULT_LUFS } from '@shared/voice/audio-filters';
import { hasEffect, type EffectsOptions } from '@shared/voice/audio-effects';
import type { CandidateFilters, SeparationOtherChoice } from '@shared/voice/types';

type Props = {
    open: boolean;
    // フィルターをかける候補の名前 (見出しに示す)
    name: string;
    // 前回の値 (チェックはすべて外した状態で開き、値だけを引き継ぐ)
    initial: CandidateFilters;
    // 出力がステレオになるか (リバーブのステレオの広がりの添え書きに使う)
    stereo: boolean;
    dereverbModels: FilterModel[];
    noiseModels: FilterModel[];
    // フィルターをかける。成功したら true (ダイアログを閉じる)。失敗・中止のときは開いたまま
    onRun(filters: CandidateFilters): Promise<boolean>;
    onClose(): void;
    disabled?: boolean;
};

type Group = 'process' | 'effects';

// チェックをすべて外す (値は残す)
function uncheckedProcess(process: SeparationOtherChoice): SeparationOtherChoice {
    return {
        dereverb: { ...process.dereverb, enabled: false },
        noiseRemoval: { ...process.noiseRemoval, enabled: false },
        muteSilence: { ...process.muteSilence, enabled: false },
        loudness: { ...process.loudness, enabled: false },
    };
}

function uncheckedEffects(effects: EffectsOptions): EffectsOptions {
    return {
        eq: { ...effects.eq, enabled: false },
        compressor: { ...effects.compressor, enabled: false },
        deesser: { ...effects.deesser, enabled: false },
        chorus: { ...effects.chorus, enabled: false },
        delay: { ...effects.delay, enabled: false },
        reverb: { ...effects.reverb, enabled: false },
    };
}

// 音声変換の候補にかけるフィルターのダイアログ。「除去・調整」(分岐の「除去・調整」と同じ加工) と「エフェクト」(分岐の
// 「エフェクト」と同じもの) を切り替えて設定し、チェックしたものを 1 回でかける (処理の順: 除去 → 無音の処理 →
// エフェクト → 音量をそろえる)。結果は新しい候補として、元にした候補のすぐ下に加わる
export default function CandidateFilterDialog({
    open,
    name,
    initial,
    stereo,
    dereverbModels,
    noiseModels,
    onRun,
    onClose,
    disabled,
}: Props) {
    const { t } = useTranslation();
    const [group, setGroup] = React.useState<Group>('process');
    const [process, setProcess] = React.useState<SeparationOtherChoice>(uncheckedProcess(initial.process));
    const [effects, setEffects] = React.useState<EffectsOptions>(uncheckedEffects(initial.effects));
    const [running, setRunning] = React.useState(false);

    // 開くたびに、チェックをすべて外した状態に戻す (値は前回のものを引き継ぐ)
    React.useEffect(() => {
        if (!open) return;
        setGroup('process');
        setProcess(uncheckedProcess(initial.process));
        setEffects(uncheckedEffects(initial.effects));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点の値で初期化する
    }, [open]);

    const busy = disabled || running;
    // 実行するときの設定 (モデルは取得済みのものに合わせる)
    const resolved: CandidateFilters = {
        process: {
            ...process,
            dereverb: resolvedDereverbOption(process.dereverb, dereverbModels),
            noiseRemoval: resolvedNoiseOption(process.noiseRemoval, noiseModels),
        },
        effects,
    };
    const names = [...dereverbModels, ...noiseModels];
    // 選んだ内容 (処理の順)。音量をそろえるは最後に行うため、エフェクトの後に置く
    const summary = [
        ...filterSummary(t, { ...resolved.process, loudness: undefined }, names),
        ...effectsSummary(t, effects),
        ...filterSummary(t, { loudness: resolved.process.loudness }, names),
    ];
    const hasProcess =
        resolved.process.dereverb.enabled ||
        process.noiseRemoval.enabled ||
        process.muteSilence.enabled ||
        process.loudness.enabled;
    const runnable = hasProcess || hasEffect(effects);

    const run = async () => {
        setRunning(true);
        try {
            if (await onRun(resolved)) onClose();
        } finally {
            setRunning(false);
        }
    };

    return (
        <AppDialog
            open={open}
            onClose={busy ? undefined : onClose}
            maxWidth='sm'
            fullWidth
            slotProps={{ paper: { sx: { height: 'min(760px, calc(100% - 64px))' } } }}
        >
            <DialogTitle sx={{ overflowWrap: 'anywhere' }}>{t('voice.conversion.filterTitle', { name })}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <ToggleButtonGroup
                    exclusive
                    size='small'
                    color='primary'
                    disabled={busy}
                    value={group}
                    onChange={(_event, next: Group | null) => next && setGroup(next)}
                    sx={{ mt: 1 }}
                >
                    <ToggleButton value='process' sx={{ flexGrow: 1 }}>
                        {t('voice.separation.pickModes.other')}
                    </ToggleButton>
                    <ToggleButton value='effects' sx={{ flexGrow: 1 }}>
                        {t('voice.separation.pickModes.effects')}
                    </ToggleButton>
                </ToggleButtonGroup>
                {/* どちらのまとまりも、処理の順に並べる */}
                {/* スライダーのつまみが端で欄の外へわずかにはみ出すため、横には広げない */}
                <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 1.5 }}>
                    {group === 'process' ? (
                        <Stack spacing={1}>
                            <DereverbFields
                                models={dereverbModels}
                                value={process.dereverb}
                                disabled={busy}
                                onChange={dereverb => setProcess({ ...process, dereverb })}
                            />
                            <NoiseRemovalFields
                                models={noiseModels}
                                value={process.noiseRemoval}
                                disabled={busy}
                                onChange={noiseRemoval => setProcess({ ...process, noiseRemoval })}
                            />
                            <SilenceFields
                                mode='mute'
                                value={process.muteSilence}
                                disabled={busy}
                                onChange={muteSilence => setProcess({ ...process, muteSilence })}
                            />
                            <LoudnessFields
                                value={process.loudness}
                                defaultLufs={SEPARATION_LOUDNESS_DEFAULT_LUFS}
                                disabled={busy}
                                onChange={loudness => setProcess({ ...process, loudness })}
                            />
                        </Stack>
                    ) : (
                        <EffectFields value={effects} stereo={stereo} disabled={busy} onChange={setEffects} />
                    )}
                </Box>
                <Box>
                    <SectionLabel>{t('voice.separation.selectedTitle')}</SectionLabel>
                    {summary.length === 0 ? (
                        <Typography variant='body2' color='text.secondary'>
                            {t('voice.separation.selectedNone')}
                        </Typography>
                    ) : (
                        <Stack spacing={0.5} component='ol' sx={{ m: 0, pl: 2.5 }}>
                            {summary.map(part => (
                                <Typography key={part} component='li' variant='body2' sx={{ overflowWrap: 'anywhere' }}>
                                    {part}
                                </Typography>
                            ))}
                        </Stack>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>
                    {t('common.cancel')}
                </Button>
                <Button variant='contained' disabled={busy || !runnable} onClick={() => void run()}>
                    {t('voice.conversion.filterRun')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
