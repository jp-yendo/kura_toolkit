import React from 'react';
import {
    Alert,
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Menu,
    MenuItem,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import AppDialog from '../common/AppDialog';
import Panel from '../common/Panel';
import ProgressDialog from '../common/ProgressDialog';
import SectionLabel from '../common/SectionLabel';
import { parseVoiceError, voiceErrorMessage } from '../voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { notifyVoiceLibraryChanged, openVoiceLibrary } from '../../stores/voiceLibraryStore';
import type { StorageInfo, StorageKind } from '@shared/types';

// アプリ全体の保存場所 (ライブラリ・モデル・作業ディレクトリ)。3 つはそれぞれ独立して変更する。
// ライブラリとモデルは、中身を選んだフォルダへ移動する。作業ディレクトリは一時ファイルの置き場のため移動しない。
// 既定の場所へ戻す操作は、誤って押さないよう各項目のメニューに置く

type MovableKind = Exclude<StorageKind, 'work'>;
// target が null の場合は既定の場所へ戻す
type MoveRequest = { kind: MovableKind; target: string | null };

const KINDS: StorageKind[] = ['library', 'model', 'work'];

function storageErrorMessage(t: TFunction, error: unknown): string {
    const parsed = parseVoiceError(error);
    const key = `settingsPage.storage.errors.${parsed.code}`;
    if (parsed.code && i18n.exists(key)) return t(key, { detail: parsed.detail });
    return voiceErrorMessage(t, error);
}

function parentPath(target: string): string {
    const index = Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'));
    return index > 0 ? target.slice(0, index) : target;
}

export default function StorageSection() {
    const { t } = useTranslation();
    const [info, setInfo] = React.useState<StorageInfo | null>(null);
    const [request, setRequest] = React.useState<MoveRequest | null>(null);
    const [menu, setMenu] = React.useState<{ kind: StorageKind; anchor: HTMLElement } | null>(null);
    const { job, run, cancel } = useJobRunner();

    const refresh = React.useCallback(async () => {
        setInfo(await window.kuraToolkit.storage.getInfo());
    }, []);
    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    if (!info) return null;

    const label = (kind: StorageKind) => t(`settingsPage.storage.${kind}`);
    const isDefault = (kind: StorageKind) => info.dirs[kind] === info.defaults[kind];

    const move = async () => {
        if (!request) return;
        const { kind, target } = request;
        setRequest(null);
        try {
            const result = await run(t('settingsPage.storage.moving', { name: label(kind) }), jobId =>
                window.kuraToolkit.storage.move(jobId, kind, target)
            );
            await useSettingsStore.getState().reload();
            await refresh();
            notifyVoiceLibraryChanged();
            // 移動は終わったが元の場所を消せなかった場合は、残っている場所を知らせる
            const remains = result.remainingPath
                ? ` ${t('settingsPage.storage.previousRemains', { path: result.remainingPath })}`
                : '';
            if (result.cancelled) {
                showNotice('warning', t('settingsPage.storage.cancelled'));
            } else if (result.rebuildRequired.length > 0) {
                // 使えなくなったパッケージ一式を選んだ状態でダウンロードを開く (取り直しは利用者の確認を経る)
                showNotice('warning', `${t('settingsPage.storage.rebuildRequired')}${remains}`, 12000);
                openVoiceLibrary({ select: result.rebuildRequired, focus: 'runtime' });
            } else if (remains) {
                showNotice('warning', `${t('settingsPage.storage.moved', { name: label(kind) })}${remains}`, 12000);
            } else {
                showNotice('success', t('settingsPage.storage.moved', { name: label(kind) }));
            }
        } catch (error) {
            await refresh();
            showNotice('error', storageErrorMessage(t, error), 10000);
        }
    };

    const changeWorkDir = async (dir: string) => {
        try {
            setInfo(await window.kuraToolkit.storage.setWorkDir(dir));
            await useSettingsStore.getState().reload();
            showNotice('success', t('settingsPage.storage.workChanged'));
        } catch (error) {
            showNotice('error', storageErrorMessage(t, error), 10000);
        }
    };

    // 移動先を選べるかを先に確かめてから、確認画面を出す
    const askMove = async (kind: MovableKind, target: string | null) => {
        try {
            await window.kuraToolkit.storage.checkMove(kind, target);
            setRequest({ kind, target });
        } catch (error) {
            showNotice('error', storageErrorMessage(t, error), 10000);
        }
    };

    // 選んだフォルダをそのまま新しい場所にする (ライブラリとモデルは、中身をそのフォルダへ移す)
    const browse = async (kind: StorageKind) => {
        const current = info.dirs[kind];
        const dir = await window.kuraToolkit.dialog.openDirectory({
            defaultPath: kind === 'work' ? current : parentPath(current),
        });
        if (!dir) return;
        if (kind === 'work') {
            await changeWorkDir(dir);
        } else {
            await askMove(kind, dir);
        }
    };

    const resetToDefault = (kind: StorageKind) => {
        setMenu(null);
        if (kind === 'work') {
            void changeWorkDir('');
        } else {
            void askMove(kind, null);
        }
    };

    return (
        <Box>
            <SectionLabel>{t('settingsPage.storageSection')}</SectionLabel>
            <Panel>
                <Stack spacing={2.5}>
                    {KINDS.map(kind => (
                        <Box key={kind}>
                            <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                {label(kind)}
                            </Typography>
                            <Stack direction='row' spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
                                <Typography
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ flexGrow: 1, minWidth: 0, wordBreak: 'break-all' }}
                                >
                                    {info.dirs[kind]}
                                    {isDefault(kind) && ` (${t('settingsPage.storage.isDefault')})`}
                                </Typography>
                                <Button
                                    variant='outlined'
                                    size='small'
                                    sx={{ flexShrink: 0 }}
                                    startIcon={kind === 'work' ? <FolderOpenIcon /> : <DriveFileMoveIcon />}
                                    disabled={job !== null}
                                    onClick={() => void browse(kind)}
                                >
                                    {kind === 'work'
                                        ? t('settingsPage.storage.change')
                                        : t('settingsPage.storage.move')}
                                </Button>
                                {!isDefault(kind) && (
                                    <Tooltip title={t('settingsPage.storage.moreActions')}>
                                        <span>
                                            <IconButton
                                                size='small'
                                                aria-label={t('settingsPage.storage.moreActions')}
                                                disabled={job !== null}
                                                onClick={event => setMenu({ kind, anchor: event.currentTarget })}
                                            >
                                                <MoreVertIcon fontSize='small' />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                )}
                            </Stack>
                            <Typography
                                variant='caption'
                                color='text.secondary'
                                sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
                            >
                                {t(`settingsPage.storage.${kind}Hint`)}
                            </Typography>
                            {info.nonAscii[kind] && (
                                <Alert severity='warning' sx={{ mt: 1 }}>
                                    {t('settingsPage.storage.nonAscii')}
                                </Alert>
                            )}
                        </Box>
                    ))}
                </Stack>
            </Panel>

            <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
                <MenuItem onClick={() => menu && resetToDefault(menu.kind)}>
                    {t('settingsPage.storage.resetDefault')}
                </MenuItem>
            </Menu>

            <AppDialog open={request !== null} onClose={() => setRequest(null)} maxWidth='sm' fullWidth>
                <DialogTitle>
                    {request && t('settingsPage.storage.moveTitle', { name: label(request.kind) })}
                </DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6, mb: 1 }}>
                        {t('settingsPage.storage.moveMessage')}
                    </Typography>
                    {request && (
                        <Typography variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                            {info.dirs[request.kind]} → {request.target ?? info.defaults[request.kind]}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRequest(null)}>{t('common.cancel')}</Button>
                    <Button variant='contained' onClick={() => void move()}>
                        {t('settingsPage.storage.moveRun')}
                    </Button>
                </DialogActions>
            </AppDialog>
            <ProgressDialog open={job !== null} title={job?.title ?? ''} percent={job?.percent} onCancel={cancel} />
        </Box>
    );
}
