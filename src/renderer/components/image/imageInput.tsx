import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { FileFilter } from '@shared/types';
import { useFileDrop } from '../../hooks/useFileDrop';
import { showNotice } from '../../stores/noticeStore';
import PageContainer from '../common/PageContainer';

// 受け付ける画像の拡張子 (小文字、ドットなし)
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff'];

// 画像を選ぶダイアログの絞り込み
export function imageFilters(t: TFunction): FileFilter[] {
    return [
        { name: t('common.fileTypes.image'), extensions: IMAGE_EXTENSIONS },
        { name: t('common.fileTypes.all'), extensions: ['*'] },
    ];
}

// 画像 1 つのドロップと、画像を選ぶダイアログ (choose)。対象外の形式だけのときは知らせる
export function useImageInput(onImage: (imagePath: string) => void, disabled = false) {
    const { t } = useTranslation();
    const filters = imageFilters(t);
    const drop = useFileDrop({
        onFiles: paths => {
            if (paths[0]) onImage(paths[0]);
        },
        accept: IMAGE_EXTENSIONS,
        onRejected: () => showNotice('warning', t('svgPage.unsupportedImage')),
        disabled,
    });
    return {
        ...drop,
        filters,
        async choose() {
            drop.deliver(await window.kuraToolkit.dialog.openFiles({ filters }));
        },
    };
}

type DropPageProps = {
    input: ReturnType<typeof useImageInput>;
    children: React.ReactNode;
    sx?: SxProps<Theme>;
};

// 画面全体で画像のドロップを受け付けるページ枠 (ドラッグ中は画面の縁を強調する。クリックでは何もしない)
export function ImageDropPage({ input, children, sx }: DropPageProps) {
    return (
        <Box {...input.handlers} sx={{ position: 'relative', height: '100%' }}>
            <PageContainer sx={sx}>{children}</PageContainer>
            {input.dragOver && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 8,
                        border: 2,
                        borderStyle: 'dashed',
                        borderColor: 'primary.main',
                        borderRadius: 2,
                        bgcolor: 'action.hover',
                        pointerEvents: 'none',
                    }}
                />
            )}
        </Box>
    );
}
