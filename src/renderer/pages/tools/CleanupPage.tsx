import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import ProgressDialog from '../../components/common/ProgressDialog';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import Panel from '../../components/common/Panel';
import NoticeSnackbar from '../../components/common/NoticeSnackbar';
import { useCleanupStore } from '../../stores/cleanupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { CleanupCapabilities, CleanupRemoveResult, CleanupRoot, JobEvent } from '@shared/types';

// チェックボックスの行。既定より少し小さめの文字にして行間を詰める
const CHECKBOX_SX = { py: 0.25 };
const CHECKBOX_ROW_SX = {
    display: 'flex',
    ml: -0.5,
    mr: 0,
    '& .MuiFormControlLabel-label': { fontSize: '0.9375rem', lineHeight: 1.5 },
};

type RunningJob = {
    jobId: string;
    kind: 'scan' | 'remove';
    percent?: number;
    current?: number;
    total?: number;
    message?: string;
    foundCount: number;
};

export default function CleanupPage() {
    const { t } = useTranslation();
    const store = useCleanupStore();
    const { settings, appInfo, update } = useSettingsStore();
    const [roots, setRoots] = React.useState<CleanupRoot[]>([]);
    const [capabilities, setCapabilities] = React.useState<CleanupCapabilities | null>(null);
    const [job, setJob] = React.useState<RunningJob | null>(null);
    const [warning, setWarning] = React.useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = React.useState(false);
    const [noneFoundOpen, setNoneFoundOpen] = React.useState(false);
    const [result, setResult] = React.useState<CleanupRemoveResult | null>(null);

    const customDirs = settings?.cleanup.customDirs;
    React.useEffect(() => {
        let cancelled = false;
        window.kuraToolkit.cleanup.getRoots().then(loaded => {
            if (!cancelled) setRoots(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [customDirs]);

    // 利用可能な対象と権限状態を取得する
    const refreshCapabilities = React.useCallback(() => {
        window.kuraToolkit.cleanup.getCapabilities().then(setCapabilities);
    }, []);
    React.useEffect(() => {
        refreshCapabilities();
    }, [refreshCapabilities]);

    const activeJobId = job?.jobId;
    React.useEffect(() => {
        if (!activeJobId) return;
        const unsubscribe = window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== activeJobId) return;
            setJob(previous => {
                if (!previous || previous.jobId !== event.jobId) return previous;
                if (event.kind === 'item') {
                    return { ...previous, foundCount: previous.foundCount + 1 };
                }
                if (event.kind === 'progress' || event.kind === 'log') {
                    return {
                        ...previous,
                        percent: event.percent ?? previous.percent,
                        current: event.current ?? previous.current,
                        total: event.total ?? previous.total,
                        message: event.message ?? previous.message,
                    };
                }
                return previous;
            });
        });
        return unsubscribe;
    }, [activeJobId]);

    if (!settings) return null;

    const availableTargets = capabilities?.availableTargets ?? [];
    const needsPermissionNotice =
        capabilities?.requiresFullDiskAccess === true && capabilities.hasFullDiskAccess === false;

    const rootLabel = (root: CleanupRoot): string => {
        if (root.kind === 'home') {
            return appInfo?.os === 'win32'
                ? t('cleanupPage.homeWin', { path: root.path })
                : t('cleanupPage.homeOther', { path: root.path });
        }
        if (root.kind === 'drive') {
            // Windows は "C:" 形式、macOS/Linux はマウントパスをそのまま表示する
            const isWindowsDrive = /^[A-Za-z]:[\\/]?$/.test(root.path);
            const name = isWindowsDrive ? root.path.replace(/\\$/, '') : root.path;
            const labelKey = isWindowsDrive ? 'drive' : 'volume';
            let label =
                root.sizeGb != null
                    ? t(`cleanupPage.${labelKey}WithSize`, { drive: name, size: root.sizeGb })
                    : t(`cleanupPage.${labelKey}`, { drive: name });
            if (root.removable) label += ` ${t('cleanupPage.removableSuffix')}`;
            if (root.network) label += ` ${t('cleanupPage.networkSuffix')}`;
            return label;
        }
        return root.path;
    };

    const addDirectory = async () => {
        const selected = await window.kuraToolkit.dialog.openDirectory();
        if (!selected) return;
        if (!settings.cleanup.customDirs.includes(selected)) {
            await update({ cleanup: { customDirs: [...settings.cleanup.customDirs, selected] } });
        }
        if (!store.selectedRoots.includes(selected)) {
            store.toggleRoot(selected);
        }
    };

    // 追加したディレクトリを一覧から取り除く (設定にも保存されているため削除も必要)
    const removeDirectory = async (dirPath: string) => {
        await update({ cleanup: { customDirs: settings.cleanup.customDirs.filter(dir => dir !== dirPath) } });
        if (store.selectedRoots.includes(dirPath)) {
            store.toggleRoot(dirPath);
        }
    };

    const runScan = async () => {
        if (store.selectedTargets.length === 0) {
            setWarning(t('cleanupPage.needTargets'));
            return;
        }
        if (store.selectedRoots.length === 0) {
            setWarning(t('cleanupPage.needDirs'));
            return;
        }
        const jobId = crypto.randomUUID();
        setJob({ jobId, kind: 'scan', foundCount: 0 });
        try {
            const scanResult = await window.kuraToolkit.cleanup.scan(jobId, {
                roots: store.selectedRoots,
                targets: store.selectedTargets,
            });
            store.setItems(scanResult.items);
            if (!scanResult.cancelled && scanResult.items.length === 0) {
                // 一瞬で消える通知では見落とされるため、閉じるまで残るダイアログで伝える
                setNoneFoundOpen(true);
            }
        } catch (error) {
            setWarning(error instanceof Error ? error.message : String(error));
        } finally {
            setJob(null);
        }
    };

    const runCleanup = async () => {
        setConfirmOpen(false);
        const targets = store.items.filter(item => store.checked.includes(item.path));
        const jobId = crypto.randomUUID();
        setJob({ jobId, kind: 'remove', foundCount: 0 });
        try {
            const removeResult = await window.kuraToolkit.cleanup.remove(jobId, targets);
            setResult(removeResult);
            // 失敗した項目以外を一覧から取り除く
            const failedPaths = new Set(removeResult.failed.map(item => item.path));
            store.setItems(store.items.filter(item => !store.checked.includes(item.path) || failedPaths.has(item.path)));
        } catch (error) {
            setWarning(error instanceof Error ? error.message : String(error));
        } finally {
            setJob(null);
        }
    };

    return (
        <PageContainer>
            {/* macOS でフルディスクアクセスが未許可の場合の案内 */}
            {needsPermissionNotice && (
                <Alert
                    severity='info'
                    action={
                        <Stack direction='row' spacing={1}>
                            <Button color='inherit' size='small' onClick={refreshCapabilities}>
                                {t('cleanupPage.recheckPermission')}
                            </Button>
                            <Button
                                color='inherit'
                                size='small'
                                variant='outlined'
                                onClick={() => void window.kuraToolkit.cleanup.openPermissionSettings()}
                            >
                                {t('cleanupPage.openPermissionSettings')}
                            </Button>
                        </Stack>
                    }
                >
                    {t('cleanupPage.fullDiskAccessRequired')}
                </Alert>
            )}

            {/* 選択肢の枠は内容の高さに合わせ、スクロールさせない */}
            <Stack direction='row' spacing={2} sx={{ alignItems: 'stretch', flexShrink: 0 }}>
                {/* クリーンアップ対象 */}
                <Box sx={{ flex: 1 }}>
                    <SectionLabel
                        action={
                            <Button
                                size='small'
                                onClick={() =>
                                    store.setAllTargets(
                                        store.selectedTargets.length === availableTargets.length
                                            ? []
                                            : availableTargets
                                    )
                                }
                            >
                                {t('common.checkAll')}
                            </Button>
                        }
                    >
                        {t('cleanupPage.targets')}
                    </SectionLabel>
                    <Panel>
                        {availableTargets.map(target => (
                            <FormControlLabel
                                key={target}
                                sx={CHECKBOX_ROW_SX}
                                control={
                                    <Checkbox
                                        size='small'
                                        sx={CHECKBOX_SX}
                                        checked={store.selectedTargets.includes(target)}
                                        onChange={() => store.toggleTarget(target)}
                                    />
                                }
                                label={t(`cleanupPage.targetLabels.${target}`)}
                            />
                        ))}
                    </Panel>
                </Box>

                {/* 検索対象ディレクトリ */}
                <Box sx={{ flex: 1 }}>
                    <SectionLabel
                        action={
                            <Button
                                size='small'
                                onClick={() =>
                                    store.setAllRoots(
                                        store.selectedRoots.length === roots.length ? [] : roots.map(root => root.path)
                                    )
                                }
                            >
                                {t('common.checkAll')}
                            </Button>
                        }
                    >
                        {t('cleanupPage.dirs')}
                    </SectionLabel>
                    <Panel>
                        {roots.map(root => (
                            <Box key={root.id} sx={{ display: 'flex', alignItems: 'center' }}>
                                <FormControlLabel
                                    sx={{ ...CHECKBOX_ROW_SX, flexGrow: 1, minWidth: 0 }}
                                    control={
                                        <Checkbox
                                            size='small'
                                            sx={CHECKBOX_SX}
                                            checked={store.selectedRoots.includes(root.path)}
                                            onChange={() => store.toggleRoot(root.path)}
                                        />
                                    }
                                    label={rootLabel(root)}
                                />
                                {/* 自分で追加したディレクトリのみ取り除ける */}
                                {root.kind === 'custom' && (
                                    <Tooltip title={t('cleanupPage.removeDirectory')}>
                                        <IconButton
                                            size='small'
                                            onClick={() => void removeDirectory(root.path)}
                                            sx={{ ml: 0.5 }}
                                        >
                                            <DeleteIcon fontSize='small' />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>
                        ))}
                        <Button size='small' fullWidth variant='outlined' sx={{ mt: 1 }} onClick={addDirectory}>
                            {t('cleanupPage.addDirectory')}
                        </Button>
                    </Panel>
                </Box>
            </Stack>

            {/* 検索結果。残りの高さを埋め、あふれた分はこの枠の中でスクロールする */}
            <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minHeight: 180 }}>
                <SectionLabel>
                    {t('cleanupPage.colPath')}
                    {store.items.length > 0 ? ` (${t('cleanupPage.foundCount', { count: store.items.length })})` : ''}
                </SectionLabel>
                <Panel disablePadding sx={{ flexGrow: 1, overflow: 'auto', py: 0.5 }}>
                    {store.items.map(item => (
                        <Box key={item.path} sx={{ display: 'flex', alignItems: 'center', px: 1, gap: 0.5 }}>
                            <Checkbox
                                size='small'
                                sx={CHECKBOX_SX}
                                checked={store.checked.includes(item.path)}
                                onChange={() => store.toggleChecked(item.path)}
                            />
                            <Typography variant='body2' sx={{ wordBreak: 'break-all', lineHeight: 1.5 }}>
                                {item.path}
                            </Typography>
                        </Box>
                    ))}
                </Panel>
            </Box>

            <Stack direction='row' spacing={1} sx={{ flexShrink: 0 }}>
                <Button variant='contained' fullWidth onClick={runScan} disabled={job !== null}>
                    {t('cleanupPage.search')}
                </Button>
                <Button
                    variant='outlined'
                    fullWidth
                    onClick={() => store.setChecked(store.items.map(item => item.path))}
                    disabled={store.items.length === 0}
                >
                    {t('common.selectAll')}
                </Button>
                <Button
                    variant='outlined'
                    fullWidth
                    onClick={() => store.setChecked([])}
                    disabled={store.items.length === 0}
                >
                    {t('common.deselectAll')}
                </Button>
                <Button
                    variant='contained'
                    color='warning'
                    fullWidth
                    onClick={() => {
                        if (store.checked.length === 0) {
                            setWarning(t('cleanupPage.needChecked'));
                            return;
                        }
                        setConfirmOpen(true);
                    }}
                    disabled={job !== null || store.items.length === 0}
                >
                    {t('cleanupPage.cleanup')}
                </Button>
            </Stack>

            <ProgressDialog
                open={job !== null}
                title={job?.kind === 'scan' ? t('cleanupPage.searching') : t('cleanupPage.cleaning')}
                percent={job?.kind === 'remove' ? job?.percent : undefined}
                current={job?.current}
                total={job?.total}
                status={job?.kind === 'scan' ? t('cleanupPage.foundCount', { count: job.foundCount }) : undefined}
                message={job?.message ?? ''}
                onCancel={() => {
                    if (job) void window.kuraToolkit.jobs.cancel(job.jobId);
                }}
            />

            {/* 検索したが対象が無かった場合 */}
            <Dialog open={noneFoundOpen} onClose={() => setNoneFoundOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('cleanupPage.searchResultTitle')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('cleanupPage.noneFound')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNoneFoundOpen(false)}>{t('common.close')}</Button>
                </DialogActions>
            </Dialog>

            {/* 削除確認 */}
            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('cleanupPage.confirmTitle')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('cleanupPage.confirmMessage', { count: store.checked.length })}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
                    <Button color='warning' variant='contained' onClick={runCleanup}>
                        {t('cleanupPage.cleanup')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 結果 */}
            <Dialog open={result !== null} onClose={() => setResult(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('common.done')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>
                        {t('cleanupPage.resultSummary', {
                            ok: result?.deleted ?? 0,
                            failed: result?.failed.length ?? 0,
                        })}
                    </Typography>
                    {result && result.failed.length > 0 && (
                        <>
                            <Typography variant='body2' sx={{ mb: 0.5 }}>
                                {t('cleanupPage.failedItems')}
                            </Typography>
                            {result.failed.map(item => (
                                <Typography key={item.path} variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                                    {item.path} ({item.error})
                                </Typography>
                            ))}
                        </>
                    )}
                    <Typography sx={{ mt: 2 }}>{t('cleanupPage.rescanQuestion')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResult(null)}>{t('common.close')}</Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            setResult(null);
                            void runScan();
                        }}
                    >
                        {t('cleanupPage.rescan')}
                    </Button>
                </DialogActions>
            </Dialog>

            <NoticeSnackbar message={warning} severity='warning' onClose={() => setWarning(null)} />
        </PageContainer>
    );
}
