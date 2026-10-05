import React from 'react';
import {
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import SaveAsIcon from '@mui/icons-material/SaveAs';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { voiceErrorMessage } from './voiceErrors';
import { showNotice } from '../../stores/noticeStore';
import type { VoicePresetParams } from '@shared/ipc';
import type { PresetKind, PresetRecord } from '@shared/voice/types';

type Props<T extends VoicePresetParams> = {
    kind: PresetKind;
    // 一覧に出すプリセットの絞り込み (分離はアーキテクチャが同じものだけ)
    filter?(preset: PresetRecord<VoicePresetParams>): boolean;
    // 保存する内容 (現在の値)
    current(): T;
    onApply(params: T): void;
    disabled?: boolean;
};

type NameDialog = { mode: 'new' | 'rename'; name: string } | null;
// 確認ダイアログの内容。閉じる間も表示が変わらないよう、開閉とは別に持つ
type Confirm = { action: 'overwrite' | 'delete'; name: string; open: boolean };

// パラメーターのプリセットの保存・呼び出し・名前変更・削除。
// アプリに用意されたプリセットは上書き・名前変更・削除ができない (新しいプリセットとしての保存はできる)
export default function PresetBar<T extends VoicePresetParams>({ kind, filter, current, onApply, disabled }: Props<T>) {
    const { t } = useTranslation();
    const [presets, setPresets] = React.useState<PresetRecord<VoicePresetParams>[]>([]);
    const [selectedId, setSelectedId] = React.useState('');
    const [nameDialog, setNameDialog] = React.useState<NameDialog>(null);
    const [confirm, setConfirm] = React.useState<Confirm>({ action: 'overwrite', name: '', open: false });

    React.useEffect(() => {
        let cancelled = false;
        window.kuraToolkit.voice.presets
            .list(kind)
            .then(list => {
                if (!cancelled) setPresets(list);
            })
            .catch(error => {
                if (!cancelled) showNotice('error', voiceErrorMessage(t, error), 12000);
            });
        return () => {
            cancelled = true;
        };
    }, [kind, t]);

    const visible = filter ? presets.filter(filter) : presets;
    const selected = visible.find(preset => preset.id === selectedId) ?? null;
    const editable = !!selected && !selected.builtin;
    const label = (preset: PresetRecord<VoicePresetParams>) =>
        preset.name || (preset.nameKey ? t(preset.nameKey) : preset.id);
    // 変更できないプリセットを選んでいる場合は、操作の名前に理由を添える
    const actionTitle = (action: string) => (selected?.builtin ? t('voice.presets.locked', { action }) : action);
    const askConfirm = (action: Confirm['action']) => {
        if (selected) setConfirm({ action, name: label(selected), open: true });
    };
    const closeConfirm = () => setConfirm(previous => ({ ...previous, open: false }));

    // プリセットの保存などを行い、失敗した場合は理由を知らせる
    const update = async (task: () => Promise<PresetRecord<VoicePresetParams>[]>): Promise<boolean> => {
        try {
            setPresets(await task());
            return true;
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
            return false;
        }
    };

    const saveNew = async (name: string) => {
        try {
            const list = await window.kuraToolkit.voice.presets.save(kind, { name, params: current() });
            setPresets(list);
            setSelectedId(list[list.length - 1]?.id ?? '');
            showNotice('success', t('voice.presets.saved'));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const overwrite = async () => {
        if (!editable || !selected) return;
        const saved = await update(() =>
            window.kuraToolkit.voice.presets.save(kind, { id: selected.id, name: '', params: current() })
        );
        if (saved) showNotice('success', t('voice.presets.saved'));
    };

    const remove = async () => {
        if (!editable || !selected) return;
        if (await update(() => window.kuraToolkit.voice.presets.remove(kind, selected.id))) setSelectedId('');
    };

    return (
        <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
            <FormControl size='small' sx={{ flexGrow: 1, minWidth: 0 }} disabled={disabled}>
                <InputLabel id={`preset-${kind}`}>{t('voice.presets.label')}</InputLabel>
                <Select
                    labelId={`preset-${kind}`}
                    label={t('voice.presets.label')}
                    value={selected ? selected.id : ''}
                    onChange={event => {
                        const preset = visible.find(item => item.id === event.target.value);
                        setSelectedId(String(event.target.value));
                        if (preset) onApply(preset.params as T);
                    }}
                >
                    {visible.length === 0 && (
                        <MenuItem value='' disabled>
                            <Typography variant='body2' color='text.secondary'>
                                {t('voice.presets.none')}
                            </Typography>
                        </MenuItem>
                    )}
                    {visible.map(preset => (
                        <MenuItem key={preset.id} value={preset.id}>
                            {label(preset)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
            <Tooltip title={actionTitle(t('voice.presets.overwrite'))}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('voice.presets.overwrite')}
                        disabled={disabled || !editable}
                        onClick={() => askConfirm('overwrite')}
                    >
                        <SaveIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('voice.presets.saveNew')}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('voice.presets.saveNew')}
                        disabled={disabled}
                        onClick={() => setNameDialog({ mode: 'new', name: '' })}
                    >
                        <SaveAsIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={actionTitle(t('voice.presets.rename'))}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('voice.presets.rename')}
                        disabled={disabled || !editable}
                        onClick={() => selected && setNameDialog({ mode: 'rename', name: label(selected) })}
                    >
                        <DriveFileRenameOutlineIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={actionTitle(t('voice.presets.delete'))}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('voice.presets.delete')}
                        disabled={disabled || !editable}
                        onClick={() => askConfirm('delete')}
                    >
                        <DeleteOutlineIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>

            <AppDialog open={nameDialog !== null} onClose={() => setNameDialog(null)} maxWidth='xs' fullWidth>
                <DialogTitle>
                    {nameDialog?.mode === 'rename' ? t('voice.presets.rename') : t('voice.presets.saveNew')}
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        size='small'
                        sx={{ mt: 1 }}
                        label={t('voice.presets.name')}
                        value={nameDialog?.name ?? ''}
                        onChange={event =>
                            setNameDialog(previous => (previous ? { ...previous, name: event.target.value } : previous))
                        }
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNameDialog(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        disabled={!nameDialog?.name.trim()}
                        onClick={async () => {
                            if (!nameDialog) return;
                            const name = nameDialog.name.trim();
                            setNameDialog(null);
                            if (nameDialog.mode === 'new') await saveNew(name);
                            else if (editable && selected)
                                await update(() => window.kuraToolkit.voice.presets.rename(kind, selected.id, name));
                        }}
                    >
                        {t('voice.common.ok')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={confirm.open} onClose={closeConfirm} maxWidth='xs' fullWidth>
                <DialogTitle>
                    {confirm.action === 'overwrite' ? t('voice.presets.overwrite') : t('voice.presets.delete')}
                </DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t(
                            confirm.action === 'overwrite'
                                ? 'voice.presets.overwriteConfirm'
                                : 'voice.presets.deleteConfirm',
                            { name: confirm.name }
                        )}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeConfirm}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color={confirm.action === 'overwrite' ? 'warning' : 'error'}
                        onClick={() => {
                            closeConfirm();
                            if (confirm.action === 'overwrite') void overwrite();
                            else void remove();
                        }}
                    >
                        {confirm.action === 'overwrite' ? t('voice.presets.overwriteRun') : t('voice.presets.delete')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </Stack>
    );
}
