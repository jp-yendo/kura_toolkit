import React from 'react';
import {
    Alert,
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { useSettingsStore } from '../../stores/settingsStore';
import { LANGUAGE_DEFINITIONS, type SymbolReading, type VoiceLanguage } from '@shared/voice/languages';

type Props = {
    open: boolean;
    language: VoiceLanguage;
    onClose(): void;
};

export function symbolReadingsFor(
    settings: ReturnType<typeof useSettingsStore.getState>['settings'],
    language: VoiceLanguage
): SymbolReading[] {
    return settings?.voice.symbolReadings[language] ?? LANGUAGE_DEFINITIONS[language].defaultSymbolReadings;
}

// 記号の読みの定義 (読み上げ機能の設定。言語ごとに保存する)。全角と半角は別の項目として扱う
export default function SymbolReadingsDialog({ open, language, onClose }: Props) {
    const { t } = useTranslation();
    const { settings, update } = useSettingsStore();
    const [rows, setRows] = React.useState<SymbolReading[]>([]);
    const [confirmReset, setConfirmReset] = React.useState(false);
    const punctuation = LANGUAGE_DEFINITIONS[language].punctuation;

    React.useEffect(() => {
        if (open) setRows(symbolReadingsFor(settings, language).map(row => ({ ...row })));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時点の設定で初期化する
    }, [open, language]);

    const problems = rows.map((row, index) => {
        if (!row.symbol) return 'empty';
        if (punctuation.includes(row.symbol)) return 'punctuation';
        if (rows.findIndex(other => other.symbol === row.symbol) !== index) return 'duplicate';
        if (!row.reading.trim()) return 'reading';
        return null;
    });
    const valid = problems.every(problem => problem === null);

    const patchRow = (index: number, patch: Partial<SymbolReading>) =>
        setRows(previous => previous.map((row, i) => (i === index ? { ...row, ...patch } : row)));

    return (
        <AppDialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
            <DialogTitle>{t('voice.symbols.title', { language: t(`voice.languages.${language}`) })}</DialogTitle>
            <DialogContent dividers>
                <Typography variant='body2' color='text.secondary' sx={{ mb: 1.5, lineHeight: 1.6 }}>
                    {t('voice.symbols.hint', { punctuation: punctuation.join(' ') })}
                </Typography>
                <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
                    <Table size='small' stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: 120 }}>{t('voice.symbols.symbol')}</TableCell>
                                <TableCell>{t('voice.symbols.reading')}</TableCell>
                                <TableCell padding='checkbox' />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row, index) => (
                                <TableRow key={index}>
                                    <TableCell>
                                        <TextField
                                            size='small'
                                            value={row.symbol}
                                            error={
                                                problems[index] === 'empty' ||
                                                problems[index] === 'punctuation' ||
                                                problems[index] === 'duplicate'
                                            }
                                            onChange={event => patchRow(index, { symbol: event.target.value })}
                                            slotProps={{
                                                htmlInput: { style: { fontFamily: 'Consolas, Menlo, monospace' } },
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TextField
                                            size='small'
                                            fullWidth
                                            value={row.reading}
                                            error={problems[index] === 'reading'}
                                            onChange={event => patchRow(index, { reading: event.target.value })}
                                        />
                                    </TableCell>
                                    <TableCell padding='checkbox'>
                                        <Tooltip title={t('voice.symbols.delete')}>
                                            <IconButton
                                                size='small'
                                                aria-label={t('voice.symbols.delete')}
                                                onClick={() =>
                                                    setRows(previous => previous.filter((_row, i) => i !== index))
                                                }
                                            >
                                                <DeleteOutlineIcon fontSize='small' />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>
                <Button
                    size='small'
                    startIcon={<AddIcon />}
                    onClick={() => setRows(previous => [...previous, { symbol: '', reading: '' }])}
                    sx={{ mt: 1 }}
                >
                    {t('voice.symbols.add')}
                </Button>
                {!valid && (
                    <Alert severity='warning' sx={{ mt: 1.5 }}>
                        {t('voice.symbols.invalid')}
                    </Alert>
                )}
            </DialogContent>
            {/* 初期値に戻す操作は、保存の操作から離して左端に置く */}
            <DialogActions sx={{ justifyContent: 'space-between' }}>
                <Button color='inherit' onClick={() => setConfirmReset(true)}>
                    {t('voice.symbols.resetDefaults')}
                </Button>
                <Stack direction='row' spacing={1}>
                    <Button onClick={onClose}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        disabled={!valid}
                        onClick={async () => {
                            await update({
                                voice: {
                                    symbolReadings: { [language]: rows } as Record<VoiceLanguage, SymbolReading[]>,
                                },
                            });
                            onClose();
                        }}
                    >
                        {t('voice.common.save')}
                    </Button>
                </Stack>
            </DialogActions>

            <AppDialog open={confirmReset} onClose={() => setConfirmReset(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.symbols.resetDefaults')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.symbols.resetConfirm')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmReset(false)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            setRows(LANGUAGE_DEFINITIONS[language].defaultSymbolReadings.map(row => ({ ...row })));
                            setConfirmReset(false);
                        }}
                    >
                        {t('voice.symbols.resetDefaults')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </AppDialog>
    );
}
