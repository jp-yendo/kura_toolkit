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
    FormControlLabel,
    IconButton,
    Link,
    Stack,
    Tab,
    Tabs,
    Tooltip,
    Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { useGuardedNavigate } from '../../stores/navigationGuard';
import AppDialog from '../common/AppDialog';
import ProgressDialog from '../common/ProgressDialog';
import SectionLabel from '../common/SectionLabel';
import LibraryItemTable from './LibraryItemTable';
import SeparatorModelSection from './SeparatorModelSection';
import {
    featureForItems,
    itemLabel,
    requirementRows,
    totalSize,
    VOICE_FEATURES,
    withPrerequisites,
} from './libraryItems';
import { formatBytes } from './voiceFormat';
import { voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { useRemainingTime } from '../../hooks/useRemainingTime';
import { showNotice } from '../../stores/noticeStore';
import { notifyVoiceLibraryChanged, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import type {
    LibraryDownloadResult,
    LibraryItem,
    LibraryProgress,
    LibraryStatus,
    SeparationCategory,
    VoiceFeatureId,
} from '@shared/voice/types';
import { FEATURE_REQUIREMENTS, requiredItems, SEPARATOR_MODEL_PREFIX } from '@shared/voice/requirements';

const VC_REDIST_URL = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';

// 音声機能のダウンロード (Python 本体・パッケージ一式・モデルの取得と削除)。
// アプリに 1 つだけ置き、各機能の画面・不足の案内・アプリ設定などから openVoiceLibrary() で呼び出す
export default function VoiceLibraryDialog() {
    const { t } = useTranslation();
    const navigate = useGuardedNavigate();
    const { open, select, focus, version, close } = useVoiceLibraryStore();
    const [status, setStatus] = React.useState<LibraryStatus | null>(null);
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [progress, setProgress] = React.useState<Record<string, LibraryProgress>>({});
    const [result, setResult] = React.useState<LibraryDownloadResult | null>(null);
    const [removeTargets, setRemoveTargets] = React.useState<string[] | null>(null);
    const [removePython, setRemovePython] = React.useState(false);
    // 開いた回数 (分離モデルの絞り込みを開くたびに初期状態に戻すために使う)
    const [openCount, setOpenCount] = React.useState(0);
    // 分離モデルの一覧を作れなかったときのエラー (自動では作り直さず、再試行を待つ)
    const [listError, setListError] = React.useState<string | null>(null);
    const [tab, setTab] = React.useState<VoiceFeatureId>(VOICE_FEATURES[0]);
    // タブごとのスクロール枠 (タブを切り替えても、それぞれのタブのスクロール位置を保つ)
    const panelRefs = React.useRef<Partial<Record<VoiceFeatureId, HTMLDivElement | null>>>({});
    const { job, run, cancel } = useJobRunner();
    // 全体の進み具合はダウンロードしたバイト数に比例するため、そこから残り時間を見積もる
    const remaining = useRemainingTime(job?.jobId ?? null, job?.percent);

    const refresh = React.useCallback(async () => {
        setStatus(await window.kuraToolkit.voice.library.getStatus());
    }, []);

    // 開くたびに、呼び出し元が指定した項目を選んだ状態にする
    React.useEffect(() => {
        if (!open) return;
        setSelected(new Set(select));
        setProgress({});
        setListError(null);
        setOpenCount(previous => previous + 1);
        // 呼び出し元が指定した機能 (指定が無ければ、選んだ項目を最も多く含む機能) を表示する
        setTab(focus ?? featureForItems(select));
        // 開き直したときは、すべてのタブを先頭から表示する
        Object.values(panelRefs.current).forEach(panel => panel?.scrollTo({ top: 0 }));
        void refresh();
    }, [open, select, focus, refresh]);

    // 他の場所で取得状況が変わった場合 (すぐに使えるモデルの取得など) も読み直す
    React.useEffect(() => {
        if (open) void refresh();
    }, [version, open, refresh]);

    // 分離モデルの一覧が無ければ作る (パッケージ一式の導入後。分離のタブを表示したときに裏で作り、操作は妨げない)
    const needsList =
        open &&
        tab === 'separation' &&
        listError === null &&
        !!status &&
        !status.separatorModelsListed &&
        status.items.find(item => item.id === 'component:separator')?.status === 'installed';
    React.useEffect(() => {
        if (!needsList) return;
        let cancelled = false;
        window.kuraToolkit.voice.library.ensureSeparatorModelList().then(
            next => {
                if (cancelled) return;
                setStatus(next);
                notifyVoiceLibraryChanged();
            },
            error => {
                if (!cancelled) setListError(voiceErrorMessage(t, error));
            }
        );
        return () => {
            cancelled = true;
        };
    }, [needsList, t]);

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

    const items = React.useMemo(() => status?.items ?? [], [status]);
    const byId = React.useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
    const platform = status?.platform;

    // 選択の切り替えは同じ関数を渡し続け、変わった行だけを描き直す
    const toggle = React.useCallback(
        (id: string) =>
            setSelected(previous => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            }),
        []
    );
    const selectMany = React.useCallback(
        (ids: string[], on: boolean) =>
            setSelected(previous => {
                const next = new Set(previous);
                ids.forEach(id => (on ? next.add(id) : next.delete(id)));
                return next;
            }),
        []
    );

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

    const isInstalled = (id: string) => byId.get(id)?.status === 'installed';
    // 全タブの中身を描くため、表の行はタブごとに求めておく
    const groupRowsByFeature = React.useMemo(
        () =>
            Object.fromEntries(
                VOICE_FEATURES.map(feature => [
                    feature,
                    FEATURE_REQUIREMENTS[feature].map(group =>
                        group.itemPrefix === SEPARATOR_MODEL_PREFIX ? [] : requirementRows(group, items)
                    ),
                ])
            ) as Record<VoiceFeatureId, ReturnType<typeof requirementRows>[]>,
        [items]
    );
    // 呼び出し元が分離モデルを選んで開いた場合は、その種類のモデルを表示する
    const initialSeparatorCategory = React.useMemo(() => {
        const categories = new Set(
            select.map(id => byId.get(id)?.separator?.category).filter((value): value is SeparationCategory => !!value)
        );
        return categories.size === 1 ? [...categories][0] : 'vocals';
    }, [select, byId]);

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
    const askRemove = React.useCallback((ids: string[]) => {
        setRemovePython(false);
        setRemoveTargets(ids);
    }, []);

    const closeDialog = () => {
        if (job) return;
        close();
    };

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
                {/* 実行環境と機能のタブは、一覧をスクロールしても動かないよう本体の外に置く */}
                {status && platform && (
                    <Box sx={{ px: 3 }}>
                        <Stack
                            direction='row'
                            sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.25 }}
                        >
                            <Typography variant='caption' color='text.secondary'>
                                {platform.gpu.kind === 'cuda'
                                    ? t('voice.platform.cuda', { name: platform.gpu.name ?? '' })
                                    : platform.gpu.kind === 'mps'
                                      ? t('voice.platform.mps')
                                      : t('voice.platform.cpu')}
                            </Typography>
                            <Typography variant='caption' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                                {t('voice.library.libraryDir')}: {platform.libraryDir}
                            </Typography>
                            <Typography variant='caption' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                                {t('voice.library.modelDir')}: {platform.modelDir}
                            </Typography>
                            <Link
                                component='button'
                                variant='caption'
                                onClick={() => {
                                    close();
                                    navigate('/settings');
                                }}
                            >
                                {t('voice.library.changeInSettings')}
                            </Link>
                            <Tooltip title={t('voice.library.redetect')}>
                                <IconButton
                                    size='small'
                                    aria-label={t('voice.library.redetect')}
                                    onClick={async () =>
                                        setStatus(await window.kuraToolkit.voice.library.refreshPlatform())
                                    }
                                >
                                    <RefreshIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                        <Tabs
                            value={tab}
                            onChange={(_event, value: VoiceFeatureId) => setTab(value)}
                            variant='scrollable'
                            scrollButtons='auto'
                        >
                            {VOICE_FEATURES.map(feature => (
                                <Tab
                                    key={feature}
                                    value={feature}
                                    id={`voice-library-tab-${feature}`}
                                    aria-controls={`voice-library-panel-${feature}`}
                                    label={t(`voice.features.${feature}`)}
                                    icon={
                                        requiredItems(feature).every(isInstalled) ? (
                                            <CheckCircleIcon fontSize='small' color='success' />
                                        ) : undefined
                                    }
                                    iconPosition='end'
                                    sx={{ minHeight: 48 }}
                                />
                            ))}
                        </Tabs>
                    </Box>
                )}
                {/* タブごとにスクロール枠を持たせ、全タブを同じ場所に重ねて描く。表示中でないタブは見えなくするだけにする
                    (display: none にするとスクロール位置が失われるため)。見えないタブは操作も読み上げもさせない (inert) */}
                <DialogContent
                    dividers
                    sx={{
                        p: 0,
                        minHeight: 0,
                        overflow: 'hidden',
                        display: 'grid',
                        gridTemplate: 'minmax(0, 1fr) / minmax(0, 1fr)',
                    }}
                >
                    {status &&
                        platform &&
                        VOICE_FEATURES.map(feature => {
                            const active = feature === tab;
                            const missingRequired = requiredItems(feature).filter(id => !isInstalled(id));
                            return (
                                <Box
                                    key={feature}
                                    ref={(element: HTMLDivElement | null) => {
                                        panelRefs.current[feature] = element;
                                    }}
                                    role='tabpanel'
                                    id={`voice-library-panel-${feature}`}
                                    aria-labelledby={`voice-library-tab-${feature}`}
                                    inert={!active}
                                    sx={{
                                        gridArea: '1 / 1',
                                        overflowY: 'auto',
                                        px: 3,
                                        py: 2,
                                        visibility: active ? 'visible' : 'hidden',
                                    }}
                                >
                                    <Stack spacing={2}>
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
                                                        onClick={() =>
                                                            void window.kuraToolkit.voice.openExternal(VC_REDIST_URL)
                                                        }
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

                                        {feature === 'ttsTraining' && !platform.ttsTrainingAvailable ? (
                                            <Alert severity='info'>{t('voice.library.ttsTrainingUnavailable')}</Alert>
                                        ) : (
                                            missingRequired.length > 0 && (
                                                <Alert
                                                    severity='info'
                                                    action={
                                                        <Button
                                                            color='inherit'
                                                            size='small'
                                                            onClick={() => selectMany(missingRequired, true)}
                                                        >
                                                            {t('voice.library.selectMissing')}
                                                        </Button>
                                                    }
                                                >
                                                    {t('voice.library.missingRequired', {
                                                        feature: t(`voice.features.${feature}`),
                                                        count: missingRequired.length,
                                                    })}
                                                </Alert>
                                            )
                                        )}

                                        {FEATURE_REQUIREMENTS[feature].map((group, index) => (
                                            <Box key={group.titleKey}>
                                                <SectionLabel>
                                                    {t('voice.library.groupTitle', {
                                                        name: t(group.titleKey),
                                                        kind: t(`voice.library.requirementKinds.${group.kind}`),
                                                    })}
                                                </SectionLabel>
                                                {group.noteKey && (
                                                    <Typography
                                                        variant='body2'
                                                        color='text.secondary'
                                                        sx={{ mb: 1, lineHeight: 1.6 }}
                                                    >
                                                        {t(group.noteKey)}
                                                    </Typography>
                                                )}
                                                {group.itemPrefix === SEPARATOR_MODEL_PREFIX ? (
                                                    <SeparatorModelSection
                                                        key={openCount}
                                                        group={group}
                                                        status={status}
                                                        items={items}
                                                        initialCategory={initialSeparatorCategory}
                                                        selected={selected}
                                                        toggle={toggle}
                                                        selectMany={selectMany}
                                                        onRemove={askRemove}
                                                        progress={progress}
                                                        listError={listError}
                                                        onRetryList={() => setListError(null)}
                                                    />
                                                ) : (
                                                    <LibraryItemTable
                                                        rows={groupRowsByFeature[feature][index]}
                                                        selected={selected}
                                                        toggle={toggle}
                                                        onRemove={askRemove}
                                                        progress={progress}
                                                    />
                                                )}
                                            </Box>
                                        ))}
                                    </Stack>
                                </Box>
                            );
                        })}
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
                remaining={remaining}
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
