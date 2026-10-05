import React from 'react';
import {
    Box,
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
import AddIcon from '@mui/icons-material/Add';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { formatDuration } from './voiceFormat';
import { voiceErrorMessage } from './voiceErrors';
import type { TrainingSetsState } from './useTrainingSets';
import { showNotice } from '../../stores/noticeStore';
import { VOICE_LANGUAGES, type VoiceLanguage } from '@shared/voice/languages';
import type { TrainingSetSummary, VoiceModelFeature } from '@shared/voice/types';

// 名前の入力の内容。閉じる間も表示が変わらないよう、開閉とは別に持つ
type NameDialog = { open: boolean; mode: 'create' | 'rename'; name: string; language: VoiceLanguage };

// 学習セットの内容の要約 (読み上げは言語と音声のある文の数、音声変換は音声の数と、合計の長さ)
export function trainingSetDetail(t: TFunction, set: TrainingSetSummary): string {
    const duration = formatDuration(set.durationSec);
    return set.language
        ? t('voice.trainingSets.ttsDetail', {
              language: t(`voice.languages.${set.language}`),
              count: set.audioCount,
              duration,
          })
        : t('voice.trainingSets.rvcDetail', { count: set.audioCount, duration });
}

type Props = {
    feature: VoiceModelFeature;
    state: TrainingSetsState;
    // 新しく作る読み上げの学習セットの言語の初期値
    defaultLanguage?: VoiceLanguage;
    disabled?: boolean;
};

// 学習セットの選択・作成・名前の変更・削除 (ごみ箱へ)
export default function TrainingSetBar({ feature, state, defaultLanguage = 'ja', disabled }: Props) {
    const { t } = useTranslation();
    const { sets, loaded, selected, select, reload } = state;
    const [nameDialog, setNameDialog] = React.useState<NameDialog>({
        open: false,
        mode: 'create',
        name: '',
        language: defaultLanguage,
    });
    // 削除の確認の対象。閉じる間も表示が変わらないよう、開閉とは別に持つ
    const [removeConfirm, setRemoveConfirm] = React.useState<{ open: boolean; set: TrainingSetSummary | null }>({
        open: false,
        set: null,
    });
    const closeNameDialog = () => setNameDialog(previous => ({ ...previous, open: false }));

    const submitName = async () => {
        const name = nameDialog.name.trim();
        // 閉じる途中に Enter をもう一度押しても、作成・名前の変更を繰り返さない
        if (!name || !nameDialog.open) return;
        closeNameDialog();
        try {
            if (nameDialog.mode === 'create') {
                const created = await window.kuraToolkit.voice.trainingSets.create(
                    feature,
                    name,
                    feature === 'tts' ? nameDialog.language : undefined
                );
                select(created.id);
            } else if (selected) {
                await window.kuraToolkit.voice.trainingSets.rename(feature, selected.id, name);
            }
            await reload();
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const remove = async (set: TrainingSetSummary) => {
        try {
            await window.kuraToolkit.voice.trainingSets.remove(feature, set.id);
            await reload();
            showNotice('success', t('voice.trainingSets.removed', { name: set.name }));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    return (
        <>
            <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
                <FormControl size='small' sx={{ flexGrow: 1, minWidth: 0 }} disabled={disabled}>
                    <InputLabel id={`training-set-${feature}`}>{t('voice.trainingSets.label')}</InputLabel>
                    <Select
                        labelId={`training-set-${feature}`}
                        label={t('voice.trainingSets.label')}
                        value={selected?.id ?? ''}
                        onChange={event => select(String(event.target.value))}
                        renderValue={value => {
                            const set = sets.find(item => item.id === value);
                            return set ? `${set.name} (${trainingSetDetail(t, set)})` : '';
                        }}
                    >
                        {sets.length === 0 && (
                            <MenuItem value='' disabled>
                                <Typography variant='body2' color='text.secondary'>
                                    {t('voice.trainingSets.none')}
                                </Typography>
                            </MenuItem>
                        )}
                        {sets.map(set => (
                            <MenuItem key={set.id} value={set.id}>
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant='body2'>{set.name}</Typography>
                                    <Typography variant='caption' color='text.secondary'>
                                        {trainingSetDetail(t, set)}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Tooltip title={t('voice.trainingSets.create')}>
                    <span>
                        <IconButton
                            size='small'
                            aria-label={t('voice.trainingSets.create')}
                            disabled={disabled}
                            onClick={() =>
                                setNameDialog({ open: true, mode: 'create', name: '', language: defaultLanguage })
                            }
                        >
                            <AddIcon fontSize='small' />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={t('voice.trainingSets.rename')}>
                    <span>
                        <IconButton
                            size='small'
                            aria-label={t('voice.trainingSets.rename')}
                            disabled={disabled || !selected}
                            onClick={() =>
                                selected &&
                                setNameDialog({
                                    open: true,
                                    mode: 'rename',
                                    name: selected.name,
                                    language: selected.language ?? defaultLanguage,
                                })
                            }
                        >
                            <DriveFileRenameOutlineIcon fontSize='small' />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={t('voice.trainingSets.remove')}>
                    <span>
                        <IconButton
                            size='small'
                            aria-label={t('voice.trainingSets.remove')}
                            disabled={disabled || !selected}
                            onClick={() => selected && setRemoveConfirm({ open: true, set: selected })}
                        >
                            <DeleteOutlineIcon fontSize='small' />
                        </IconButton>
                    </span>
                </Tooltip>
            </Stack>
            {loaded && sets.length === 0 && (
                <Stack direction='row' spacing={2} sx={{ alignItems: 'center', mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                        {t('voice.trainingSets.empty')}
                    </Typography>
                    <Button
                        variant='contained'
                        startIcon={<AddIcon />}
                        disabled={disabled}
                        onClick={() =>
                            setNameDialog({ open: true, mode: 'create', name: '', language: defaultLanguage })
                        }
                    >
                        {t('voice.trainingSets.create')}
                    </Button>
                </Stack>
            )}

            <AppDialog open={nameDialog.open} onClose={closeNameDialog} maxWidth='xs' fullWidth>
                <DialogTitle>
                    {nameDialog.mode === 'create' ? t('voice.trainingSets.create') : t('voice.trainingSets.rename')}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            autoFocus
                            size='small'
                            label={t('voice.trainingSets.name')}
                            value={nameDialog.name}
                            onChange={event => setNameDialog(previous => ({ ...previous, name: event.target.value }))}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void submitName();
                            }}
                        />
                        {feature === 'tts' && nameDialog.mode === 'create' && (
                            <FormControl size='small'>
                                <InputLabel id='training-set-language'>{t('voice.tts.language')}</InputLabel>
                                <Select
                                    labelId='training-set-language'
                                    label={t('voice.tts.language')}
                                    value={nameDialog.language}
                                    onChange={event =>
                                        setNameDialog(previous => ({
                                            ...previous,
                                            language: event.target.value as VoiceLanguage,
                                        }))
                                    }
                                >
                                    {VOICE_LANGUAGES.map(item => (
                                        <MenuItem key={item} value={item}>
                                            {t(`voice.languages.${item}`)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        {feature === 'tts' && nameDialog.mode === 'create' && (
                            <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                                {t('voice.trainingSets.languageFixed')}
                            </Typography>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeNameDialog}>{t('common.cancel')}</Button>
                    <Button variant='contained' disabled={!nameDialog.name.trim()} onClick={() => void submitName()}>
                        {nameDialog.mode === 'create'
                            ? t('voice.trainingSets.createAction')
                            : t('voice.trainingSets.renameAction')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog
                open={removeConfirm.open}
                onClose={() => setRemoveConfirm(previous => ({ ...previous, open: false }))}
                maxWidth='xs'
                fullWidth
            >
                <DialogTitle>{t('voice.trainingSets.remove')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.trainingSets.removeConfirm', { name: removeConfirm.set?.name ?? '' })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRemoveConfirm(previous => ({ ...previous, open: false }))}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant='contained'
                        color='error'
                        onClick={() => {
                            const set = removeConfirm.set;
                            setRemoveConfirm(previous => ({ ...previous, open: false }));
                            if (set) void remove(set);
                        }}
                    >
                        {t('voice.trainingSets.removeAction')}
                    </Button>
                </DialogActions>
            </AppDialog>
        </>
    );
}
