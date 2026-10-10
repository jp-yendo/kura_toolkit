import React from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../components/common/errorMessage';
import PresetBar from '../../components/common/PresetBar';
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
import { formatBytes } from '../../components/voice/voiceFormat';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useVectorizerStore } from '../../stores/vectorizerStore';
import { DEFAULT_VECTORIZE_PARAMS, VECTORIZE_PARAM_RANGES } from '@shared/vectorizer';
import type {
    VectorizeParams,
    VectorizeRequest,
    VectorizerColorMode,
    VectorizerHierarchical,
    VectorizerPathMode,
} from '@shared/types';

// 画像を選ぶまでは画面全体を画像の受け皿にする。選んだ後は、左に設定 (先頭に画像の名前と選び直すボタン)、右に元画像と
// SVG の上下の比較を置き、画面のどこへドロップしても画像を切り替える
export default function SvgConverterPage() {
    const { t } = useTranslation();
    const store = useVectorizerStore();
    const { job, run, cancel } = useJobRunner();
    const busy = job !== null;
    // 変換パラメータ・前処理・出力は設定ファイルへ保存せず、起動のたびに既定値から始める
    const params = store.params;
    const preprocess = store.preprocess;
    const output = store.output;
    // グレースケールで変換するときは白黒で変換するため、カラー・階層・色精度・グラデーション幅は使わない
    const grayscale = preprocess.grayscale;
    // プリセットの API (一覧の読み直しは API が変わったときに行うため、同じものを使い続ける)
    const presetApi = React.useMemo(() => window.kuraToolkit.vectorizer.presets, []);
    // スライダーの戻すボタンの戻り先は、選択中のプリセットの値 (プリセットを選んでいないときは既定値)
    const resetBase = store.presetParams ?? DEFAULT_VECTORIZE_PARAMS;
    const resetTitle = store.presetParams ? t('svgPage.resetToPreset') : undefined;

    const svgUrl = store.svg?.url ?? null;

    const loadImage = async (imagePath: string) => {
        try {
            const preview = await window.kuraToolkit.vectorizer.loadImage(imagePath);
            store.setImage(imagePath, preview.url);
        } catch (error) {
            showNotice('warning', errorMessage(t, error));
        }
    };
    const imageInput = useImageInput(imagePath => void loadImage(imagePath), busy);

    const runVectorize = async () => {
        const imagePath = store.imagePath;
        if (!imagePath) return;
        const request: VectorizeRequest = { params, preprocess, output };
        try {
            const result = await run(t('svgPage.converting'), jobId =>
                window.kuraToolkit.vectorizer.convert(jobId, imagePath, request)
            );
            if (result.cancelled || !result.svg) return;
            store.setSvg(result.svg);
            showNotice('success', t('svgPage.converted'));
        } catch (error) {
            // グレースケールの変換の失敗は、グレースケールで使う設定を案内する
            const prefixes = request.preprocess.grayscale
                ? ['svgPage.grayscaleErrors', 'svgPage.errors']
                : ['svgPage.errors'];
            showNotice('warning', errorMessage(t, error, prefixes));
        }
    };

    const saveSvg = async () => {
        if (!store.svg || !store.imagePath) return;
        const fileName = store.imagePath.replace(/\\/g, '/').split('/').pop() ?? 'image';
        const stem = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
        const target = await window.kuraToolkit.dialog.saveFile({
            defaultPath: `${stem}.svg`,
            filters: [
                { name: t('common.fileTypes.svg'), extensions: ['svg'] },
                { name: t('common.fileTypes.all'), extensions: ['*'] },
            ],
        });
        if (!target) return;
        try {
            await window.kuraToolkit.vectorizer.saveSvg(store.svg.id, target);
            showNotice('success', t('svgPage.saved', { path: target }));
        } catch (error) {
            showNotice('warning', errorMessage(t, error));
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

    return (
        <ImageDropPage input={imageInput} sx={{ flexDirection: 'row', height: '100%', minHeight: 0 }}>
            {/* 左: 選んだ画像・前処理・パラメータ・出力と実行 */}
            <Box sx={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ImageSourceBar
                    path={store.imagePath}
                    url={store.imageUrl}
                    onReselect={() => void imageInput.choose()}
                    disabled={busy}
                />
                {/* 横は隠す (スライダーを最大にすると、つまみの見えない操作範囲が枠の外へはみ出して横スクロールが出るため) */}
                <Box sx={{ overflowY: 'auto', overflowX: 'hidden', flexGrow: 1, pr: 1 }}>
                    <Box sx={{ pt: 1, mb: 3 }}>
                        <PresetBar<VectorizeParams>
                            id='vectorizer'
                            api={presetApi}
                            current={() => store.params}
                            onApply={preset => store.patchParams(preset)}
                            disabled={busy}
                            selectedId={store.presetId}
                            onSelectedIdChange={store.setPresetId}
                            onSelectedPresetChange={preset => store.setPresetParams(preset?.params ?? null)}
                        />
                    </Box>
                    <SectionLabel>{t('svgPage.preprocess')}</SectionLabel>
                    <Box sx={{ mb: 3 }}>
                        <PreprocessFields value={preprocess} onChange={store.patchPreprocess} />
                    </Box>
                    <SectionLabel>{t('svgPage.clustering')}</SectionLabel>
                    <Stack spacing={2} sx={{ mb: 3 }}>
                        {!grayscale && (
                            <>
                                <FormControl size='small' fullWidth>
                                    <InputLabel id='color-mode-label'>{t('svgPage.colorMode')}</InputLabel>
                                    <Select
                                        labelId='color-mode-label'
                                        label={t('svgPage.colorMode')}
                                        value={params.colorMode}
                                        onChange={event =>
                                            store.patchParams({ colorMode: event.target.value as VectorizerColorMode })
                                        }
                                    >
                                        <MenuItem value='color'>{t('svgPage.colorModeColor')}</MenuItem>
                                        <MenuItem value='binary'>{t('svgPage.colorModeBinary')}</MenuItem>
                                    </Select>
                                </FormControl>
                                <FormControl size='small' fullWidth>
                                    <InputLabel id='hierarchical-label'>{t('svgPage.hierarchical')}</InputLabel>
                                    <Select
                                        labelId='hierarchical-label'
                                        label={t('svgPage.hierarchical')}
                                        value={params.hierarchical}
                                        onChange={event =>
                                            store.patchParams({
                                                hierarchical: event.target.value as VectorizerHierarchical,
                                            })
                                        }
                                    >
                                        <MenuItem value='stacked'>{t('svgPage.hierarchicalStacked')}</MenuItem>
                                        <MenuItem value='cutout'>{t('svgPage.hierarchicalCutout')}</MenuItem>
                                    </Select>
                                </FormControl>
                            </>
                        )}
                        <SliderRow
                            label={t('svgPage.filterSpeckle')}
                            defaultValue={resetBase.filterSpeckle}
                            resetTitle={resetTitle}
                            value={params.filterSpeckle}
                            min={VECTORIZE_PARAM_RANGES.filterSpeckle.min}
                            max={VECTORIZE_PARAM_RANGES.filterSpeckle.max}
                            step={VECTORIZE_PARAM_RANGES.filterSpeckle.step}
                            onChange={value => store.patchParams({ filterSpeckle: value })}
                        />
                        {!grayscale && (
                            <>
                                <SliderRow
                                    label={t('svgPage.colorPrecision')}
                                    defaultValue={resetBase.colorPrecision}
                                    resetTitle={resetTitle}
                                    value={params.colorPrecision}
                                    min={VECTORIZE_PARAM_RANGES.colorPrecision.min}
                                    max={VECTORIZE_PARAM_RANGES.colorPrecision.max}
                                    step={VECTORIZE_PARAM_RANGES.colorPrecision.step}
                                    onChange={value => store.patchParams({ colorPrecision: value })}
                                />
                                <SliderRow
                                    label={t('svgPage.gradientStep')}
                                    defaultValue={resetBase.layerDifference}
                                    resetTitle={resetTitle}
                                    value={params.layerDifference}
                                    min={VECTORIZE_PARAM_RANGES.layerDifference.min}
                                    max={VECTORIZE_PARAM_RANGES.layerDifference.max}
                                    step={VECTORIZE_PARAM_RANGES.layerDifference.step}
                                    onChange={value => store.patchParams({ layerDifference: value })}
                                />
                            </>
                        )}
                    </Stack>

                    <SectionLabel>{t('svgPage.curveFitting')}</SectionLabel>
                    <Stack spacing={2} sx={{ mb: 3 }}>
                        <FormControl size='small' fullWidth>
                            <InputLabel id='fit-mode-label'>{t('svgPage.mode')}</InputLabel>
                            <Select
                                labelId='fit-mode-label'
                                label={t('svgPage.mode')}
                                value={params.mode}
                                onChange={event =>
                                    store.patchParams({ mode: event.target.value as VectorizerPathMode })
                                }
                            >
                                <MenuItem value='spline'>{t('svgPage.modeSpline')}</MenuItem>
                                <MenuItem value='polygon'>{t('svgPage.modePolygon')}</MenuItem>
                                <MenuItem value='none'>{t('svgPage.modePixel')}</MenuItem>
                            </Select>
                        </FormControl>
                        <SliderRow
                            label={t('svgPage.cornerThreshold')}
                            defaultValue={resetBase.cornerThreshold}
                            resetTitle={resetTitle}
                            value={params.cornerThreshold}
                            min={VECTORIZE_PARAM_RANGES.cornerThreshold.min}
                            max={VECTORIZE_PARAM_RANGES.cornerThreshold.max}
                            step={VECTORIZE_PARAM_RANGES.cornerThreshold.step}
                            onChange={value => store.patchParams({ cornerThreshold: value })}
                        />
                        <SliderRow
                            label={t('svgPage.segmentLength')}
                            defaultValue={resetBase.lengthThreshold}
                            resetTitle={resetTitle}
                            value={params.lengthThreshold}
                            min={VECTORIZE_PARAM_RANGES.lengthThreshold.min}
                            max={VECTORIZE_PARAM_RANGES.lengthThreshold.max}
                            step={VECTORIZE_PARAM_RANGES.lengthThreshold.step}
                            decimals={1}
                            onChange={value => store.patchParams({ lengthThreshold: value })}
                        />
                        <SliderRow
                            label={t('svgPage.spliceThreshold')}
                            defaultValue={resetBase.spliceThreshold}
                            resetTitle={resetTitle}
                            value={params.spliceThreshold}
                            min={VECTORIZE_PARAM_RANGES.spliceThreshold.min}
                            max={VECTORIZE_PARAM_RANGES.spliceThreshold.max}
                            step={VECTORIZE_PARAM_RANGES.spliceThreshold.step}
                            onChange={value => store.patchParams({ spliceThreshold: value })}
                        />
                    </Stack>

                    <SectionLabel>{t('svgPage.output')}</SectionLabel>
                    <OutputFields value={output} onChange={store.patchOutput} />
                </Box>

                <Button variant='contained' onClick={runVectorize} disabled={!store.imagePath || busy}>
                    {t('svgPage.vectorize')}
                </Button>
                <Button variant='outlined' onClick={saveSvg} disabled={!store.svg || busy}>
                    {t('svgPage.saveSvg')}
                </Button>
            </Box>

            {/* 右: 元画像と SVG の上下の比較 */}
            <CompareViewer
                originalUrl={store.imageUrl}
                svgUrl={svgUrl}
                svgInfo={
                    store.svg
                        ? t('svgPage.svgStats', {
                              paths: store.svg.pathCount.toLocaleString(),
                              size: formatBytes(store.svg.bytes),
                          })
                        : undefined
                }
                backdrop={store.backdrop}
                onBackdropChange={store.setBackdrop}
                sync={store.sync}
                onSyncChange={store.setSync}
                sx={{ flexGrow: 1, minWidth: 0 }}
            />

            <ProgressDialog
                open={busy}
                title={job?.title ?? ''}
                percent={job?.percent}
                status={job?.status}
                onCancel={cancel}
            />
        </ImageDropPage>
    );
}
