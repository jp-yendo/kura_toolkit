import {
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
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import { itemLabel } from './libraryItems';
import { formatBytes } from './voiceFormat';
import type { LibraryItem, LibraryProgress } from '@shared/voice/types';

const STATUS_COLORS: Record<LibraryItem['status'], 'default' | 'success' | 'warning' | 'error'> = {
    missing: 'default',
    installed: 'success',
    outdated: 'warning',
    broken: 'error',
};

type RowProps = {
    item: LibraryItem;
    checked: boolean;
    onToggle(): void;
    onRemove(): void;
    progress?: LibraryProgress;
};

function ItemRow({ item, checked, onToggle, onRemove, progress }: RowProps) {
    const { t } = useTranslation();
    const removable = item.status !== 'missing';
    return (
        <TableRow hover>
            <TableCell padding='checkbox'>
                <Checkbox
                    size='small'
                    checked={checked}
                    disabled={!item.available}
                    onChange={onToggle}
                    slotProps={{ input: { 'aria-label': itemLabel(t, item) } }}
                />
            </TableCell>
            <TableCell sx={{ minWidth: 0 }}>
                <Typography variant='body2' sx={{ fontWeight: 600 }}>
                    {itemLabel(t, item)}
                </Typography>
                {item.descriptionKey && (
                    <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.5 }}>
                        {t(item.descriptionKey)}
                    </Typography>
                )}
                {item.separator && (
                    <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                        {item.separator.arch}
                        {item.separator.stems.length > 0 ? ` / ${item.separator.stems.join(', ')}` : ''}
                    </Typography>
                )}
                {!item.available && item.unavailableReasonKey && (
                    <Typography variant='caption' color='warning.main' sx={{ display: 'block' }}>
                        {t(item.unavailableReasonKey)}
                    </Typography>
                )}
                {progress && progress.state === 'failed' && (
                    <Typography variant='caption' color='error' sx={{ display: 'block', wordBreak: 'break-all' }}>
                        {progress.detail}
                    </Typography>
                )}
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap', width: 130 }} align='right'>
                <Typography variant='body2'>
                    {item.sizeEstimated && item.sizeBytes
                        ? t('voice.library.approx', { size: formatBytes(item.sizeBytes) })
                        : formatBytes(item.sizeBytes)}
                </Typography>
            </TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap', width: 120 }}>
                <Chip
                    size='small'
                    color={STATUS_COLORS[item.status]}
                    label={t(`voice.library.status.${item.status}`)}
                />
            </TableCell>
            <TableCell sx={{ width: 190 }}>
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
            <TableCell padding='checkbox' sx={{ width: 48 }}>
                {removable ? (
                    <Tooltip title={t('voice.library.delete')}>
                        <IconButton size='small' aria-label={t('voice.library.delete')} onClick={onRemove}>
                            <DeleteOutlineIcon fontSize='small' />
                        </IconButton>
                    </Tooltip>
                ) : null}
            </TableCell>
        </TableRow>
    );
}

type TableProps = {
    items: LibraryItem[];
    selected: Set<string>;
    toggle(id: string): void;
    onRemove(ids: string[]): void;
    progress: Record<string, LibraryProgress>;
    maxHeight?: number;
};

// ダウンロード項目の一覧 (選択・状態・ライセンスと配布元・個別の削除)
export default function LibraryItemTable({ items, selected, toggle, onRemove, progress, maxHeight }: TableProps) {
    const { t } = useTranslation();
    return (
        <Panel disablePadding sx={{ overflow: 'auto', maxHeight }}>
            <Table size='small' stickyHeader={maxHeight !== undefined}>
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
                <TableBody>
                    {items.map(item => (
                        <ItemRow
                            key={item.id}
                            item={item}
                            checked={selected.has(item.id)}
                            onToggle={() => toggle(item.id)}
                            onRemove={() => onRemove([item.id])}
                            progress={progress[item.id]}
                        />
                    ))}
                </TableBody>
            </Table>
        </Panel>
    );
}
