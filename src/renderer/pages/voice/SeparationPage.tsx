import React from 'react';
import { Box, Button, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import SeparationWorkbench, { trackLabel } from '../../components/voice/SeparationWorkbench';
import ExportDialog, { type ExportEntry } from '../../components/voice/ExportDialog';
import { computeTracks, SOURCE_KEY, vocalsAndAccompaniment } from '../../components/voice/separationTracks';
import { formatDuration } from '../../components/voice/voiceFormat';
import { isCancelledError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { AUDIO_INPUT_EXTENSIONS, audioInputFilters } from '../../components/voice/audioInput';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useSeparationWorkStore } from '../../stores/separationWorkStore';
import { discardWorkAfterHandoff, useVoiceHandoffStore } from '../../stores/voiceHandoffStore';

export default function SeparationPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const readiness = useFeatureReadiness('separation');
    const { workKey, source, sourceName, stages, setSource, reset } = useSeparationWorkStore();
    const [exportOpen, setExportOpen] = React.useState(false);
    const [confirmReset, setConfirmReset] = React.useState(false);
    const { job, run, cancel } = useJobRunner();
    const ready = readiness.readiness?.ready ?? false;

    const { tracks } = computeTracks(source?.media.path ?? null, stages);
    const outputs = tracks.filter(track => track.key !== SOURCE_KEY);

    const loadFile = async (paths: string[]) => {
        const sourcePath = paths[0];
        if (!sourcePath) return;
        try {
            const prepared = await run(t('voice.common.loading'), jobId =>
                window.kuraToolkit.voice.media.prepareInput(jobId, workKey, sourcePath)
            );
            setSource(prepared, sourcePath.split(/[\\/]/).pop() ?? sourcePath);
        } catch (error) {
            if (isCancelledError(error)) return;
            showNotice('error', voiceErrorMessage(t, error), 10000);
        }
    };

    // 変換の画面へ渡した結果がある作業は、変換の画面が使い終わってから消す
    const discardWork = () => {
        discardWorkAfterHandoff(workKey);
        reset();
        setConfirmReset(false);
    };

    const exportEntries: ExportEntry[] = outputs.map(track => ({
        key: track.key,
        label: trackLabel(t, track),
        suffix: trackLabel(t, track),
        resolve: async jobId =>
            track.paths.length === 1
                ? track.paths[0]
                : (await window.kuraToolkit.voice.media.mix(jobId, workKey, track.paths, source?.channels ?? 2)).path,
    }));

    const { vocals, accompaniment } = vocalsAndAccompaniment(tracks);

    return (
        <PageContainer>
            <VoiceFeatureHeader feature='separation' />
            <ReadinessAlert state={readiness} />
            {!source ? (
                <FileDropZone
                    onFiles={paths => void loadFile(paths)}
                    filters={audioInputFilters(t)}
                    accept={AUDIO_INPUT_EXTENSIONS}
                    hint={t('voice.separation.dropHint')}
                    sx={{
                        flexGrow: 1,
                        minHeight: 240,
                        opacity: ready ? 1 : 0.6,
                        pointerEvents: ready ? 'auto' : 'none',
                    }}
                />
            ) : (
                <>
                    {/* 作業を破棄する「新しい作業」は、送る・書き出しの操作から離して元の音源の側に置く */}
                    <Panel sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Stack sx={{ minWidth: 0 }}>
                            <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap title={source.sourcePath}>
                                {sourceName}
                            </Typography>
                            <Typography variant='caption' color='text.secondary'>
                                {formatDuration(source.media.durationSec)} /{' '}
                                {source.channels === 1 ? t('audioPage.mono') : t('audioPage.stereo')}
                            </Typography>
                        </Stack>
                        <Button startIcon={<RestartAltIcon />} onClick={() => setConfirmReset(true)}>
                            {t('voice.common.newWork')}
                        </Button>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            variant='outlined'
                            startIcon={<RecordVoiceOverIcon />}
                            disabled={!vocals}
                            onClick={() => {
                                if (!vocals) return;
                                useVoiceHandoffStore.getState().send({
                                    from: 'separation',
                                    workKey,
                                    name: sourceName,
                                    sourcePath: source.sourcePath,
                                    sourceMedia: source.media,
                                    vocals: vocals.paths,
                                    accompaniment,
                                    channels: source.channels,
                                });
                                navigate('/audio/conversion');
                            }}
                        >
                            {t('voice.separation.sendToConversion')}
                        </Button>
                        <Button
                            variant='contained'
                            startIcon={<SaveAltIcon />}
                            disabled={outputs.length === 0}
                            onClick={() => setExportOpen(true)}
                        >
                            {t('voice.export.open')}
                        </Button>
                    </Panel>
                    <SeparationWorkbench store={useSeparationWorkStore} disabled={!ready} />
                </>
            )}

            {source && (
                <ExportDialog
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    entries={exportEntries}
                    sourcePath={source.sourcePath}
                />
            )}

            <AppDialog open={confirmReset} onClose={() => setConfirmReset(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.common.newWork')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.common.newWorkConfirm')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmReset(false)}>{t('common.cancel')}</Button>
                    <Button variant='contained' color='warning' onClick={discardWork}>
                        {t('voice.common.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <ProgressDialog open={job !== null} title={job?.title ?? ''} percent={job?.percent} onCancel={cancel} />
        </PageContainer>
    );
}
