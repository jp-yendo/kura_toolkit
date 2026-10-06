import React from 'react';
import { Box, Button, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import AppDialog from '../../components/common/AppDialog';
import FileDropZone from '../../components/common/FileDropZone';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import SeparationWorkbench from '../../components/voice/SeparationWorkbench';
import ExportDialog, { type ExportEntry } from '../../components/voice/ExportDialog';
import { treeOutputs } from '../../components/voice/separationTree';
import { formatDuration } from '../../components/voice/voiceFormat';
import { isCancelledError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { AUDIO_INPUT_EXTENSIONS, audioInputFilters } from '../../components/voice/audioInput';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useSeparationWorkStore } from '../../stores/separationWorkStore';
import DownloadIcon from '@mui/icons-material/Download';
import { openVoiceLibrary } from '../../stores/voiceLibraryStore';

export default function SeparationPage() {
    const { t } = useTranslation();
    const readiness = useFeatureReadiness('separation');
    const { workKey, source, sourceName, nodes, saveTargets, setSource, reset } = useSeparationWorkStore();
    const [exportOpen, setExportOpen] = React.useState(false);
    const [confirmReset, setConfirmReset] = React.useState(false);
    const { job, run, cancel } = useJobRunner();
    const ready = readiness.readiness?.ready ?? false;

    // 書き出す音 (保存対象にチェックした出力。木の順)
    const targets = treeOutputs(nodes).filter(output => saveTargets.includes(output.key));

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

    const discardWork = () => {
        void window.kuraToolkit.voice.media.discardWork(workKey);
        reset();
        setConfirmReset(false);
    };

    // ファイル名は、上の階層からの名前 (書き出す時点の名前) を「_」でつないだもの
    const exportEntries: ExportEntry[] = targets.map(output => ({
        key: output.key,
        label: output.path,
        suffix: '',
        fileName: output.path,
        resolve: async () => output.mediaPath,
    }));

    // 書き出しは押せる状態のままにし、保存対象が無いときは押したときに知らせる
    const openExport = () => {
        if (targets.length === 0) showNotice('info', t('voice.separation.exportNoTargets'));
        else setExportOpen(true);
    };

    return (
        <PageContainer>
            {/* 分離の画面は画面の切り替えが無いため、ダウンロード管理だけの行は音源を選ぶまで出し、
                選んだ後は元の音源の行に置く (表示領域を行 1 つ分使わないため) */}
            {!source && <VoiceFeatureHeader feature='separation' />}
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
                            size='small'
                            startIcon={<DownloadIcon />}
                            onClick={() => openVoiceLibrary({ focus: 'separation' })}
                        >
                            {t('voice.library.open')}
                        </Button>
                    </Panel>
                    <SeparationWorkbench store={useSeparationWorkStore} disabled={!ready} saveColumn />
                    {/* 書き出しは作業の最後なので、画面の一番下に置く */}
                    <Panel sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant='body2' sx={{ flexGrow: 1, minWidth: 200, lineHeight: 1.6 }}>
                            {t('voice.separation.exportSummary', { count: targets.length })}
                        </Typography>
                        <Button variant='contained' onClick={openExport}>
                            {t('voice.export.open')}
                        </Button>
                    </Panel>
                </>
            )}

            {source && (
                <ExportDialog
                    workKey={workKey}
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    entries={exportEntries}
                    sourcePath={source.sourcePath}
                    fixedSelection
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

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                status={job?.status}
                onCancel={cancel}
            />
        </PageContainer>
    );
}
