import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
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
import { errorMessage } from '../../components/common/errorMessage';
import AppDialog from '../../components/common/AppDialog';
import ProgressDialog from '../../components/common/ProgressDialog';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import Panel from '../../components/common/Panel';
import VirtualList from '../../components/common/VirtualList';
import { showNotice } from '../../stores/noticeStore';
import { useCleanupStore } from '../../stores/cleanupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { CleanupCapabilities, CleanupItem, CleanupRemoveResult, CleanupRoot, JobEvent } from '@shared/types';

// グループ配下の項目を字下げする量 (MUI の spacing 単位)
const CHILD_INDENT = 3;

// チェックボックスの行。既定より少し小さめの文字にして行間を詰める
const CHECKBOX_SX = { py: 0.25 };
const CHECKBOX_ROW_SX = {
    display: 'flex',
    ml: -0.5,
    mr: 0,
    '& .MuiFormControlLabel-label': { fontSize: '0.9375rem', lineHeight: 1.5 },
};

// 検索結果の 1 行の高さ (px)。一覧は見えている行だけを描くため、行の高さをそろえる
const RESULT_ROW_HEIGHT = 28;
// 検索結果を一度に受け取る件数 (1 回の IPC で送る量を抑えるため分けて受け取る)
const RESULT_PAGE_SIZE = 20000;

// 直近の検索結果を、分けてすべて受け取る
async function fetchScanItems(count: number): Promise<CleanupItem[]> {
    const items: CleanupItem[] = [];
    while (items.length < count) {
        const page = await window.kuraToolkit.cleanup.getItems(items.length, RESULT_PAGE_SIZE);
        if (page.length === 0) break;
        for (const item of page) items.push(item);
    }
    return items;
}

// 検索条件が前回と同じかどうか (並び順は問わない)
function sameSelection(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedB = [...b].sort();
    return [...a].sort().every((value, index) => value === sortedB[index]);
}

type RunningJob = {
    jobId: string;
    kind: 'scan' | 'remove';
    percent?: number;
    current?: number;
    total?: number;
    message?: string;
    foundCount: number;
    // 検索時のみ: 走査済みディレクトリ数と、走査スレッドごとの現在位置
    visitedDirs: number;
    workers: (string | null)[];
};

export default function CleanupPage() {
    const { t } = useTranslation();
    const store = useCleanupStore();
    const { settings, appInfo, update } = useSettingsStore();
    const [roots, setRoots] = React.useState<CleanupRoot[]>([]);
    const [capabilities, setCapabilities] = React.useState<CleanupCapabilities | null>(null);
    const [job, setJob] = React.useState<RunningJob | null>(null);
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

    // 前回の検索条件を復元する (起動後 1 回だけ)
    React.useEffect(() => {
        if (!settings) return;
        useCleanupStore.getState().restore(settings.cleanup.selectedTargets, settings.cleanup.selectedRoots);
    }, [settings]);

    // 一覧に無くなった検索対象 (取り外したドライブなど) は選択から外す
    React.useEffect(() => {
        if (roots.length === 0) return;
        useCleanupStore.getState().pruneRoots(roots.map(root => root.path));
    }, [roots]);

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
                if (event.kind === 'scan' && event.scan) {
                    return {
                        ...previous,
                        visitedDirs: event.scan.visitedDirs,
                        foundCount: event.scan.foundCount,
                        workers: event.scan.workers,
                    };
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

    // 進捗ダイアログの「詳細」に出す、走査スレッドごとの現在位置。
    // 行の位置はスレッド番号で固定し、走査していないスレッドは空欄にせず待機中と出す
    const scanDetailLines = (job?.workers ?? []).map(
        (dir, index) => `#${index + 1}  ${dir ?? t('cleanupPage.threadIdle')}`
    );

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

    // 検索対象は「ユーザープロファイル」「ボリューム」「カスタム」の 3 つに分けて表示する
    const homeRoots = roots.filter(root => root.kind === 'home');
    const driveRoots = roots.filter(root => root.kind === 'drive');
    const customRoots = roots.filter(root => root.kind === 'custom');

    // 個々の検索対象の行
    const renderRootRow = (root: CleanupRoot, indent = false) => (
        <Box key={root.id} sx={{ display: 'flex', alignItems: 'center', ml: indent ? CHILD_INDENT : 0 }}>
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
                    <IconButton size='small' onClick={() => void removeDirectory(root.path)} sx={{ ml: 0.5 }}>
                        <DeleteIcon fontSize='small' />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );

    // 配下をまとめて切り替えるグループの行
    const renderGroupRow = (label: string, paths: string[]) => {
        const selectedCount = paths.filter(path => store.selectedRoots.includes(path)).length;
        const allSelected = paths.length > 0 && selectedCount === paths.length;
        return (
            <FormControlLabel
                sx={CHECKBOX_ROW_SX}
                control={
                    <Checkbox
                        size='small'
                        sx={CHECKBOX_SX}
                        disabled={paths.length === 0}
                        checked={allSelected}
                        indeterminate={selectedCount > 0 && !allSelected}
                        onChange={() =>
                            store.setAllRoots(
                                allSelected
                                    ? store.selectedRoots.filter(path => !paths.includes(path))
                                    : [...new Set([...store.selectedRoots, ...paths])]
                            )
                        }
                    />
                }
                label={label}
            />
        );
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
            showNotice('warning', t('cleanupPage.needTargets'));
            return;
        }
        if (store.selectedRoots.length === 0) {
            showNotice('warning', t('cleanupPage.needDirs'));
            return;
        }
        // 前回と条件が変わっていれば保存し、次回起動時に復元できるようにする
        const saved = settings.cleanup;
        if (
            !sameSelection(store.selectedTargets, saved.selectedTargets) ||
            !sameSelection(store.selectedRoots, saved.selectedRoots)
        ) {
            await update({
                cleanup: { selectedTargets: [...store.selectedTargets], selectedRoots: [...store.selectedRoots] },
            });
        }

        const jobId = crypto.randomUUID();
        setJob({ jobId, kind: 'scan', foundCount: 0, visitedDirs: 0, workers: [] });
        try {
            const scanResult = await window.kuraToolkit.cleanup.scan(jobId, {
                roots: store.selectedRoots,
                targets: store.selectedTargets,
            });
            store.setItems(await fetchScanItems(scanResult.count));
            if (!scanResult.cancelled && scanResult.count === 0) {
                // 一瞬で消える通知では見落とされるため、閉じるまで残るダイアログで伝える
                setNoneFoundOpen(true);
            }
        } catch (error) {
            // main 側の検索結果は検索を始めた時点で空になるため、一覧もそろえて空にする
            store.setItems([]);
            showNotice('warning', errorMessage(t, error));
        } finally {
            setJob(null);
        }
    };

    const runCleanup = async () => {
        setConfirmOpen(false);
        // 削除する項目は、main が持つ検索結果と同じ並びの位置で指定する (パスを送ると件数が多いときに重くなるため)
        const items = store.items;
        const selection = new Uint8Array(items.length);
        items.forEach((item, index) => {
            if (store.checked.has(item.path)) selection[index] = 1;
        });
        const jobId = crypto.randomUUID();
        setJob({ jobId, kind: 'remove', foundCount: 0, visitedDirs: 0, workers: [] });
        try {
            const removeResult = await window.kuraToolkit.cleanup.remove(jobId, selection);
            setResult(removeResult);
            // 削除できた項目を一覧から取り除く (main の検索結果からも同じ位置の項目が取り除かれている)
            store.setItems(items.filter((_, index) => !removeResult.removed[index]));
        } catch (error) {
            showNotice('warning', errorMessage(t, error));
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
                                        store.selectedTargets.length === availableTargets.length ? [] : availableTargets
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

                {/* 検索対象ディレクトリ。ボリュームとカスタムはまとめて切り替えられるようにする */}
                <Box sx={{ flex: 1 }}>
                    <SectionLabel>{t('cleanupPage.dirs')}</SectionLabel>
                    <Panel>
                        {homeRoots.map(root => renderRootRow(root))}

                        {driveRoots.length > 0 && (
                            <>
                                {renderGroupRow(
                                    t('cleanupPage.volumes'),
                                    driveRoots.map(root => root.path)
                                )}
                                {driveRoots.map(root => renderRootRow(root, true))}
                            </>
                        )}

                        {renderGroupRow(
                            t('cleanupPage.custom'),
                            customRoots.map(root => root.path)
                        )}
                        {customRoots.map(root => renderRootRow(root, true))}
                        <Button
                            size='small'
                            fullWidth
                            variant='outlined'
                            sx={{ mt: 1, ml: CHILD_INDENT, width: `calc(100% - ${CHILD_INDENT * 8}px)` }}
                            onClick={addDirectory}
                        >
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
                {/* 数十万件になることがあるため、見えている行だけを描く。パスは 1 行に収め、収まらない分は省略して
                    マウスを重ねたときに全体を出す */}
                <Panel disablePadding sx={{ flexGrow: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
                    <VirtualList
                        count={store.items.length}
                        rowHeight={RESULT_ROW_HEIGHT}
                        sx={{ flexGrow: 1, py: 0.5 }}
                        renderRow={index => {
                            const item = store.items[index];
                            return (
                                <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', px: 1, gap: 0.5 }}>
                                    <Checkbox
                                        size='small'
                                        sx={CHECKBOX_SX}
                                        checked={store.checked.has(item.path)}
                                        onChange={() => store.toggleChecked(item.path)}
                                    />
                                    <Typography variant='body2' noWrap title={item.path} sx={{ minWidth: 0 }}>
                                        {item.path}
                                    </Typography>
                                </Box>
                            );
                        }}
                    />
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
                        if (store.checked.size === 0) {
                            showNotice('warning', t('cleanupPage.needChecked'));
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
                // 検索は総ディレクトリ数が事前に分からず完了予測できないため、進捗バーを出さずに件数だけ見せる
                showProgressBar={job?.kind !== 'scan'}
                current={job?.current}
                total={job?.total}
                status={
                    job?.kind === 'scan'
                        ? `${t('cleanupPage.scannedDirs', { count: job.visitedDirs })} / ${t('cleanupPage.foundCount', { count: job.foundCount })}`
                        : undefined
                }
                message={job?.kind === 'scan' ? undefined : (job?.message ?? '')}
                messageLines={2}
                details={job?.kind === 'scan' ? scanDetailLines : undefined}
                onCancel={() => {
                    if (job) void window.kuraToolkit.jobs.cancel(job.jobId);
                }}
            />

            {/* 検索したが対象が無かった場合 */}
            <AppDialog open={noneFoundOpen} onClose={() => setNoneFoundOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('cleanupPage.searchResultTitle')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('cleanupPage.noneFound')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNoneFoundOpen(false)}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>

            {/* 削除確認 */}
            <AppDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('cleanupPage.confirmTitle')}</DialogTitle>
                <DialogContent>
                    <Typography>{t('cleanupPage.confirmMessage', { count: store.checked.size })}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
                    <Button color='warning' variant='contained' onClick={runCleanup}>
                        {t('cleanupPage.cleanup')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {/* 結果 */}
            <AppDialog open={result !== null} onClose={() => setResult(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('common.done')}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>
                        {t('cleanupPage.resultSummary', {
                            ok: result?.deleted ?? 0,
                            failed: result?.failedCount ?? 0,
                        })}
                    </Typography>
                    {result && result.failedCount > 0 && (
                        <>
                            <Typography variant='body2' sx={{ mb: 0.5 }}>
                                {t('cleanupPage.failedItems')}
                            </Typography>
                            {result.failed.map(item => (
                                <Typography
                                    key={item.path}
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ wordBreak: 'break-all' }}
                                >
                                    {item.path} ({item.error})
                                </Typography>
                            ))}
                            {/* 理由まで受け取るのは先頭の一部だけなので、残りは件数で伝える */}
                            {result.failedCount > result.failed.length && (
                                <Typography variant='body2' color='text.secondary'>
                                    {t('cleanupPage.moreFailedItems', {
                                        count: result.failedCount - result.failed.length,
                                    })}
                                </Typography>
                            )}
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
            </AppDialog>
        </PageContainer>
    );
}
