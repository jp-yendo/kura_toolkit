import { Button, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../../components/common/AppDialog';
import LogView from '../../components/common/LogView';
import PageContainer from '../../components/common/PageContainer';
import ProgressDialog from '../../components/common/ProgressDialog';
import MergeView from '../../components/video/MergeView';
import SourceSelect from '../../components/video/SourceSelect';
import SplitView from '../../components/video/SplitView';
import { useVideoJob } from '../../components/video/useVideoJob';
import { VIDEO_EXTENSIONS, videoErrorMessage } from '../../components/video/videoFormat';
import { showNotice } from '../../stores/noticeStore';
import { useVideoSplitMergeStore } from '../../stores/videoSplitMergeStore';
import type { VideoProbeResult } from '@shared/types';

function fileName(filePath: string): string {
    return filePath.slice(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1);
}

function hasMediaStream(probe: VideoProbeResult): boolean {
    return probe.streams.some(stream => stream.kind === 'video' || stream.kind === 'audio');
}

// 動画分割・結合の画面。初めにチャプターで分割するか結合するかのファイルを受け取り、それぞれの画面へ移る
export default function VideoSplitMergePage() {
    const { t } = useTranslation();
    const screen = useVideoSplitMergeStore(state => state.screen);
    const logs = useVideoSplitMergeStore(state => state.logs);
    const jobs = useVideoJob();
    const { setLoading } = jobs;

    // チャプターで分割するファイルを読み込む (チャプターの無いファイルは受け付けない)
    const loadSplit = async (paths: string[]) => {
        const input = paths[0];
        if (!input) return;
        setLoading(true);
        try {
            const probe = await window.kuraToolkit.videoSplitMerge.probe(input);
            if (probe.chapters.length === 0) {
                showNotice('warning', t('videoSplitMergePage.noChapters'));
                return;
            }
            useVideoSplitMergeStore.getState().setInput(input, probe);
        } catch (error) {
            showNotice('warning', videoErrorMessage(t, error));
        } finally {
            setLoading(false);
        }
    };

    // 結合するファイルを読み込み、一覧の末尾へ足す (読み込めなかったファイルは名前を知らせて除く)
    const addMerge = async (paths: string[]) => {
        // ファイル選択のダイアログで「すべてのファイル」を選ぶと対象外の形式も選べるため、ここでも絞り込む
        const accepted = paths.filter(filePath => {
            const dot = filePath.lastIndexOf('.');
            return dot >= 0 && VIDEO_EXTENSIONS.includes(filePath.slice(dot + 1).toLowerCase());
        });
        if (accepted.length === 0) {
            if (paths.length > 0) showNotice('warning', t('videoSplitMergePage.unsupportedFile'));
            return;
        }
        setLoading(true);
        const entries: Array<{ input: string; probe: VideoProbeResult }> = [];
        const failed: string[] = [];
        try {
            for (const input of accepted) {
                try {
                    const probe = await window.kuraToolkit.videoSplitMerge.probe(input);
                    if (hasMediaStream(probe)) {
                        entries.push({ input, probe });
                    } else {
                        failed.push(fileName(input));
                    }
                } catch {
                    failed.push(fileName(input));
                }
            }
        } finally {
            setLoading(false);
        }
        if (entries.length > 0) useVideoSplitMergeStore.getState().addMergeItems(entries);
        if (failed.length > 0) {
            showNotice('warning', t('videoSplitMergePage.unreadableFiles', { names: failed.join(', ') }));
        }
    };

    return (
        <PageContainer>
            {screen === 'select' && <SourceSelect onSplit={loadSplit} onMerge={addMerge} />}
            {screen === 'split' && <SplitView jobs={jobs} onFile={loadSplit} />}
            {screen === 'merge' && <MergeView jobs={jobs} onAdd={addMerge} />}

            <ProgressDialog
                open={jobs.busy}
                title={t('videoSplitMergePage.running')}
                percent={jobs.job?.percent}
                current={jobs.job?.current}
                total={jobs.job?.total}
                remaining={jobs.remaining}
                // ファイルの解析中 (ジョブ未開始) はキャンセルできないためボタンを出さない
                onCancel={jobs.job ? jobs.cancel : undefined}
            />

            <AppDialog open={jobs.resultOutputs !== null} onClose={jobs.closeResult} maxWidth='sm' fullWidth>
                <DialogTitle>{t('common.done')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ mb: 0.5 }}>
                        {t('videoSplitMergePage.resultOutputs')}
                    </Typography>
                    {jobs.resultOutputs?.map(output => (
                        <Typography key={output} variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                            {output}
                        </Typography>
                    ))}
                    {/* 処理の詳細は普段は隠しておき、必要なときだけ開く */}
                    {jobs.logOpen && logs.length > 0 && <LogView lines={logs} sx={{ mt: 1.5, maxHeight: 240 }} />}
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between' }}>
                    <Button size='small' color='inherit' disabled={logs.length === 0} onClick={jobs.toggleLog}>
                        {jobs.logOpen ? t('videoSplitMergePage.hideLog') : t('videoSplitMergePage.showLog')}
                    </Button>
                    <Button onClick={jobs.closeResult}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>
        </PageContainer>
    );
}
