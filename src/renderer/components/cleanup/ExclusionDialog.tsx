import React from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';

type Props = {
    open: boolean;
    // 保存済みの対象外のパターン
    excludedDirs: readonly string[];
    excludedFiles: readonly string[];
    onClose(): void;
    // 確定: 1 行 1 個に整えたパターンを渡す
    onSave(excludedDirs: string[], excludedFiles: string[]): void;
};

// パターンの入力欄の行数 (最小と、これを超えると欄の中でスクロールする行数)
const MIN_ROWS = 6;
const MAX_ROWS = 12;

const PATTERN_FIELD_SX = {
    '& textarea': { fontFamily: 'Consolas, Menlo, monospace', fontSize: '0.875rem' },
};

// 入力欄の文字列を 1 行 1 個のパターンに整える (前後の空白を除き、空行と重複を除く)
function parsePatterns(text: string): string[] {
    const patterns = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    return [...new Set(patterns)];
}

// クリーンアップの対象外 (ディレクトリ・ファイル) を指定する。開くたびに保存済みの内容から始め、
// 確定で整えたパターンを渡す。キャンセルでは何もしない
export default function ExclusionDialog({ open, excludedDirs, excludedFiles, onClose, onSave }: Props) {
    const { t } = useTranslation();
    const [dirsText, setDirsText] = React.useState('');
    const [filesText, setFilesText] = React.useState('');
    React.useEffect(() => {
        if (!open) return;
        setDirsText(excludedDirs.join('\n'));
        setFilesText(excludedFiles.join('\n'));
    }, [open, excludedDirs, excludedFiles]);

    return (
        <AppDialog open={open} onClose={onClose} maxWidth='md' fullWidth>
            <DialogTitle>{t('cleanupPage.exclusions')}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <Typography variant='body2' color='text.secondary'>
                        {t('cleanupPage.exclusionDescription')}
                    </Typography>
                    <TextField
                        autoFocus
                        multiline
                        fullWidth
                        minRows={MIN_ROWS}
                        maxRows={MAX_ROWS}
                        label={t('cleanupPage.excludedDirs')}
                        placeholder={t('cleanupPage.excludedDirsPlaceholder')}
                        value={dirsText}
                        onChange={event => setDirsText(event.target.value)}
                        sx={PATTERN_FIELD_SX}
                        slotProps={{ htmlInput: { spellCheck: false } }}
                    />
                    <TextField
                        multiline
                        fullWidth
                        minRows={MIN_ROWS}
                        maxRows={MAX_ROWS}
                        label={t('cleanupPage.excludedFiles')}
                        placeholder={t('cleanupPage.excludedFilesPlaceholder')}
                        value={filesText}
                        onChange={event => setFilesText(event.target.value)}
                        sx={PATTERN_FIELD_SX}
                        slotProps={{ htmlInput: { spellCheck: false } }}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant='contained' onClick={() => onSave(parsePatterns(dirsText), parsePatterns(filesText))}>
                    {t('common.ok')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
