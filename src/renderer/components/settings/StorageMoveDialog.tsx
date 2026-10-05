import React from 'react';
import {
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Radio,
    RadioGroup,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { itemLabel } from '../voice/libraryItems';
import { formatBytes } from '../voice/voiceFormat';
import type { StorageMoveDecisions, StorageMovePlan, StorageUnitConflict, StorageUnitStats } from '@shared/types';
import type { LibraryItem } from '@shared/voice/types';

type Props = {
    open: boolean;
    // 移す保存場所の名前と、移動元・移動先
    name: string;
    from: string;
    to: string;
    plan: StorageMovePlan | null;
    // まとまりの表示名に使うダウンロード項目
    items: LibraryItem[];
    onClose(): void;
    onRun(decisions: StorageMoveDecisions): void;
};

const numberCellSx = { whiteSpace: 'nowrap' } as const;

// まとまりの種類
function kindLabel(t: TFunction, conflict: StorageUnitConflict): string {
    const feature = conflict.feature ? t(`settingsPage.storage.merge.features.${conflict.feature}`) : '';
    return t(`settingsPage.storage.merge.kinds.${conflict.kind}`, { feature });
}

// まとまりの名前 (ダウンロード項目は項目の名前、利用者のデータは付けた名前)
function unitName(t: TFunction, conflict: StorageUnitConflict, items: LibraryItem[]): string {
    if (conflict.name) return conflict.name;
    const names = (conflict.itemIds ?? []).map(id => {
        const item = items.find(entry => entry.id === id);
        return item ? itemLabel(t, item) : id;
    });
    return names.join(t('voice.common.listSeparator')) || conflict.key;
}

function StatsCells({ stats, newer }: { stats: StorageUnitStats; newer: boolean }) {
    const { t } = useTranslation();
    return (
        <>
            <TableCell sx={{ ...numberCellSx, fontWeight: newer ? 600 : undefined }}>
                {stats.modifiedAt === null ? '-' : new Date(stats.modifiedAt).toLocaleString()}
            </TableCell>
            <TableCell align='right' sx={numberCellSx}>
                {t('settingsPage.storage.merge.contents', {
                    count: stats.fileCount,
                    size: formatBytes(stats.sizeBytes),
                })}
            </TableCell>
        </>
    );
}

// 保存場所の移動の確認。移動先にも同じまとまりがある場合は、まとまりごとに移動元と移動先の
// 最終更新日時・ファイル数・合計サイズを並べ、上書きするかを選んでもらう
export default function StorageMoveDialog({ open, name, from, to, plan, items, onClose, onRun }: Props) {
    const { t } = useTranslation();
    const [decisions, setDecisions] = React.useState<StorageMoveDecisions>({});
    // 開き直すたびに選択を空にする (前の移動の選択を持ち越さないため)
    React.useEffect(() => {
        if (open) setDecisions({});
    }, [open, plan]);

    const conflicts = plan?.conflicts ?? [];
    const decided = conflicts.every(conflict => decisions[conflict.key]);
    const setAll = (value: 'overwrite' | 'keep') =>
        setDecisions(Object.fromEntries(conflicts.map(conflict => [conflict.key, value])));

    return (
        <AppDialog open={open} onClose={onClose} maxWidth={conflicts.length > 0 ? 'lg' : 'sm'} fullWidth>
            <DialogTitle>{t('settingsPage.storage.moveTitle', { name })}</DialogTitle>
            <DialogContent>
                <Stack spacing={1.5}>
                    <Typography variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                        {from} → {to}
                    </Typography>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('settingsPage.storage.moveMessage')}
                    </Typography>
                    {plan && (
                        <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                            {t('settingsPage.storage.merge.transfer', {
                                count: plan.transferCount,
                                size: formatBytes(plan.transferBytes),
                            })}
                        </Typography>
                    )}
                    {conflicts.length > 0 && (
                        <>
                            <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                                {t('settingsPage.storage.merge.conflicts', { count: conflicts.length })}
                            </Typography>
                            <Stack direction='row' spacing={1}>
                                <Button size='small' variant='outlined' onClick={() => setAll('overwrite')}>
                                    {t('settingsPage.storage.merge.overwriteAll')}
                                </Button>
                                <Button size='small' variant='outlined' onClick={() => setAll('keep')}>
                                    {t('settingsPage.storage.merge.keepAll')}
                                </Button>
                            </Stack>
                            <Box sx={{ overflowX: 'auto' }}>
                                <Table size='small' sx={{ '& th': { whiteSpace: 'nowrap' } }}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell rowSpan={2}>{t('settingsPage.storage.merge.unit')}</TableCell>
                                            <TableCell colSpan={2}>{t('settingsPage.storage.merge.source')}</TableCell>
                                            <TableCell colSpan={2}>{t('settingsPage.storage.merge.target')}</TableCell>
                                            <TableCell rowSpan={2}>{t('settingsPage.storage.merge.choice')}</TableCell>
                                        </TableRow>
                                        <TableRow>
                                            {[0, 1].flatMap(side => [
                                                <TableCell key={`${side}-date`}>
                                                    {t('settingsPage.storage.merge.modifiedAt')}
                                                </TableCell>,
                                                <TableCell key={`${side}-contents`} align='right'>
                                                    {t('settingsPage.storage.merge.contentsLabel')}
                                                </TableCell>,
                                            ])}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {conflicts.map(conflict => {
                                            const sourceTime = conflict.source.modifiedAt ?? 0;
                                            const targetTime = conflict.target.modifiedAt ?? 0;
                                            return (
                                                <TableRow key={conflict.key} hover>
                                                    <TableCell sx={{ minWidth: 160 }}>
                                                        <Typography variant='body2'>
                                                            {unitName(t, conflict, items)}
                                                        </Typography>
                                                        {conflict.targetName &&
                                                            conflict.targetName !== conflict.name && (
                                                                <Typography variant='body2' color='text.secondary'>
                                                                    {t('settingsPage.storage.merge.targetName', {
                                                                        name: conflict.targetName,
                                                                    })}
                                                                </Typography>
                                                            )}
                                                        <Typography variant='caption' color='text.secondary'>
                                                            {kindLabel(t, conflict)}
                                                        </Typography>
                                                    </TableCell>
                                                    <StatsCells
                                                        stats={conflict.source}
                                                        newer={sourceTime > targetTime}
                                                    />
                                                    <StatsCells
                                                        stats={conflict.target}
                                                        newer={targetTime > sourceTime}
                                                    />
                                                    <TableCell sx={numberCellSx}>
                                                        <RadioGroup
                                                            row
                                                            sx={{ flexWrap: 'nowrap' }}
                                                            value={decisions[conflict.key] ?? ''}
                                                            onChange={event =>
                                                                setDecisions(previous => ({
                                                                    ...previous,
                                                                    [conflict.key]: event.target.value as
                                                                        'overwrite' | 'keep',
                                                                }))
                                                            }
                                                        >
                                                            <FormControlLabel
                                                                value='overwrite'
                                                                control={<Radio size='small' />}
                                                                label={t('settingsPage.storage.merge.overwrite')}
                                                            />
                                                            <FormControlLabel
                                                                value='keep'
                                                                control={<Radio size='small' />}
                                                                label={t('settingsPage.storage.merge.keep')}
                                                            />
                                                        </RadioGroup>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </Box>
                            <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                                {t('settingsPage.storage.merge.note')}
                            </Typography>
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant='contained' disabled={!plan || !decided} onClick={() => onRun(decisions)}>
                    {t('settingsPage.storage.moveRun')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
