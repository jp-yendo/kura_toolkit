import React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Checkbox,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    InputLabel,
    Link,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AppDialog from '../common/AppDialog';
import Panel from '../common/Panel';
import ProgressDialog from '../common/ProgressDialog';
import SectionLabel from '../common/SectionLabel';
import LibraryItemTable from './LibraryItemTable';
import { itemLabel, totalSize, withPrerequisites } from './libraryItems';
import { formatBytes } from './voiceFormat';
import { voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { notifyVoiceLibraryChanged, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import type {
    LibraryDownloadResult,
    LibraryItem,
    LibraryItemGroup,
    LibraryProgress,
    LibraryStatus,
    SeparationCategory,
    VoiceFeatureId,
} from '@shared/voice/types';

const SEPARATION_CATEGORIES: SeparationCategory[] = ['vocals', 'multi', 'karaoke', 'cleanup', 'other'];
const VC_REDIST_URL = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';

// 音声機能のダウンロード (Python 本体・パッケージ一式・モデルの取得と削除)。
// アプリに 1 つだけ置き、各機能の画面・不足の案内・アプリ設定などから openVoiceLibrary() で呼び出す
export default function VoiceLibraryDialog() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { open, select, focus, version, close } = useVoiceLibraryStore();
    const [status, setStatus] = React.useState<LibraryStatus | null>(null);
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [progress, setProgress] = React.useState<Record<string, LibraryProgress>>({});
    const [result, setResult] = React.useState<LibraryDownloadResult | null>(null);
    const [removeTargets, setRemoveTargets] = React.useState<string[] | null>(null);
    const [removePython, setRemovePython] = React.useState(false);
    const [categoryFilter, setCategoryFilter] = React.useState<SeparationCategory | 'all'>('all');
    const [search, setSearch] = React.useState('');
    const [installedOnly, setInstalledOnly] = React.useState(false);
    const [selectedOnly, setSelectedOnly] = React.useState(false);
    const [listing, setListing] = React.useState(false);
    const groupRefs = React.useRef<Partial<Record<LibraryItemGroup, HTMLDivElement | null>>>({});
    const pendingFocus = React.useRef<LibraryItemGroup | null>(null);
    const { job, run, cancel } = useJobRunner();

    const refresh = React.useCallback(async () => {
        setStatus(await window.kuraToolkit.voice.library.getStatus());
    }, []);

    // 開くたびに、呼び出し元が指定した項目を選んだ状態にする
    React.useEffect(() => {
        if (!open) return;
        setSelected(new Set(select));
        setProgress({});
        setSearch('');
        setCategoryFilter('all');
        setInstalledOnly(false);
        setSelectedOnly(select.some(id => id.startsWith('model:separator:')));
        pendingFocus.current = focus;
        void refresh();
    }, [open, select, focus, refresh]);

    // 他の場所で取得状況が変わった場合 (プリセットの声の取得など) も読み直す
    React.useEffect(() => {
        if (open) void refresh();
    }, [version, open, refresh]);

    // 呼び出し元に関係する区分を表示する
    React.useEffect(() => {
        const group = pendingFocus.current;
        if (!open || !status || !group) return;
        pendingFocus.current = null;
        window.requestAnimationFrame(() => groupRefs.current[group]?.scrollIntoView({ block: 'start' }));
    }, [open, status]);

    // 分離モデルの大きさを配布元に問い合わせる (一覧を取得済みで、まだ分からないものがある場合)
    const needsSizes =
        open &&
        !!status?.items.some(item => item.group === 'separator' && item.kind === 'model' && item.sizeBytes === null);
    React.useEffect(() => {
        if (!needsSizes) return;
        let cancelled = false;
        void window.kuraToolkit.voice.library.probeSeparatorSizes().then(next => {
            if (!cancelled) setStatus(next);
        });
        return () => {
            cancelled = true;
        };
    }, [needsSizes]);

    // 進捗の詳細を項目ごとに覚える
    React.useEffect(() => {
        const payload = job?.payload as LibraryProgress | undefined;
        if (payload?.itemId) setProgress(previous => ({ ...previous, [payload.itemId]: payload }));
    }, [job?.payload]);

    const items = status?.items ?? [];
    const byId = new Map(items.map(item => [item.id, item]));
    const platform = status?.platform;

    const toggle = (id: string) =>
        setSelected(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const downloadIds = withPrerequisites([...selected], items);
    const totalBytes = totalSize(downloadIds, items);
    const removableSelected = [...selected].filter(id => {
        const item = byId.get(id);
        return item && item.status !== 'missing';
    });

    const startDownload = async (ids: string[]) => {
        if (ids.length === 0) return;
        setProgress({});
        try {
            const outcome = await run(t('voice.library.downloading'), jobId =>
                window.kuraToolkit.voice.library.download(jobId, ids)
            );
            await refresh();
            notifyVoiceLibraryChanged();
            const failed = outcome.results.filter(item => !item.ok && !item.cancelled);
            // 失敗した項目があれば一覧で示す (中断した項目も含めて再試行できる)。
            // 中断しただけの場合は通知のみとし、選択はそのまま残す (もう一度ダウンロードすると続きから取得する)
            if (failed.length > 0) {
                setResult(outcome);
            } else if (outcome.cancelled) {
                showNotice('warning', t('voice.library.cancelled'));
            } else {
                showNotice('success', t('voice.library.downloaded'));
                setSelected(new Set());
            }
        } catch (error) {
            await refresh();
            notifyVoiceLibraryChanged();
            showNotice('error', voiceErrorMessage(t, error), 10000);
        }
    };

    const confirmRemove = async () => {
        if (!removeTargets) return;
        const targets = removeTargets;
        setRemoveTargets(null);
        try {
            const outcome = await window.kuraToolkit.voice.library.remove(targets, { removePython });
            await refresh();
            notifyVoiceLibraryChanged();
            setSelected(new Set());
            if (outcome.failed.length > 0) {
                showNotice('error', t('voice.library.removeFailed', { count: outcome.failed.length }), 10000);
            } else {
                showNotice('success', t('voice.library.removed'));
            }
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 10000);
        }
    };

    const listSeparatorModels = async () => {
        setListing(true);
        try {
            setStatus(await window.kuraToolkit.voice.library.refreshSeparatorModels());
            notifyVoiceLibraryChanged();
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 10000);
        } finally {
            setListing(false);
        }
    };

    const runtimeItems = items.filter(item => item.kind !== 'model');
    const converterModels = items.filter(item => item.kind === 'model' && item.group === 'converter');
    const ttsModels = items.filter(item => item.kind === 'model' && item.group === 'tts');
    // 分離モデルの一覧が無いときに示す、取得済みの分離モデル
    const unlistedSeparators = items.filter(item => item.kind === 'model' && item.group === 'separator');
    const separatorModels = items
        .filter(item => item.kind === 'model' && item.group === 'separator')
        .filter(item => categoryFilter === 'all' || item.separator?.category === categoryFilter)
        .filter(item => !installedOnly || item.status === 'installed')
        .filter(item => !selectedOnly || selected.has(item.id))
        .filter(item => !search.trim() || itemLabel(t, item).toLowerCase().includes(search.trim().toLowerCase()));

    // 削除の確認に出す内容
    const removeItemsList = (removeTargets ?? []).map(id => byId.get(id)).filter((item): item is LibraryItem => !!item);
    const installedComponents = items.filter(item => item.kind === 'component' && item.status !== 'missing');
    const removingAllComponents =
        installedComponents.length > 0 && installedComponents.every(item => removeTargets?.includes(item.id));
    const removingPythonItem = removeTargets?.includes('python') ?? false;
    const affected = new Set<VoiceFeatureId>();
    removeItemsList.forEach(item => item.usedBy.forEach(feature => affected.add(feature)));

    const progressDetails = Object.values(progress).map(entry => {
        const item = byId.get(entry.itemId);
        const name = item ? itemLabel(t, item) : entry.itemId;
        const percent =
            entry.totalBytes && entry.state === 'downloading'
                ? ` ${Math.min(100, Math.round((entry.receivedBytes / entry.totalBytes) * 100))}%`
                : '';
        return `${name}: ${t(`voice.library.progress.${entry.state}`)}${percent}${entry.detail && entry.state !== 'failed' ? ` (${entry.detail})` : ''}`;
    });
    const current = job?.payload as LibraryProgress | undefined;
    const currentItem = current ? byId.get(current.itemId) : undefined;

    // 削除の確認を開く (Python 本体も消すかの選択は毎回初期状態に戻す)
    const askRemove = (ids: string[]) => {
        setRemovePython(false);
        setRemoveTargets(ids);
    };

    const closeDialog = () => {
        if (job) return;
        close();
    };

    const section = (group: LibraryItemGroup, title: string, body: React.ReactNode, action?: React.ReactNode) => (
        <Box
            ref={(element: HTMLDivElement | null) => {
                groupRefs.current[group] = element;
            }}
            sx={{ scrollMarginTop: 8 }}
        >
            <SectionLabel action={action}>{title}</SectionLabel>
            {body}
        </Box>
    );

    return (
        <>
            <AppDialog
                open={open}
                onClose={closeDialog}
                maxWidth='lg'
                fullWidth
                slotProps={{ paper: { sx: { height: '90vh' } } }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
                    <Box component='span' sx={{ flexGrow: 1 }}>
                        {t('voice.library.title')}
                    </Box>
                    <Tooltip title={t('common.close')}>
                        <span>
                            <IconButton
                                size='small'
                                aria-label={t('common.close')}
                                onClick={closeDialog}
                                disabled={job !== null}
                            >
                                <CloseIcon fontSize='small' />
                            </IconButton>
                        </span>
                    </Tooltip>
                </DialogTitle>
                <DialogContent dividers>
                    {status && platform && (
                        <Stack spacing={2}>
                            <Box>
                                <SectionLabel
                                    action={
                                        <Button
                                            size='small'
                                            startIcon={<RefreshIcon />}
                                            onClick={async () =>
                                                setStatus(await window.kuraToolkit.voice.library.refreshPlatform())
                                            }
                                        >
                                            {t('voice.library.redetect')}
                                        </Button>
                                    }
                                >
                                    {t('voice.library.environment')}
                                </SectionLabel>
                                <Panel>
                                    <Stack spacing={0.75}>
                                        <Typography variant='body2'>
                                            {t('voice.library.platform')}:{' '}
                                            {t(`voice.platform.keys.${platform.platform}`)}
                                        </Typography>
                                        <Typography variant='body2'>
                                            {t('voice.library.device')}:{' '}
                                            {platform.gpu.kind === 'cuda'
                                                ? t('voice.platform.cuda', { name: platform.gpu.name ?? '' })
                                                : platform.gpu.kind === 'mps'
                                                  ? t('voice.platform.mps')
                                                  : t('voice.platform.cpu')}
                                        </Typography>
                                        <Typography variant='body2' sx={{ wordBreak: 'break-all' }}>
                                            {t('voice.library.libraryDir')}: {platform.libraryDir}
                                        </Typography>
                                        <Typography variant='body2' sx={{ wordBreak: 'break-all' }}>
                                            {t('voice.library.modelDir')}: {platform.modelDir}{' '}
                                            <Link
                                                component='button'
                                                variant='body2'
                                                onClick={() => {
                                                    close();
                                                    navigate('/settings');
                                                }}
                                            >
                                                {t('voice.library.changeInSettings')}
                                            </Link>
                                        </Typography>
                                    </Stack>
                                </Panel>
                            </Box>

                            {!platform.supported && (
                                <Alert severity='error'>
                                    <AlertTitle>{t('voice.platform.unsupportedTitle')}</AlertTitle>
                                    {t(`voice.platform.unsupported.${platform.unsupportedReason ?? 'os'}`)}
                                </Alert>
                            )}
                            {platform.vcRuntimeMissing && (
                                <Alert
                                    severity='warning'
                                    action={
                                        <Button
                                            color='inherit'
                                            size='small'
                                            onClick={() => void window.kuraToolkit.voice.openExternal(VC_REDIST_URL)}
                                        >
                                            {t('voice.library.vcRuntimeOpen')}
                                        </Button>
                                    }
                                >
                                    {t('voice.library.vcRuntimeMissing')}
                                </Alert>
                            )}
                            {platform.gpu.driverUpdateRequired && (
                                <Alert severity='warning'>{t('voice.library.driverUpdate')}</Alert>
                            )}
                            {platform.storageNonAscii && (
                                <Alert severity='warning'>{t('voice.library.nonAsciiPath')}</Alert>
                            )}

                            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                {t('voice.library.intro')}
                            </Typography>

                            {section(
                                'runtime',
                                t('voice.library.groupRuntime'),
                                <LibraryItemTable
                                    items={runtimeItems}
                                    selected={selected}
                                    toggle={toggle}
                                    onRemove={askRemove}
                                    progress={progress}
                                />
                            )}

                            {section(
                                'separator',
                                t('voice.library.groupSeparator'),
                                status.separatorModelsListed ? (
                                    <Stack spacing={1}>
                                        <Stack
                                            direction='row'
                                            spacing={1}
                                            sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
                                        >
                                            <FormControl size='small' sx={{ minWidth: 220 }}>
                                                <InputLabel id='separator-category'>
                                                    {t('voice.separation.category')}
                                                </InputLabel>
                                                <Select
                                                    labelId='separator-category'
                                                    label={t('voice.separation.category')}
                                                    value={categoryFilter}
                                                    onChange={event =>
                                                        setCategoryFilter(
                                                            event.target.value as SeparationCategory | 'all'
                                                        )
                                                    }
                                                >
                                                    <MenuItem value='all'>{t('voice.library.allCategories')}</MenuItem>
                                                    {SEPARATION_CATEGORIES.map(category => (
                                                        <MenuItem key={category} value={category}>
                                                            {t(`voice.separation.categories.${category}`)}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                            <TextField
                                                size='small'
                                                placeholder={t('voice.library.searchModels')}
                                                value={search}
                                                onChange={event => setSearch(event.target.value)}
                                                slotProps={{
                                                    input: {
                                                        startAdornment: (
                                                            <InputAdornment position='start'>
                                                                <SearchIcon fontSize='small' />
                                                            </InputAdornment>
                                                        ),
                                                    },
                                                }}
                                            />
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        size='small'
                                                        checked={installedOnly}
                                                        onChange={(_e, value) => setInstalledOnly(value)}
                                                    />
                                                }
                                                label={t('voice.library.installedOnly')}
                                            />
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        size='small'
                                                        checked={selectedOnly}
                                                        onChange={(_e, value) => setSelectedOnly(value)}
                                                    />
                                                }
                                                label={t('voice.library.selectedOnly')}
                                            />
                                        </Stack>
                                        <LibraryItemTable
                                            items={separatorModels}
                                            selected={selected}
                                            toggle={toggle}
                                            onRemove={askRemove}
                                            progress={progress}
                                            maxHeight={420}
                                        />
                                    </Stack>
                                ) : (
                                    <Stack spacing={1}>
                                        <Panel>
                                            <Stack
                                                direction='row'
                                                spacing={2}
                                                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                                            >
                                                <Typography
                                                    variant='body2'
                                                    color='text.secondary'
                                                    sx={{ lineHeight: 1.6 }}
                                                >
                                                    {t('voice.library.separatorListHint')}
                                                </Typography>
                                                <Button
                                                    variant='outlined'
                                                    size='small'
                                                    disabled={
                                                        listing ||
                                                        byId.get('component:separator')?.status !== 'installed'
                                                    }
                                                    onClick={listSeparatorModels}
                                                    sx={{ flexShrink: 0 }}
                                                >
                                                    {t('voice.library.listModels')}
                                                </Button>
                                            </Stack>
                                        </Panel>
                                        {/* 一覧が無くても、取得済みの分離モデルは削除できるよう示す */}
                                        {unlistedSeparators.length > 0 && (
                                            <LibraryItemTable
                                                items={unlistedSeparators}
                                                selected={selected}
                                                toggle={toggle}
                                                onRemove={askRemove}
                                                progress={progress}
                                                maxHeight={420}
                                            />
                                        )}
                                    </Stack>
                                ),
                                status.separatorModelsListed ? (
                                    <Button
                                        size='small'
                                        startIcon={<RefreshIcon />}
                                        disabled={listing}
                                        onClick={listSeparatorModels}
                                    >
                                        {t('voice.library.refreshList')}
                                    </Button>
                                ) : undefined
                            )}

                            {section(
                                'converter',
                                t('voice.library.groupConverter'),
                                <LibraryItemTable
                                    items={converterModels}
                                    selected={selected}
                                    toggle={toggle}
                                    onRemove={askRemove}
                                    progress={progress}
                                />
                            )}

                            {section(
                                'tts',
                                t('voice.library.groupTts'),
                                <LibraryItemTable
                                    items={ttsModels}
                                    selected={selected}
                                    toggle={toggle}
                                    onRemove={askRemove}
                                    progress={progress}
                                />
                            )}
                        </Stack>
                    )}
                </DialogContent>
                {/* 削除はダウンロードの操作から離して左端に置く (押すと確認を出す) */}
                <DialogActions sx={{ px: 3, py: 1.5, gap: 1.5, flexWrap: 'wrap' }}>
                    <Button
                        color='error'
                        startIcon={<DeleteOutlineIcon />}
                        disabled={removableSelected.length === 0 || job !== null}
                        onClick={() => askRemove(removableSelected)}
                    >
                        {t('voice.library.deleteSelected')}
                    </Button>
                    <Typography variant='body2' sx={{ flexGrow: 1, textAlign: 'right' }}>
                        {downloadIds.length > 0
                            ? t('voice.library.selection', { count: downloadIds.length, size: formatBytes(totalBytes) })
                            : t('voice.library.selectionNone')}
                    </Typography>
                    <Button
                        variant='contained'
                        startIcon={<DownloadIcon />}
                        disabled={downloadIds.length === 0 || job !== null || !platform?.supported}
                        onClick={() => void startDownload(downloadIds)}
                    >
                        {t('voice.library.downloadSelected')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                status={currentItem ? itemLabel(t, currentItem) : undefined}
                message={current ? `${t(`voice.library.progress.${current.state}`)} ${current.detail ?? ''}` : ''}
                details={progressDetails}
                onCancel={cancel}
            />

            <AppDialog open={result !== null} onClose={() => setResult(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.library.resultTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.library.resultMessage')}
                    </Typography>
                    {result?.results
                        .filter(item => !item.ok)
                        .map(item => {
                            const entry = byId.get(item.id);
                            return (
                                <Box key={item.id} sx={{ mb: 1 }}>
                                    <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                        {entry ? itemLabel(t, entry) : item.id}
                                    </Typography>
                                    <Typography
                                        variant='caption'
                                        color='text.secondary'
                                        sx={{ wordBreak: 'break-all' }}
                                    >
                                        {item.cancelled
                                            ? t('voice.library.progress.cancelled')
                                            : voiceErrorMessage(t, new Error(item.error ?? ''))}
                                    </Typography>
                                </Box>
                            );
                        })}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResult(null)}>{t('common.close')}</Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            const retry = (result?.results ?? []).filter(item => !item.ok).map(item => item.id);
                            setResult(null);
                            void startDownload(retry);
                        }}
                    >
                        {t('voice.library.retry')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={removeTargets !== null} onClose={() => setRemoveTargets(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.library.removeTitle')}</DialogTitle>
                <DialogContent>
                    <Box component='ul' sx={{ mt: 0, pl: 2.5 }}>
                        {removeItemsList.map(item => (
                            <Typography component='li' variant='body2' key={item.id}>
                                {itemLabel(t, item)}
                            </Typography>
                        ))}
                    </Box>
                    {removingPythonItem && (
                        <Alert severity='warning' sx={{ mb: 1 }}>
                            {t('voice.library.removePythonWarning')}
                        </Alert>
                    )}
                    {!removingPythonItem && removingAllComponents && (
                        <FormControlLabel
                            control={
                                <Checkbox checked={removePython} onChange={(_e, value) => setRemovePython(value)} />
                            }
                            label={t('voice.library.alsoRemovePython')}
                        />
                    )}
                    {affected.size > 0 && (
                        <Typography variant='body2' sx={{ lineHeight: 1.6, mt: 1 }}>
                            {t('voice.library.removeAffects', {
                                features: [...affected]
                                    .map(feature => t(`voice.features.${feature}`))
                                    .join(t('voice.common.listSeparator')),
                            })}
                        </Typography>
                    )}
                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6, mt: 1 }}>
                        {t('voice.library.removeNote')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoveTargets(null)}>{t('common.cancel')}</Button>
                    <Button variant='contained' color='error' onClick={() => void confirmRemove()}>
                        {t('voice.library.delete')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </>
    );
}
