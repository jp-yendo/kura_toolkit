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
import FileDropZone from '../../components/common/FileDropZone';
import ProgressDialog from '../../components/common/ProgressDialog';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import SplitPane from '../../components/common/SplitPane';
import ZoomableImage, { clampScale } from '../../components/common/ZoomableImage';
import { showNotice } from '../../stores/noticeStore';
import { useVectorizerStore } from '../../stores/vectorizerStore';
import type { VectorizerColorMode, VectorizerHierarchical, VectorizerPathMode } from '@shared/types';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff'];
const IMAGE_FILTERS = [
    { name: 'Image Files', extensions: IMAGE_EXTENSIONS },
    { name: 'All Files', extensions: ['*'] },
];

type SliderRowProps = {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    // 値の表示に用いる小数桁数 (省略時は整数表示)
    decimals?: number;
    onChange(value: number): void;
};

function SliderRow({ label, value, min, max, step, decimals, onChange }: SliderRowProps) {
    return (
        <Box>
            <Typography variant='body2' color='text.secondary' sx={{ mb: 0.5 }}>
                {label}:{' '}
                <Box component='span' sx={{ color: 'text.primary', fontWeight: 600 }}>
                    {decimals !== undefined ? value.toFixed(decimals) : value}
                </Box>
            </Typography>
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
    const store = useVectorizerStore();
    const [busy, setBusy] = React.useState(false);
    // 変換パラメータは設定ファイルへ保存せず、起動のたびに既定値から始める
    const params = store.params;
    // SVG プレビューの表示倍率 (null = 全体表示) と、実際に表示している倍率
    const [previewScale, setPreviewScale] = React.useState<number | null>(null);
    const [previewEffectiveScale, setPreviewEffectiveScale] = React.useState(1);

    // SVG は数 MB になり得るため、変換結果が変わったときだけ URL を作り直す
    const svgUrl = React.useMemo(
        () => (store.svg ? URL.createObjectURL(new Blob([store.svg], { type: 'image/svg+xml' })) : null),
        [store.svg]
    );
    React.useEffect(() => {
        return () => {
            if (svgUrl) URL.revokeObjectURL(svgUrl);
        };
    }, [svgUrl]);

    // 変換し直したら全体表示へ戻す
    React.useEffect(() => {
        setPreviewScale(null);
    }, [svgUrl]);

    const loadImage = async (paths: string[]) => {
        const imagePath = paths[0];
        if (!imagePath) return;
        try {
            const preview = await window.kuraToolkit.vectorizer.loadImage(imagePath);
            store.setImage(imagePath, preview.dataUrl);
        } catch (error) {
            showNotice('warning', error instanceof Error ? error.message : String(error));
        }
    };

    const runVectorize = async () => {
        if (!store.imagePath) return;
        setBusy(true);
        try {
            const result = await window.kuraToolkit.vectorizer.convert(store.imagePath, params);
            store.setSvg(result.svg);
            showNotice('success', t('svgPage.converted'));
        } catch (error) {
            showNotice('warning', error instanceof Error ? error.message : String(error));
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
                { name: 'SVG Files', extensions: ['svg'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });
        if (!target) return;
        try {
            await window.kuraToolkit.vectorizer.saveSvg(target, store.svg);
            showNotice('success', t('svgPage.saved', { path: target }));
        } catch (error) {
            showNotice('warning', error instanceof Error ? error.message : String(error));
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
                            filters={IMAGE_FILTERS}
                            accept={IMAGE_EXTENSIONS}
                            onRejected={() => showNotice('warning', t('svgPage.unsupportedImage'))}
                            hint={t('svgPage.dropHint')}
                            sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
                        >
                            {store.imageDataUrl ? (
                                <Box
                                    component='img'
                                    src={store.imageDataUrl}
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
                <Box sx={{ overflow: 'auto', flexGrow: 1, pr: 1 }}>
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
                            value={params.filterSpeckle}
                            min={0}
                            max={128}
                            onChange={value => store.patchParams({ filterSpeckle: value })}
                        />
                        <SliderRow
                            label={t('svgPage.colorPrecision')}
                            value={params.colorPrecision}
                            min={1}
                            max={8}
                            onChange={value => store.patchParams({ colorPrecision: value })}
                        />
                        <SliderRow
                            label={t('svgPage.gradientStep')}
                            value={params.layerDifference}
                            min={0}
                            max={128}
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
                            value={params.cornerThreshold}
                            min={0}
                            max={180}
                            onChange={value => store.patchParams({ cornerThreshold: value })}
                        />
                        <SliderRow
                            label={t('svgPage.segmentLength')}
                            value={params.lengthThreshold}
                            min={3.5}
                            max={10}
                            step={0.1}
                            decimals={1}
                            onChange={value => store.patchParams({ lengthThreshold: value })}
                        />
                        <SliderRow
                            label={t('svgPage.spliceThreshold')}
                            value={params.spliceThreshold}
                            min={0}
                            max={180}
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
