import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { FileFilter } from '@shared/types';
import type { SxProps, Theme } from '@mui/material/styles';
import { useFileDrop } from '../../hooks/useFileDrop';

type Props = {
    // 選択/ドロップされた絶対パスを通知する
    onFiles(paths: string[]): void;
    // ダイアログ用フィルタ
    filters: FileFilter[];
    // 受け付ける拡張子 (小文字、ドットなし)。省略時は無制限
    accept?: string[];
    // ディレクトリのドロップを許可する。renderer からはファイルかディレクトリか判別できないため、
    // 拡張子で絞り込まずにそのまま渡し、展開と絞り込みは呼び出し側 (main) に任せる
    allowDirectories?: boolean;
    multiple?: boolean;
    // 対象外の形式だけが選択/ドロップされたときの通知
    onRejected?(): void;
    // 表示文言 (省略時は共通のドロップヒント)
    hint?: string;
    sx?: SxProps<Theme>;
    children?: React.ReactNode;
};

// ドラッグ&ドロップ + クリック選択のファイル入力ゾーン
export default function FileDropZone({
    onFiles,
    filters,
    accept,
    allowDirectories,
    multiple,
    onRejected,
    hint,
    sx,
    children,
}: Props) {
    const { t } = useTranslation();
    const { dragOver, handlers, deliver } = useFileDrop({ onFiles, accept, allowDirectories, multiple, onRejected });

    const handleClick = async () => {
        // ダイアログで「すべてのファイル」を選ぶと対象外の形式も選べるため、ここでも絞り込む
        deliver(await window.kuraToolkit.dialog.openFiles({ filters, multi: multiple }));
    };

    return (
        <Box
            onClick={handleClick}
            {...handlers}
            sx={{
                border: 2,
                borderStyle: 'dashed',
                borderColor: dragOver ? 'primary.main' : 'divider',
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                bgcolor: dragOver ? 'action.hover' : 'transparent',
                transition: 'border-color 0.15s, background-color 0.15s',
                minHeight: 120,
                p: 2,
                ...sx,
            }}
        >
            {children ?? (
                <Typography color='text.secondary' align='center' sx={{ whiteSpace: 'pre-line' }}>
                    {hint ?? t('common.dropHint')}
                </Typography>
            )}
        </Box>
    );
}
