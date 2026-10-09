import React from 'react';
import {
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    ListSubheader,
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
import AppDialog from './AppDialog';
import { errorMessage } from './errorMessage';
import { showNotice } from '../../stores/noticeStore';
import type { PresetApi } from '@shared/ipc';
import type { PresetRecord } from '@shared/types';

type Props<T> = {
    // 欄のラベルを結び付ける ID (画面内で一意にする)
    id: string;
    // プリセットの一覧・保存・名前変更・削除 (毎回同じものを渡す。変わると一覧を読み直す)
    api: PresetApi<T>;
    // 一覧に出すプリセットの絞り込み
    filter?(preset: PresetRecord<T>): boolean;
    // 保存する内容 (現在の値)
    current(): T;
    onApply(params: T): void;
    disabled?: boolean;
    // エラーの翻訳を探す場所 (先頭から探す。プリセット共通の翻訳は常に最初に探す)
    errorKeyPrefixes?: string[];
    // 選択中のプリセットを呼び出し側で持つ場合に渡す (省略時はこの部品の中で持ち、初めは何も選んでいない)
    selectedId?: string;
    onSelectedIdChange?(id: string): void;
    // 選択中のプリセット (無ければ null) が変わったとき・その値が上書きされたときに呼ぶ (一覧を読み込んだ後だけ)
    onSelectedPresetChange?(preset: PresetRecord<T> | null): void;
};

type NameDialog = { mode: 'new' | 'rename'; name: string } | null;
// 確認ダイアログの内容。閉じる間も表示が変わらないよう、開閉とは別に持つ
type Confirm = { action: 'overwrite' | 'delete'; name: string; open: boolean };

// パラメーターのプリセットの保存・呼び出し・名前変更・削除。
// アプリが用意した標準のプリセットは上書き・名前変更・削除ができない (新しいプリセットとしての保存はできる)
export default function PresetBar<T>({
    id,
    api,
    filter,
    current,
    onApply,
    disabled,
    errorKeyPrefixes = [],
    selectedId: controlledId,
    onSelectedIdChange,
    onSelectedPresetChange,
}: Props<T>) {
    const { t } = useTranslation();
    const [presets, setPresets] = React.useState<PresetRecord<T>[]>([]);
    // 一覧を読み込んだか (読み込む前は選択中のプリセットが見つからないため、呼び出し側へ知らせない)
    const [loaded, setLoaded] = React.useState(false);
    const [ownSelectedId, setOwnSelectedId] = React.useState('');
    const selectedId = controlledId ?? ownSelectedId;
    const setSelectedId = (value: string) => {
        if (controlledId === undefined) setOwnSelectedId(value);
        onSelectedIdChange?.(value);
    };
    const [nameDialog, setNameDialog] = React.useState<NameDialog>(null);
    const [confirm, setConfirm] = React.useState<Confirm>({ action: 'overwrite', name: '', open: false });

    const failMessage = (error: unknown) => errorMessage(t, error, ['presets.errors', ...errorKeyPrefixes]);
    const failMessageRef = React.useRef(failMessage);
    failMessageRef.current = failMessage;

    React.useEffect(() => {
        let cancelled = false;
        api.list()
            .then(list => {
                if (cancelled) return;
                setPresets(list);
                setLoaded(true);
            })
            .catch(error => {
                if (!cancelled) showNotice('error', failMessageRef.current(error), 12000);
            });
        return () => {
            cancelled = true;
        };
    }, [api]);

    const visible = filter ? presets.filter(filter) : presets;
    const builtins = visible.filter(preset => preset.builtin);
    const customs = visible.filter(preset => !preset.builtin);
    const selected = visible.find(preset => preset.id === selectedId) ?? null;
    const editable = !!selected && !selected.builtin;

    // 選択中のプリセットとその値が変わったときだけ知らせる (コールバックは毎回作られるため ref 経由で呼ぶ)
    const selectedNotifyRef = React.useRef(onSelectedPresetChange);
    selectedNotifyRef.current = onSelectedPresetChange;
    const selectedKey = selected
        ? `${selected.id}
${JSON.stringify(selected.params)}`
        : '';
    const selectedRef = React.useRef(selected);
    selectedRef.current = selected;
    React.useEffect(() => {
        if (loaded) selectedNotifyRef.current?.(selectedRef.current);
    }, [loaded, selectedKey]);
    const label = (preset: PresetRecord<T>) => preset.name || (preset.nameKey ? t(preset.nameKey) : preset.id);
    // 変更できないプリセットを選んでいる場合は、操作の名前に理由を添える
    const actionTitle = (action: string) => (selected?.builtin ? t('presets.locked', { action }) : action);
    const askConfirm = (action: Confirm['action']) => {
        if (selected) setConfirm({ action, name: label(selected), open: true });
    };
    const closeConfirm = () => setConfirm(previous => ({ ...previous, open: false }));

    // プリセットの保存などを行い、失敗した場合は理由を知らせる
    const update = async (task: () => Promise<PresetRecord<T>[]>): Promise<boolean> => {
        try {
            setPresets(await task());
            return true;
        } catch (error) {
            showNotice('error', failMessage(error));
            return false;
        }
    };

    const saveNew = async (name: string) => {
        try {
            const list = await api.save({ name, params: current() });
            setPresets(list);
            setSelectedId(list[list.length - 1]?.id ?? '');
            showNotice('success', t('presets.saved'));
        } catch (error) {
            showNotice('error', failMessage(error));
        }
    };

    const overwrite = async () => {
        if (!editable || !selected) return;
        const saved = await update(() => api.save({ id: selected.id, name: '', params: current() }));
        if (saved) showNotice('success', t('presets.saved'));
    };

    const remove = async () => {
        if (!editable || !selected) return;
        if (await update(() => api.remove(selected.id))) setSelectedId('');
    };

    // 呼び出しは項目を押したときに行う (選択中のものを選び直しても呼び出せるように。値の変更の通知は、
    // 同じものを選んだときには来ないため)
    const item = (preset: PresetRecord<T>) => (
        <MenuItem key={preset.id} value={preset.id} onClick={() => onApply(preset.params)}>
            {label(preset)}
        </MenuItem>
    );
    // 標準とカスタムの両方があるときだけ、見出しで分ける
    const grouped = builtins.length > 0 && customs.length > 0;
    const items = grouped
        ? [
              <ListSubheader key='group-builtin'>{t('presets.groupBuiltin')}</ListSubheader>,
              ...builtins.map(item),
              <ListSubheader key='group-custom'>{t('presets.groupCustom')}</ListSubheader>,
              ...customs.map(item),
          ]
        : visible.map(item);

    return (
        <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
            <FormControl size='small' sx={{ flexGrow: 1, minWidth: 0 }} disabled={disabled}>
                <InputLabel id={`preset-${id}`}>{t('presets.label')}</InputLabel>
                <Select
                    labelId={`preset-${id}`}
                    label={t('presets.label')}
                    value={selected ? selected.id : ''}
                    onChange={event => setSelectedId(String(event.target.value))}
                >
                    {visible.length === 0 && (
                        <MenuItem value='' disabled>
                            <Typography variant='body2' color='text.secondary'>
                                {t('presets.none')}
                            </Typography>
                        </MenuItem>
                    )}
                    {items}
                </Select>
            </FormControl>
            <Tooltip title={actionTitle(t('presets.overwrite'))}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('presets.overwrite')}
                        disabled={disabled || !editable}
                        onClick={() => askConfirm('overwrite')}
                    >
                        <SaveIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={t('presets.saveNew')}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('presets.saveNew')}
                        disabled={disabled}
                        onClick={() => setNameDialog({ mode: 'new', name: '' })}
                    >
                        <SaveAsIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={actionTitle(t('presets.rename'))}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('presets.rename')}
                        disabled={disabled || !editable}
                        onClick={() => selected && setNameDialog({ mode: 'rename', name: label(selected) })}
                    >
                        <DriveFileRenameOutlineIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={actionTitle(t('presets.delete'))}>
                <span>
                    <IconButton
                        size='small'
                        aria-label={t('presets.delete')}
                        disabled={disabled || !editable}
                        onClick={() => askConfirm('delete')}
                    >
                        <DeleteOutlineIcon fontSize='small' />
                    </IconButton>
                </span>
            </Tooltip>

            <AppDialog open={nameDialog !== null} onClose={() => setNameDialog(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{nameDialog?.mode === 'rename' ? t('presets.rename') : t('presets.saveNew')}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        size='small'
                        sx={{ mt: 1 }}
                        label={t('presets.name')}
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
                            else if (editable && selected) await update(() => api.rename(selected.id, name));
                        }}
                    >
                        {t('common.ok')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={confirm.open} onClose={closeConfirm} maxWidth='xs' fullWidth>
                <DialogTitle>
                    {confirm.action === 'overwrite' ? t('presets.overwrite') : t('presets.delete')}
                </DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t(confirm.action === 'overwrite' ? 'presets.overwriteConfirm' : 'presets.deleteConfirm', {
                            name: confirm.name,
                        })}
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
                        {confirm.action === 'overwrite' ? t('presets.overwriteRun') : t('presets.delete')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </Stack>
    );
}
