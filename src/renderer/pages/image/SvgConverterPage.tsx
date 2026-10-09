import React from 'react';
import {
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Slider,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../components/common/errorMessage';
import FileDropZone from '../../components/common/FileDropZone';
import PresetBar from '../../components/common/PresetBar';
import ProgressDialog from '../../components/common/ProgressDialog';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import SplitPane from '../../components/common/SplitPane';
import ZoomableImage, { clampScale } from '../../components/common/ZoomableImage';
import { showNotice } from '../../stores/noticeStore';
import ResetButton from '../../components/common/ResetButton';
import { useVectorizerStore } from '../../stores/vectorizerStore';
import { DEFAULT_VECTORIZE_PARAMS, VECTORIZE_PARAM_RANGES } from '@shared/vectorizer';
import type { VectorizeParams, VectorizerColorMode, VectorizerHierarchical, VectorizerPathMode } from '@shared/types';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff'];

type SliderRowProps = {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    // 値の表示に用いる小数桁数 (省略時は整数表示)
    decimals?: number;
    // 戻す先の値 (値の右に、この値に戻すボタンを置く)
    defaultValue: number;
    // 戻すボタンのツールチップ (省略時は「初期値に戻す」)
    resetTitle?: string;
    onChange(value: number): void;
};

function SliderRow({ label, value, min, max, step, decimals, defaultValue, resetTitle, onChange }: SliderRowProps) {
    return (
        <Box>
            <Stack direction='row' sx={{ alignItems: 'center', mb: 0.5 }}>
                <Typography variant='body2' color='text.secondary' sx={{ flexGrow: 1 }}>
                    {label}:{' '}
                    <Box component='span' sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {decimals !== undefined ? value.toFixed(decimals) : value}
                    </Box>
                </Typography>
                <ResetButton
                    onClick={() => onChange(defaultValue)}
                    disabled={value === defaultValue}
                    title={resetTitle}
                />
            </Stack>
            <Slider
                size='small'
                value={value}
                min={min}
                max={max}
                step={step ?? 1}
                onChange={(_event, newValue) => onChange(newValue as number)}
            />
        </Box>
    );
}

export default function SvgConverterPage() {
    const { t } = useTranslation();
    const imageFilters = [
        { name: t('common.fileTypes.image'), extensions: IMAGE_EXTENSIONS },
        { name: t('common.fileTypes.all'), extensions: ['*'] },
    ];
    const store = useVectorizerStore();
    const [busy, setBusy] = React.useState(false);
    // 変換パラメータは設定ファイルへ保存せず、起動のたびに既定値から始める
    const params = store.params;
    // プリセットの API (一覧の読み直しは API が変わったときに行うため、同じものを使い続ける)
    const presetApi = React.useMemo(() => window.kuraToolkit.vectorizer.presets, []);
    // スライダーの戻すボタンの戻り先は、選択中のプリセットの値 (プリセットを選んでいないときは既定値)
    const resetBase = store.presetParams ?? DEFAULT_VECTORIZE_PARAMS;
    const resetTitle = store.presetParams ? t('svgPage.resetToPreset') : undefined;
    // SVG プレビューの表示倍率 (null = 全体表示) と、実際に表示している倍率
    const [previewScale, setPreviewScale] = React.useState<number | null>(null);
    const [previewEffectiveScale, setPreviewEffectiveScale] = React.useState(1);

    const svgUrl = store.svg?.url ?? null;

    // 変換し直したら全体表示へ戻す
    React.useEffect(() => {
        setPreviewScale(null);
    }, [svgUrl]);

    const loadImage = async (paths: string[]) => {
        const imagePath = paths[0];
        if (!imagePath) return;
        try {
            const preview = await window.kuraToolkit.vectorizer.loadImage(imagePath);
            store.setImage(imagePath, preview.url);
        } catch (error) {
            showNotice('warning', errorMessage(t, error));
        }
    };

    const runVectorize = async () => {
        if (!store.imagePath) return;
        setBusy(true);
        try {
            const result = await window.kuraToolkit.vectorizer.convert(store.imagePath, params);
            store.setSvg(result);
            showNotice('success', t('svgPage.converted'));
        } catch (error) {
            showNotice('warning', errorMessage(t, error, ['svgPage.errors']));
        } finally {
            setBusy(false);
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

    // SVG プレビューの見出しに置くズーム操作。Tooltip は無効時も出すため span で包む
    const zoomControls = (
        <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
            <Tooltip title={t('svgPage.zoomOut')}>
                <span>
                    <IconButton
                        size='small'
                        disabled={!svgUrl}
                        onClick={() => setPreviewScale(clampScale(previewEffectiveScale / 1.25))}
                    >
                        <ZoomOutIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('svgPage.actualSize')}>
                <span>
                    <Button
                        size='small'
                        color='inherit'
                        disabled={!svgUrl}
                        onClick={() => setPreviewScale(1)}
                        sx={{ minWidth: 60 }}
                    >
                        {Math.round(previewEffectiveScale * 100)}%
                    </Button>
                </span>
            </Tooltip>
            <Tooltip title={t('svgPage.zoomIn')}>
                <span>
                    <IconButton
                        size='small'
                        disabled={!svgUrl}
                        onClick={() => setPreviewScale(clampScale(previewEffectiveScale * 1.25))}
                    >
                        <ZoomInIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('svgPage.fitToWindow')}>
                <span>
                    <IconButton size='small' disabled={!svgUrl} onClick={() => setPreviewScale(null)}>
                        <FitScreenIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
        </Stack>
    );

    return (
        <PageContainer sx={{ flexDirection: 'row', height: '100%', minHeight: 0 }}>
            {/* 左: 画像入力とプレビュー (間の仕切りをドラッグして高さを配分できる) */}
            <SplitPane
                sx={{ flexGrow: 1, minWidth: 0 }}
                top={
                    <>
                        <SectionLabel>
                            {store.imagePath ? (
                                <Box
                                    component='span'
                                    sx={{
                                        display: 'block',
                                        maxWidth: 640,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {store.imagePath}
                                </Box>
                            ) : (
                                t('svgPage.original')
                            )}
                        </SectionLabel>
                        <FileDropZone
                            onFiles={loadImage}
                            filters={imageFilters}
                            accept={IMAGE_EXTENSIONS}
                            onRejected={() => showNotice('warning', t('svgPage.unsupportedImage'))}
                            hint={t('svgPage.dropHint')}
                            sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
                        >
                            {store.imageUrl ? (
                                <Box
                                    component='img'
                                    src={store.imageUrl}
                                    alt={t('svgPage.original')}
                                    sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            ) : undefined}
                        </FileDropZone>
                    </>
                }
                bottom={
                    <>
                        <SectionLabel action={zoomControls}>{t('svgPage.preview')}</SectionLabel>
                        <ZoomableImage
                            src={svgUrl}
                            alt={t('svgPage.preview')}
                            scale={previewScale}
                            onScaleChange={setPreviewScale}
                            onEffectiveScaleChange={setPreviewEffectiveScale}
                            placeholder={
                                <Typography variant='body2' color='text.secondary'>
                                    {t('svgPage.preview')}
                                </Typography>
                            }
                            sx={{ flex: 1, minHeight: 0 }}
                        />
                    </>
                }
            />

            {/* 右: パラメータと実行 */}
            <Box sx={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                    <SectionLabel>{t('svgPage.clustering')}</SectionLabel>
                    <Stack spacing={2} sx={{ mb: 3 }}>
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
                                    store.patchParams({ hierarchical: event.target.value as VectorizerHierarchical })
                                }
                            >
                                <MenuItem value='stacked'>{t('svgPage.hierarchicalStacked')}</MenuItem>
                                <MenuItem value='cutout'>{t('svgPage.hierarchicalCutout')}</MenuItem>
                            </Select>
                        </FormControl>
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
                    </Stack>

                    <SectionLabel>{t('svgPage.curveFitting')}</SectionLabel>
                    <Stack spacing={2}>
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
                </Box>

                <Button variant='contained' onClick={runVectorize} disabled={!store.imagePath || busy}>
                    {t('svgPage.vectorize')}
                </Button>
                <Button variant='outlined' onClick={saveSvg} disabled={!store.svg || busy}>
                    {t('svgPage.saveSvg')}
                </Button>
            </Box>

            <ProgressDialog open={busy} title={t('svgPage.converting')} />
        </PageContainer>
    );
}
