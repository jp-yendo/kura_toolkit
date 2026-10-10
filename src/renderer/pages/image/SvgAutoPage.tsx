import React from 'react';
import { Box, Button, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import AppDialog from '../../components/common/AppDialog';
import { errorMessage } from '../../components/common/errorMessage';
import ProgressDialog from '../../components/common/ProgressDialog';
import SectionLabel from '../../components/common/SectionLabel';
import FileDropZone from '../../components/common/FileDropZone';
import PageContainer from '../../components/common/PageContainer';
import CompareViewer from '../../components/image/CompareViewer';
import { ImageDropPage, useImageInput } from '../../components/image/imageInput';
import ImageSourceBar from '../../components/image/ImageSourceBar';
import OutputFields from '../../components/image/OutputFields';
import PreprocessFields from '../../components/image/PreprocessFields';
import { SliderRow } from '../../components/image/SettingRows';
import SvgAutoVersionList, { versionMetrics, versionTitle } from '../../components/image/SvgAutoVersionList';
import { phaseRemaining } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useSvgAutoStore, type SvgAutoJob } from '../../stores/svgAutoStore';
import { DEFAULT_SVG_AUTO_TRIALS, SVG_AUTO_TRIALS_RANGE } from '@shared/svg-auto';

// 左の列の幅 (px)
const SIDE_WIDTH = 320;
// 再現度の表示の桁数
const FIDELITY_DIGITS = 3;

// 画像のファイル名から拡張子を除いた名前 (保存の既定の名前に使う)
function fileStem(filePath: string): string {
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? 'image';
    return fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
}

// 実行中は 1 秒ごとに今の時刻を返す (残り時間の表示を更新するため)
function useNow(active: boolean): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [active]);
    return Math.max(now, Date.now());
}

// 進捗ダイアログの状況の行 (手順と今の手順の残り時間) と、その下の行 (手順の中の回数とこれまでの最も高い再現度)
function progressLines(t: TFunction, job: SvgAutoJob, now: number): { status: string; message: string } {
    const phase = job.phase;
    // 手順の段階は「手順 n / 4: …」、手順の外の段階 (前の処理が終わるのを待つ) はその文言だけ
    const text = !phase
        ? t('jobPhases.svgAuto.preprocess')
        : phase.step !== undefined && phase.steps !== undefined
          ? t('jobPhaseStep', { step: phase.step, steps: phase.steps, text: t(`jobPhases.${phase.id}`) })
          : t(`jobPhases.${phase.id}`);
    const remaining = phase ? phaseRemaining(t, phase, now) : undefined;
    const stepId = phase?.id.replace(/^svgAuto\./, '') ?? 'preprocess';
    const counted =
        phase?.current !== undefined && phase.total !== undefined
            ? t(`svgAutoPage.stepCount.${stepId}`, { current: phase.current, total: phase.total })
            : undefined;
    const best =
        job.bestFidelity === null
            ? t('svgAutoPage.bestSoFarNone')
            : t('svgAutoPage.bestSoFar', { fidelity: job.bestFidelity.toFixed(FIDELITY_DIGITS) });
    return {
        status: remaining ? `${text}  ${remaining}` : text,
        message: counted ? `${counted}  ${best}` : best,
    };
}

// SVG 自動変換の画面。画像を選ぶまでは画面全体を画像の受け皿にする。選んだ後は、左の列を 設定 -> 生成中 -> 結果 の順に
// 切り替え (どれを出すかはストアの状態で決める。先頭に画像の名前と選び直すボタン)、右は元画像と SVG の上下の比較を置く。
// 画面のどこへドロップしても画像を切り替える (生成中は切り替えず、結果があるときは破棄してよいか確かめる)
export default function SvgAutoPage() {
    const { t } = useTranslation();
    const store = useSvgAutoStore();
    const [confirmDiscard, setConfirmDiscard] = React.useState(false);
    // 結果を破棄してよいか確かめている間の、切り替える先の画像
    const [pendingImage, setPendingImage] = React.useState<string | null>(null);
    const { job, result } = store;
    const selected = result?.versions.find(version => version.id === store.selectedId) ?? null;

    const loadImage = async (imagePath: string) => {
        try {
            const preview = await window.kuraToolkit.svgAuto.loadImage(imagePath);
            store.setImage(imagePath, preview.url);
        } catch (error) {
            showNotice('warning', errorMessage(t, error));
        }
    };
    const now = useNow(job !== null);
    const imageInput = useImageInput(imagePath => {
        if (useSvgAutoStore.getState().result) setPendingImage(imagePath);
        else void loadImage(imagePath);
    }, job !== null);

    // 自動変換を始め、終わったら結果を知らせる
    const start = async () => {
        const grayscale = store.preprocess.grayscale;
        try {
            const response = await store.start();
            if (response?.result?.incomplete) showNotice('warning', t('svgAutoPage.incomplete'), 10000);
            else if (response?.result) showNotice('success', t('svgAutoPage.done'));
        } catch (error) {
            const prefixes = grayscale
                ? ['svgAutoPage.grayscaleErrors', 'svgAutoPage.errors', 'svgPage.errors']
                : ['svgAutoPage.errors', 'svgPage.errors'];
            showNotice('warning', errorMessage(t, error, prefixes));
        }
    };

    const save = async () => {
        if (!selected || !store.imagePath) return;
        const target = await window.kuraToolkit.dialog.saveFile({
            defaultPath: `${fileStem(store.imagePath)}.svg`,
            filters: [
                { name: t('common.fileTypes.svg'), extensions: ['svg'] },
                { name: t('common.fileTypes.all'), extensions: ['*'] },
            ],
        });
        if (!target) return;
        try {
            await window.kuraToolkit.svgAuto.save(selected.id, target);
            showNotice('success', t('svgPage.saved', { path: target }));
        } catch (error) {
            showNotice('warning', errorMessage(t, error, ['svgAutoPage.errors']));
        }
    };

    // 画像を選ぶまでは画面全体を画像の受け皿にする (ドロップ・クリックで選ぶ)
    if (!store.imagePath || !store.imageUrl) {
        return (
            <PageContainer sx={{ height: '100%' }}>
                <FileDropZone
                    onFiles={imageInput.deliver}
                    filters={imageInput.filters}
                    hint={t('svgPage.dropHint')}
                    sx={{ flexGrow: 1, minHeight: 240 }}
                />
            </PageContainer>
        );
    }

    const showResult = !job && result !== null;

    return (
        <ImageDropPage input={imageInput} sx={{ flexDirection: 'row', height: '100%', minHeight: 0 }}>
            <Box sx={{ width: SIDE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ImageSourceBar
                    path={store.imagePath}
                    url={store.imageUrl}
                    onReselect={() => void imageInput.choose()}
                    disabled={job !== null}
                />
                {showResult && result ? (
                    <>
                        <SectionLabel>{t('svgAutoPage.versions')}</SectionLabel>
                        <Typography variant='body2' color='text.secondary' sx={{ mt: -1.5 }}>
                            {result.failures > 0
                                ? t('svgAutoPage.trialSummaryFailed', {
                                      trials: result.trials,
                                      failures: result.failures,
                                  })
                                : t('svgAutoPage.trialSummary', { trials: result.trials })}
                        </Typography>
                        <Box sx={{ overflowY: 'auto', flexGrow: 1, minHeight: 0 }}>
                            <SvgAutoVersionList
                                versions={result.versions}
                                selectedId={store.selectedId}
                                bestId={result.bestId}
                                onSelect={store.selectVersion}
                            />
                        </Box>
                        <Button variant='contained' onClick={save} disabled={!selected}>
                            {t('svgPage.saveSvg')}
                        </Button>
                        <Button color='inherit' onClick={() => setConfirmDiscard(true)}>
                            {t('svgAutoPage.backToSettings')}
                        </Button>
                    </>
                ) : (
                    <>
                        {/* 横は隠す (スライダーを最大にすると、つまみの見えない操作範囲が枠の外へはみ出して横スクロールが出るため) */}
                        <Box sx={{ overflowY: 'auto', overflowX: 'hidden', flexGrow: 1, pr: 1 }}>
                            <SectionLabel>{t('svgAutoPage.search')}</SectionLabel>
                            <Box sx={{ mb: 3 }}>
                                <SliderRow
                                    label={t('svgAutoPage.trials')}
                                    defaultValue={DEFAULT_SVG_AUTO_TRIALS}
                                    value={store.trials}
                                    min={SVG_AUTO_TRIALS_RANGE.min}
                                    max={SVG_AUTO_TRIALS_RANGE.max}
                                    onChange={store.setTrials}
                                />
                                <Typography variant='body2' color='text.secondary'>
                                    {t('svgAutoPage.trialsHint')}
                                </Typography>
                            </Box>
                            <SectionLabel>{t('svgPage.preprocess')}</SectionLabel>
                            <Box sx={{ mb: 3 }}>
                                <PreprocessFields value={store.preprocess} onChange={store.patchPreprocess} />
                            </Box>
                            <SectionLabel>{t('svgPage.output')}</SectionLabel>
                            <OutputFields value={store.output} onChange={store.patchOutput} />
                        </Box>
                        <Button variant='contained' onClick={start} disabled={!store.imagePath}>
                            {t('svgAutoPage.start')}
                        </Button>
                    </>
                )}
            </Box>
            <CompareViewer
                originalUrl={store.imageUrl}
                svgUrl={showResult ? (selected?.url ?? null) : null}
                svgLabel={showResult && selected ? versionTitle(t, selected) : undefined}
                svgInfo={showResult && selected ? versionMetrics(t, selected) : undefined}
                backdrop={store.backdrop}
                onBackdropChange={store.setBackdrop}
                sync={store.sync}
                onSyncChange={store.setSync}
                sx={{ flex: 1, minWidth: 0 }}
            />
            <AppDialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('svgAutoPage.backToSettings')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>{t('svgAutoPage.discardConfirm')}</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDiscard(false)}>{t('common.cancel')}</Button>
                    <Button
                        color='error'
                        onClick={() => {
                            setConfirmDiscard(false);
                            store.discardResult();
                        }}
                    >
                        {t('svgAutoPage.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>
            <AppDialog open={pendingImage !== null} onClose={() => setPendingImage(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('svgAutoPage.switchImage')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>{t('svgAutoPage.switchImageConfirm')}</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingImage(null)}>{t('common.cancel')}</Button>
                    <Button
                        color='error'
                        onClick={() => {
                            const imagePath = pendingImage;
                            setPendingImage(null);
                            store.discardResult();
                            if (imagePath) void loadImage(imagePath);
                        }}
                    >
                        {t('svgAutoPage.discardAndSwitch')}
                    </Button>
                </DialogActions>
            </AppDialog>
            <ProgressDialog
                open={job !== null}
                title={t('svgPage.converting')}
                percent={job?.percent}
                {...(job ? progressLines(t, job, now) : {})}
                onCancel={store.cancel}
            />
        </ImageDropPage>
    );
}
