import React from 'react';
import { Box, FormControlLabel, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import SectionLabel from '../common/SectionLabel';
import SplitPane, { SPLIT_BAR_MARGIN_PX } from '../common/SplitPane';
import ZoomableImage, { type ImageSize, type ViewCenter } from '../common/ZoomableImage';
import { backdropSx, type ImageBackdrop } from './backdrop';
import ZoomControls from './ZoomControls';

// 元画像と SVG を上下に並べて比べる表示

// 元画像を画素がぼけないように描き始める倍率
const PIXELATED_SCALE = 2;

// 表示の倍率 (元画像の実寸に対する比。null = 全体表示) と中心
type View = { scale: number | null; center: ViewCenter };

const INITIAL_VIEW: View = { scale: null, center: { x: 0.5, y: 0.5 } };

type Props = {
    originalUrl: string;
    // 表示する SVG (無いときは下の枠に見出しの文言だけを示す)
    svgUrl: string | null;
    // 下の見出しに添える、表示している SVG の名前
    svgLabel?: string;
    // 下の見出しの右に示す、表示している SVG の情報 (パス数など)
    svgInfo?: string;
    backdrop: ImageBackdrop;
    onBackdropChange(backdrop: ImageBackdrop): void;
    // 上下の拡大縮小・表示位置を同期するか
    sync: boolean;
    onSyncChange(sync: boolean): void;
    sx?: SxProps<Theme>;
};

// 上に元画像、下に SVG を並べる (間の仕切りをドラッグして高さを配分できる)。同期するときは、拡大縮小・スクロール・
// ドラッグをどちらで行っても両方に反映する。同期するのは表示の中心 (画像の幅・高さに対する 0-1 の位置) と、
// 元画像の実寸に対する倍率 (上下で実寸が違っても同じ位置・同じ大きさで見える)。SVG を切り替えても表示の位置は保ち、
// 元画像が変わったときは全体表示に戻す。元画像は、倍率が 200% 以上のときは画素がぼけないように描く
export default function CompareViewer({
    originalUrl,
    svgUrl,
    svgLabel,
    svgInfo,
    backdrop,
    onBackdropChange,
    sync,
    onSyncChange,
    sx,
}: Props) {
    const { t } = useTranslation();
    const [top, setTop] = React.useState<View>(INITIAL_VIEW);
    const [bottom, setBottom] = React.useState<View>(INITIAL_VIEW);
    const [originalSize, setOriginalSize] = React.useState<ImageSize | null>(null);
    const [svgSize, setSvgSize] = React.useState<ImageSize | null>(null);
    const [topScale, setTopScale] = React.useState(1);

    React.useEffect(() => {
        setTop(INITIAL_VIEW);
        setBottom(INITIAL_VIEW);
    }, [originalUrl]);

    // 下の倍率 (SVG の実寸に対する比) = 元画像の実寸に対する倍率 x 実寸の比
    const ratio = originalSize && svgSize && svgSize.width > 0 ? originalSize.width / svgSize.width : 1;

    const changeTop = (view: View) => {
        setTop(view);
        if (sync) setBottom(view);
    };
    const changeBottom = (view: View) => {
        const converted = { ...view, scale: view.scale === null ? null : view.scale / ratio };
        setBottom(converted);
        if (sync) setTop(converted);
    };
    // ズームのボタンは上下の両方に効かせる (表示の中心はそれぞれのまま)
    const zoomBoth = (scale: number | null) => {
        setTop(previous => ({ ...previous, scale }));
        setBottom(previous => ({ ...previous, scale }));
    };
    const toggleSync = (value: boolean) => {
        if (value) setBottom(top);
        onSyncChange(value);
    };

    const backdropStyle = backdropSx(backdrop);
    const paneSx: SxProps<Theme> = { flex: 1, minHeight: 0 };
    const svgTitle = svgLabel ? `${t('svgPage.preview')}: ${svgLabel}` : t('svgPage.preview');

    // 表示の操作は、縦の場所を取らないよう元画像の見出しの行に置く (見出しの高さに収まる大きさにする)
    const controls = (
        <Stack direction='row' spacing={2} sx={{ alignItems: 'center', ml: 2 }}>
            <ZoomControls scale={topScale} onChange={zoomBoth} />
            <FormControlLabel
                sx={{ mr: 0 }}
                control={<Switch size='small' checked={sync} onChange={(_event, value) => toggleSync(value)} />}
                label={t('svgPage.sync')}
                slotProps={{ typography: { variant: 'body2', noWrap: true } }}
            />
            <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant='body2' color='text.secondary' noWrap>
                    {t('svgPage.backdrop')}
                </Typography>
                <ToggleButtonGroup
                    size='small'
                    exclusive
                    value={backdrop}
                    onChange={(_event, value: ImageBackdrop | null) => value && onBackdropChange(value)}
                    sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, lineHeight: 1.5 } }}
                >
                    <ToggleButton value='checker'>{t('svgPage.backdrops.checker')}</ToggleButton>
                    <ToggleButton value='white'>{t('svgPage.backdrops.white')}</ToggleButton>
                    <ToggleButton value='black'>{t('svgPage.backdrops.black')}</ToggleButton>
                </ToggleButtonGroup>
            </Stack>
        </Stack>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...sx }}>
            {/* 見出しと画像の間を、仕切りの線と見出しの間と同じにする (下の見出しの行が、仕切りと画像の上下の中央に来る) */}
            <SplitPane
                gap={`${SPLIT_BAR_MARGIN_PX}px`}
                sx={{ flex: 1, minHeight: 0 }}
                top={
                    <>
                        <SectionLabel action={controls}>{t('svgPage.original')}</SectionLabel>
                        <ZoomableImage
                            src={originalUrl}
                            alt={t('svgPage.original')}
                            scale={top.scale}
                            center={top.center}
                            onScaleChange={scale => changeTop({ ...top, scale })}
                            onViewChange={changeTop}
                            onEffectiveScaleChange={setTopScale}
                            onNaturalSizeChange={setOriginalSize}
                            imageSx={{
                                ...backdropStyle,
                                imageRendering: topScale >= PIXELATED_SCALE ? 'pixelated' : 'auto',
                            }}
                            sx={paneSx}
                        />
                    </>
                }
                bottom={
                    <>
                        <SectionLabel
                            action={
                                svgInfo && (
                                    <Typography variant='body2' color='text.secondary' noWrap sx={{ ml: 2 }}>
                                        {svgInfo}
                                    </Typography>
                                )
                            }
                        >
                            {svgTitle}
                        </SectionLabel>
                        <ZoomableImage
                            src={svgUrl}
                            alt={t('svgPage.preview')}
                            scale={bottom.scale === null ? null : bottom.scale * ratio}
                            center={bottom.center}
                            onScaleChange={scale => changeBottom({ ...bottom, scale })}
                            onViewChange={changeBottom}
                            onNaturalSizeChange={setSvgSize}
                            imageSx={backdropStyle}
                            placeholder={
                                <Typography variant='body2' color='text.secondary'>
                                    {t('svgPage.preview')}
                                </Typography>
                            }
                            sx={paneSx}
                        />
                    </>
                }
            />
        </Box>
    );
}
