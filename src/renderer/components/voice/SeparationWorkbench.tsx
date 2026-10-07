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
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import Panel from '../common/Panel';
import ProgressDialog from '../common/ProgressDialog';
import SeparationDialog from './SeparationDialog';
import { EMPTY_METHOD_SELECTION, type MethodSelection } from './SeparationMethodPicker';
import { separatorDisplayName } from './separatorModelNotes';
import SyncPlayer from './SyncPlayer';
import { filterSummary } from './AudioFilterFields';
import {
    childrenOf,
    descendantsOf,
    nextNumber,
    outputKey,
    outputLabel,
    SOURCE_KEY,
    treeOutputs,
    type SepNode,
} from './separationTree';
import { isCancelledError, missingItemsFromError, voiceErrorMessage } from './voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { openVoiceLibrary, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import { DEFAULT_SEPARATION_PARAMS, type SeparationWorkStore } from '../../stores/separationWorkStore';
import type {
    SeparationArch,
    SeparationCandidate,
    SeparationMethod,
    SeparationModelList,
    SeparationParams,
} from '@shared/voice/types';

const ARCH_KEYS: Record<SeparationArch, keyof SeparationParams> = {
    MDX: 'mdx',
    VR: 'vr',
    Demucs: 'demucs',
    MDXC: 'mdxc',
};

// 1 段の字下げ (MUI の spacing の単位)
const INDENT = 3;
// 保存対象の列の幅
const SAVE_COLUMN_WIDTH = 56;

type Props = {
    store: SeparationWorkStore;
    disabled?: boolean;
    // 「保存対象」の列を出す (音声分離の画面。書き出す音を選ぶ)
    saveColumn?: boolean;
};

// 分離のダイアログの対象 (新しく分離する音、または作り直す結果)
type DialogTarget =
    | { kind: 'new'; parentKey: string; selection: MethodSelection; params: SeparationParams }
    | { kind: 'redo'; node: SepNode };

// 消える結果の確認 (削除・作り直し)。閉じる間も表示が変わらないよう、開いた時点の内容を持つ
type RemoveConfirm = { kind: 'remove' | 'redo'; node: SepNode; outputs: string[]; open: boolean };

// 分離の操作部。音声分離の画面と、音声変換の画面 (入力と分離) で共用する。
// 元の音源を根にした木の形で、分離した結果をその音の下に字下げして並べる。どの音からも「分岐」で
// 何度でも分離でき (同じ音から分離した結果どうしを聞き比べられる)、結果は「パラメーターを変えて作成」で作り直せる
export default function SeparationWorkbench({ store, disabled, saveColumn }: Props) {
    const { t } = useTranslation();
    const libraryVersion = useVoiceLibraryStore(state => state.version);
    const {
        workKey,
        source,
        nodes,
        saveTargets,
        params,
        addNode,
        replaceNode,
        removeNode,
        removeDescendants,
        setLabel,
        setSaveTarget,
        setParams,
    } = store();
    const [models, setModels] = React.useState<SeparationModelList | null>(null);
    const [modelError, setModelError] = React.useState<string | null>(null);
    const [dialog, setDialog] = React.useState<DialogTarget | null>(null);
    // 前回、新しく分離したときの方式 (次に開くときの初期値)
    const [lastSelection, setLastSelection] = React.useState<MethodSelection>(EMPTY_METHOD_SELECTION);
    const [removeConfirm, setRemoveConfirm] = React.useState<RemoveConfirm | null>(null);
    // 出力の名前の変更 (結果・出力の名前と、入力中の名前)
    const [renaming, setRenaming] = React.useState<{ nodeId: string; stemName: string; label: string } | null>(null);
    const { job, run, cancel } = useJobRunner();

    // 一覧の読み込みの順番 (後から頼んだ読み込みの結果だけを使う)
    const modelsRequestRef = React.useRef(0);
    const loadModels = React.useCallback(async () => {
        const request = ++modelsRequestRef.current;
        try {
            const list = await window.kuraToolkit.voice.separation.listModels();
            if (request !== modelsRequestRef.current) return;
            setModels(list);
            setModelError(null);
        } catch (error) {
            if (request !== modelsRequestRef.current) return;
            // 前の一覧のまま、使えなくなったモデルを示さないよう空にする
            setModels(null);
            setModelError(voiceErrorMessage(t, error));
        }
    }, [t]);

    // ダウンロードでモデルの取得状況が変わったら読み直す
    React.useEffect(() => {
        void loadModels();
    }, [loadModels, libraryVersion]);

    const outputs = React.useMemo(() => treeOutputs(nodes), [nodes]);

    if (!source) return null;
    const busy = disabled || job !== null;
    const sourceLabel = t('voice.tracks.source');

    // 音の名前 (元の音源、または出力の番号-名前)
    const labelOf = (key: string) => outputs.find(output => output.key === key)?.label ?? sourceLabel;

    // 結果の名前 (一覧と同じ表示名。組み合わせはモデル名と結果の決め方)
    const modelName = (filename: string) => {
        const model = models?.models.find(item => item.filename === filename);
        return model ? separatorDisplayName(model.name) : filename;
    };
    const resultLabel = (result: SeparationCandidate) => {
        const method = result.method;
        if (method.kind === 'model') return modelName(method.filename);
        if (method.kind === 'ensemble') {
            return `${method.filenames.map(modelName).join(' + ')} (${t(`voice.separation.algorithms.${method.algorithm}`)})`;
        }
        if (method.kind === 'process') return t('voice.separation.pickModes.other');
        return result.methodLabel;
    };

    // パラメーターの値の表示 (未指定はモデルの既定、オン・オフは言葉で示す)
    const paramValue = (value: unknown) => {
        if (value === null) return t('voice.separation.params.modelDefault');
        if (typeof value === 'boolean') return value ? t('voice.common.on') : t('voice.common.off');
        return String(value);
    };
    const archName = (key: string) =>
        (Object.keys(ARCH_KEYS) as SeparationArch[]).find(arch => ARCH_KEYS[arch] === key) ?? key;
    // 結果に添えるパラメーター。既定から変えた値だけを示す (結果どうしの違いを読み取りやすくするため)
    const paramsSummary = (result: SeparationCandidate) => {
        // 「その他」は、チェックした加工を示す
        if (result.method.kind === 'process') {
            const names = (models?.models ?? []).map(model => ({ filename: model.filename, name: model.name }));
            return filterSummary(t, result.method, names).join(' / ');
        }
        const parts = Object.entries(result.params).flatMap(([key, values]) => {
            const defaults = DEFAULT_SEPARATION_PARAMS[key as keyof SeparationParams] as unknown as Record<
                string,
                unknown
            >;
            const changed = Object.entries(values as Record<string, unknown>).filter(
                ([name, value]) => defaults?.[name] !== value
            );
            if (changed.length === 0) return [];
            return [
                `${archName(key)}: ${changed
                    .map(([name, value]) => `${t(`voice.separation.params.${name}`)}=${paramValue(value)}`)
                    .join(', ')}`,
            ];
        });
        return parts.length > 0 ? parts.join(' / ') : t('voice.separation.defaultParams');
    };

    // 結果の出力のファイルを消す
    const discard = (removed: SepNode[]) => {
        const paths = removed.flatMap(node => node.result.stems.map(stem => stem.media.path));
        if (paths.length > 0) void window.kuraToolkit.voice.media.discard(workKey, paths);
    };

    // 結果と、その下にある結果の出力 (消えるものの一覧に示す。書き出しのファイル名と同じ名前)
    const outputsOf = (removed: SepNode[]) =>
        outputs.filter(output => removed.includes(output.node)).map(output => output.path);

    // 分離する。作り直しでは、実行した時点で下にある結果を消す (失敗・中止のときは、その結果自体は前のまま残る)
    const runSeparation = async (
        target: DialogTarget,
        selection: MethodSelection,
        method: SeparationMethod,
        nextParams: SeparationParams
    ): Promise<boolean> => {
        setParams(nextParams);
        const parentKey = target.kind === 'new' ? target.parentKey : target.node.parentKey;
        const input =
            parentKey === SOURCE_KEY ? source.media.path : outputs.find(output => output.key === parentKey)?.mediaPath;
        if (!input) return false;
        if (target.kind === 'redo') discard(removeDescendants(target.node.id));
        try {
            const result = await run(t('voice.separation.running'), jobId =>
                window.kuraToolkit.voice.separation.run(jobId, {
                    workKey,
                    input,
                    channels: source.channels,
                    method,
                    params: nextParams,
                })
            );
            if (target.kind === 'redo') {
                replaceNode({ ...target.node, result, selection, params: nextParams });
                discard([target.node]);
            } else {
                setLastSelection(selection);
                addNode({
                    id: crypto.randomUUID(),
                    parentKey,
                    number: nextNumber(nodes, parentKey),
                    result,
                    selection,
                    params: nextParams,
                    labels: {},
                });
            }
            return true;
        } catch (error) {
            if (isCancelledError(error)) {
                showNotice('warning', t('voice.common.cancelled'));
                return false;
            }
            const missing = missingItemsFromError(error);
            showNotice('error', voiceErrorMessage(t, error), 10000);
            if (missing.length > 0) openVoiceLibrary({ select: missing, focus: 'separation' });
            return false;
        }
    };

    const openNew = (parentKey: string) => setDialog({ kind: 'new', parentKey, selection: lastSelection, params });

    // 作り直し: 下に結果があれば、消えるものを示して了承をもらってからダイアログを開く
    const askRedo = (node: SepNode) => {
        const below = descendantsOf(nodes, node.id);
        if (below.length === 0) setDialog({ kind: 'redo', node });
        else setRemoveConfirm({ kind: 'redo', node, outputs: outputsOf(below), open: true });
    };

    // 削除: 結果と、その下にある結果を消す。下に結果があるときは、消えるものを示して確認する
    const askRemove = (node: SepNode) => {
        const below = descendantsOf(nodes, node.id);
        if (below.length === 0) discard(removeNode(node.id));
        else setRemoveConfirm({ kind: 'remove', node, outputs: outputsOf([node, ...below]), open: true });
    };

    const closeRemoveConfirm = () => setRemoveConfirm(previous => (previous ? { ...previous, open: false } : null));
    const acceptRemoveConfirm = () => {
        if (!removeConfirm) return;
        closeRemoveConfirm();
        if (removeConfirm.kind === 'remove') discard(removeNode(removeConfirm.node.id));
        else setDialog({ kind: 'redo', node: removeConfirm.node });
    };

    const applyRename = () => {
        if (!renaming) return;
        setLabel(renaming.nodeId, renaming.stemName, renaming.label.trim() || null);
        setRenaming(null);
    };

    // 1 行の並び: 字下げした名前・プレーヤー・分岐 | 保存対象
    const rowSx = {
        display: 'grid',
        gridTemplateColumns: saveColumn ? `minmax(0, 1fr) ${SAVE_COLUMN_WIDTH}px` : 'minmax(0, 1fr)',
        alignItems: 'center',
        columnGap: 1,
    } as const;
    const cellSx = (depth: number) =>
        ({
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '160px minmax(0, 1fr) auto' },
            alignItems: 'center',
            gap: 1.5,
            pl: depth * INDENT,
            minWidth: 0,
        }) as const;

    const separateButton = (key: string, label: string) => (
        <Button
            size='small'
            startIcon={<CallSplitIcon />}
            disabled={busy}
            onClick={() => openNew(key)}
            aria-label={t('voice.separation.separateFromFor', { name: label })}
            sx={{ whiteSpace: 'nowrap' }}
        >
            {t('voice.separation.separateFrom')}
        </Button>
    );

    // ある音から分離した結果 (見出しと出力)。出力から分離した結果は、さらに字下げしてその出力の下に置く
    const renderChildren = (parentKey: string, depth: number): React.ReactNode =>
        childrenOf(nodes, parentKey).map(node => {
            const summary = paramsSummary(node.result);
            return (
                <Stack key={node.id} spacing={1}>
                    <Box sx={{ ...rowSx }}>
                        <Stack
                            direction='row'
                            spacing={1}
                            sx={{ alignItems: 'center', pl: depth * INDENT, minWidth: 0 }}
                        >
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                <Typography variant='body2' sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                                    {resultLabel(node.result)}
                                </Typography>
                                {summary && (
                                    <Typography
                                        variant='caption'
                                        color='text.secondary'
                                        sx={{ display: 'block', lineHeight: 1.5 }}
                                    >
                                        {summary}
                                    </Typography>
                                )}
                            </Box>
                            <Button
                                size='small'
                                disabled={busy}
                                onClick={() => askRedo(node)}
                                sx={{ whiteSpace: 'nowrap' }}
                            >
                                {t('voice.separation.recreate')}
                            </Button>
                            <Tooltip title={t('voice.separation.deleteResult')}>
                                <span>
                                    <IconButton
                                        size='small'
                                        aria-label={t('voice.separation.deleteResult')}
                                        disabled={busy}
                                        onClick={() => askRemove(node)}
                                    >
                                        <DeleteOutlineIcon fontSize='small' />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Stack>
                    </Box>
                    {node.result.stems.map(stem => {
                        const key = outputKey(node.id, stem.name);
                        const label = outputLabel(node, stem.name);
                        return (
                            <Stack key={key} spacing={1}>
                                <Box sx={rowSx}>
                                    <Box sx={cellSx(depth)}>
                                        <Stack
                                            direction='row'
                                            spacing={0.25}
                                            sx={{ alignItems: 'center', minWidth: 0 }}
                                        >
                                            <Typography
                                                variant='body2'
                                                sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                                            >
                                                {label}
                                            </Typography>
                                            <Tooltip title={t('voice.separation.rename')}>
                                                <span>
                                                    <IconButton
                                                        size='small'
                                                        aria-label={t('voice.separation.renameFor', { name: label })}
                                                        disabled={busy}
                                                        onClick={() =>
                                                            setRenaming({
                                                                nodeId: node.id,
                                                                stemName: stem.name,
                                                                label: node.labels[stem.name] ?? stem.name,
                                                            })
                                                        }
                                                    >
                                                        <EditOutlinedIcon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Stack>
                                        <SyncPlayer source={{ key, url: stem.media.url }} />
                                        {separateButton(key, label)}
                                    </Box>
                                    {saveColumn && (
                                        // チェックの下に「対象」を置く 2 行の形 (行ごとに同じ位置に並べ、列として見せる)
                                        <FormControlLabel
                                            labelPlacement='bottom'
                                            sx={{ m: 0, justifySelf: 'center' }}
                                            control={
                                                <Checkbox
                                                    size='small'
                                                    checked={saveTargets.includes(key)}
                                                    onChange={(_event, checked) => setSaveTarget(key, checked)}
                                                    sx={{ p: 0.5 }}
                                                    slotProps={{
                                                        input: {
                                                            'aria-label': t('voice.separation.saveTargetFor', {
                                                                name: label,
                                                            }),
                                                        },
                                                    }}
                                                />
                                            }
                                            label={
                                                <Typography variant='caption' color='text.secondary'>
                                                    {t('voice.separation.saveColumn')}
                                                </Typography>
                                            }
                                        />
                                    )}
                                </Box>
                                {renderChildren(key, depth + 1)}
                            </Stack>
                        );
                    })}
                </Stack>
            );
        });

    const dialogParentKey = dialog ? (dialog.kind === 'new' ? dialog.parentKey : dialog.node.parentKey) : SOURCE_KEY;

    return (
        <Stack spacing={2}>
            {modelError && (
                <Alert
                    severity='warning'
                    action={
                        <Button color='inherit' size='small' onClick={() => void loadModels()}>
                            {t('voice.common.retry')}
                        </Button>
                    }
                >
                    {modelError}
                </Alert>
            )}

            <Panel>
                <Stack spacing={1.5}>
                    <Box sx={rowSx}>
                        <Box sx={cellSx(0)}>
                            <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                {sourceLabel}
                            </Typography>
                            <SyncPlayer source={{ key: `source-${workKey}`, url: source.media.url }} />
                            {separateButton(SOURCE_KEY, sourceLabel)}
                        </Box>
                        {saveColumn && <Box />}
                    </Box>
                    {nodes.length === 0 && (
                        <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                            {t('voice.separation.noResults')}
                        </Typography>
                    )}
                    {renderChildren(SOURCE_KEY, 1)}
                </Stack>
            </Panel>

            <SeparationDialog
                open={dialog !== null && job === null}
                inputLabel={labelOf(dialogParentKey)}
                models={models}
                initialSelection={
                    dialog ? (dialog.kind === 'new' ? dialog.selection : dialog.node.selection) : EMPTY_METHOD_SELECTION
                }
                initialParams={dialog ? (dialog.kind === 'new' ? dialog.params : dialog.node.params) : params}
                onRun={(selection, method, nextParams) =>
                    dialog ? runSeparation(dialog, selection, method, nextParams) : Promise.resolve(false)
                }
                onClose={() => setDialog(null)}
                disabled={disabled}
            />

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                status={job?.status}
                message={job?.message ?? ''}
                onCancel={cancel}
            />

            <AppDialog open={!!removeConfirm?.open} onClose={closeRemoveConfirm} maxWidth='sm' fullWidth>
                <DialogTitle>
                    {removeConfirm?.kind === 'redo'
                        ? t('voice.separation.recreate')
                        : t('voice.separation.deleteResult')}
                </DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {removeConfirm?.kind === 'redo'
                            ? t('voice.separation.recreateMessage')
                            : t('voice.separation.removeMessage')}
                    </Typography>
                    <Box component='ul' sx={{ my: 1, pl: 3 }}>
                        {removeConfirm?.outputs.map(name => (
                            <Typography key={name} component='li' variant='body2' sx={{ overflowWrap: 'anywhere' }}>
                                {name}
                            </Typography>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeRemoveConfirm}>{t('common.cancel')}</Button>
                    <Button variant='contained' color='warning' onClick={acceptRemoveConfirm}>
                        {removeConfirm?.kind === 'redo' ? t('voice.common.ok') : t('voice.common.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={renaming !== null} onClose={() => setRenaming(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.separation.rename')}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        size='small'
                        sx={{ mt: 1 }}
                        label={t('voice.separation.trackName')}
                        value={renaming?.label ?? ''}
                        onChange={event =>
                            setRenaming(previous => (previous ? { ...previous, label: event.target.value } : previous))
                        }
                        onKeyDown={event => {
                            if (event.key === 'Enter') applyRename();
                        }}
                        helperText={renaming ? t('voice.separation.trackNameHint', { name: renaming.stemName }) : ' '}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
                    <Button variant='contained' onClick={applyRename}>
                        {t('voice.common.ok')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </Stack>
    );
}
