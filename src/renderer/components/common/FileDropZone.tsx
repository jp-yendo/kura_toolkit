import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { FileFilter } from '@shared/types';
import type { SxProps, Theme } from '@mui/material/styles';

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
    const [dragOver, setDragOver] = React.useState(false);

    const acceptPath = React.useCallback(
        (filePath: string) => {
            if (allowDirectories) return true;
            if (!accept || accept.length === 0) return true;
            const dot = filePath.lastIndexOf('.');
            if (dot < 0) return false;
            return accept.includes(filePath.slice(dot + 1).toLowerCase());
        },
        [accept, allowDirectories]
    );

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragOver(false);
        const files = Array.from(event.dataTransfer.files);
        const paths = files
            .map(file => window.kuraToolkit.getPathForFile(file))
            .filter(filePath => filePath && acceptPath(filePath));
        if (paths.length === 0) {
            // 何も受け付けられなかったことを伝える (無反応にしない)
            if (files.length > 0) onRejected?.();
            return;
        }
        onFiles(multiple ? paths : paths.slice(0, 1));
    };

    const handleClick = async () => {
        const paths = await window.kuraToolkit.dialog.openFiles({ filters, multi: multiple });
        // ダイアログで「すべてのファイル」を選ぶと対象外の形式も選べるため、ここでも絞り込む
        const accepted = paths.filter(filePath => acceptPath(filePath));
        if (accepted.length === 0) {
            if (paths.length > 0) onRejected?.();
            return;
        }
        onFiles(accepted);
    };

    return (
        <Box
            onClick={handleClick}
            onDragOver={event => {
                event.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
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
