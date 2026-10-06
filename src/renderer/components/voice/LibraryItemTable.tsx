import React from 'react';
import {
    Box,
    Checkbox,
    Chip,
    IconButton,
    Link,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import { itemLabel, type RequirementRow } from './libraryItems';
import { separatorFilename } from './separatorModelNotes';
import SeparatorModelSummary from './SeparatorModelSummary';
import { formatBytes } from './voiceFormat';
import type { LibraryItem, LibraryProgress } from '@shared/voice/types';

export const STATUS_COLORS: Record<LibraryItem['status'], 'default' | 'success' | 'warning' | 'error'> = {
    missing: 'default',
    installed: 'success',
    outdated: 'warning',
    broken: 'error',
};

const captionSx = { display: 'block', lineHeight: 1.5 } as const;

type RowProps = {
    row: RequirementRow;
    checked: boolean;
    toggle(id: string): void;
    onRemove(ids: string[]): void;
    progress?: LibraryProgress;
};

// 1 行。選択を切り替えても、変わった行だけを描き直す (分離モデルは 100 以上並ぶため)
export const ItemRow = React.memo(function ItemRow({ row, checked, toggle, onRemove, progress }: RowProps) {
    const { t } = useTranslation();
    const { item, depth, conditionKey, prerequisites } = row;
    const removable = item.status !== 'missing';
    return (
        <TableRow hover>
            <TableCell padding='checkbox'>
                <Checkbox
                    size='small'
                    checked={checked}
                    disabled={!item.available}
                    onChange={() => toggle(item.id)}
                    slotProps={{ input: { 'aria-label': itemLabel(t, item) } }}
                />
            </TableCell>
            <TableCell sx={{ minWidth: 0, pl: 1 + depth * 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {depth > 0 && <SubdirectoryArrowRightIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
                    <Typography variant='body2' sx={{ fontWeight: 600 }}>
                        {itemLabel(t, item)}
                    </Typography>
                </Box>
                {conditionKey && (
                    <Typography variant='caption' color='primary' sx={captionSx}>
                        {t(conditionKey)}
                    </Typography>
                )}
                {item.descriptionKey && (
                    <Typography variant='caption' color='text.secondary' sx={captionSx}>
                        {t(item.descriptionKey)}
                    </Typography>
                )}
                {item.separator && (
                    <SeparatorModelSummary
                        filename={separatorFilename(item)}
                        arch={item.separator.arch}
                        stems={item.separator.stems}
                        sdr={item.separator.sdr}
                    />
                )}
                {prerequisites.length > 0 && (
                    <Typography variant='caption' color='text.secondary' sx={captionSx}>
                        {t('voice.library.prerequisites', {
                            items: prerequisites
                                .map(entry => itemLabel(t, entry))
                                .join(t('voice.common.listSeparator')),
                        })}
                    </Typography>
                )}
                {!item.available && item.unavailableReasonKey && (
                    <Typography variant='caption' color='warning.main' sx={captionSx}>
                        {t(item.unavailableReasonKey)}
                    </Typography>
                )}
                {progress && progress.state === 'failed' && (
                    <Typography variant='caption' color='error' sx={{ display: 'block', wordBreak: 'break-all' }}>
                        {progress.detail}
                    </Typography>
                )}
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }} align='right'>
                <Typography variant='body2'>
                    {item.sizeEstimated && item.sizeBytes
                        ? t('voice.library.approx', { size: formatBytes(item.sizeBytes) })
                        : formatBytes(item.sizeBytes)}
                </Typography>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Chip
                    size='small'
                    color={STATUS_COLORS[item.status]}
                    label={t(`voice.library.status.${item.status}`)}
                />
            </TableCell>
            <TableCell sx={{ wordBreak: 'break-word' }}>
                {item.license && (
                    <Typography variant='caption' sx={{ display: 'block' }}>
                        {item.license.url ? (
                            <Link
                                component='button'
                                variant='caption'
                                onClick={() => void window.kuraToolkit.voice.openExternal(item.license?.url ?? '')}
                                sx={{ textAlign: 'left' }}
                            >
                                {item.license.name}
                            </Link>
                        ) : (
                            item.license.name
                        )}
                    </Typography>
                )}
                {item.source && item.source.url.startsWith('https://') && (
                    <Link
                        component='button'
                        variant='caption'
                        onClick={() => void window.kuraToolkit.voice.openExternal(item.source?.url ?? '')}
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, textAlign: 'left' }}
                    >
                        {t('voice.library.source')}
                        <OpenInNewIcon sx={{ fontSize: 12 }} />
                    </Link>
                )}
                {item.credit && (
                    <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.4 }}>
                        {t('voice.library.credit', { credit: item.credit })}
                    </Typography>
                )}
            </TableCell>
            <TableCell padding='checkbox'>
                {removable ? (
                    <Tooltip title={t('voice.library.delete')}>
                        <IconButton
                            size='small'
                            aria-label={t('voice.library.delete')}
                            onClick={() => onRemove([item.id])}
                        >
                            <DeleteOutlineIcon fontSize='small' />
                        </IconButton>
                    </Tooltip>
                ) : null}
            </TableCell>
        </TableRow>
    );
});

// ダウンロードの画面の表の枠 (列の構成と幅をすべての表で揃える)
export function LibraryTableShell({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    return (
        <Panel disablePadding sx={{ overflowX: 'auto' }}>
            <Table size='small' sx={{ tableLayout: 'fixed' }}>
                {/* 表ごとに列幅が変わらないよう、名前以外の列の幅を固定する */}
                <colgroup>
                    <col style={{ width: 52 }} />
                    <col />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 210 }} />
                    <col style={{ width: 52 }} />
                </colgroup>
                <TableHead>
                    <TableRow>
                        <TableCell padding='checkbox' />
                        <TableCell>{t('voice.library.colName')}</TableCell>
                        <TableCell align='right'>{t('voice.library.colSize')}</TableCell>
                        <TableCell>{t('voice.library.colStatus')}</TableCell>
                        <TableCell>{t('voice.library.colLicense')}</TableCell>
                        <TableCell padding='checkbox' />
                    </TableRow>
                </TableHead>
                <TableBody>{children}</TableBody>
            </Table>
        </Panel>
    );
}

type TableProps = {
    rows: RequirementRow[];
    selected: Set<string>;
    toggle(id: string): void;
    onRemove(ids: string[]): void;
    progress: Record<string, LibraryProgress>;
};

// ダウンロード項目の一覧 (階層・選択・状態・ライセンスと配布元・個別の削除)
export default function LibraryItemTable({ rows, selected, toggle, onRemove, progress }: TableProps) {
    return (
        <LibraryTableShell>
            {rows.map(row => (
                <ItemRow
                    key={row.key}
                    row={row}
                    checked={selected.has(row.item.id)}
                    toggle={toggle}
                    onRemove={onRemove}
                    progress={progress[row.item.id]}
                />
            ))}
        </LibraryTableShell>
    );
}
