import React from 'react';
import {
    Alert,
    Button,
    Checkbox,
    Chip,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    FormGroup,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import LibraryAddIcon from '@mui/icons-material/LibraryAdd';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import AppDialog from '../../components/common/AppDialog';
import ProgressDialog from '../../components/common/ProgressDialog';
import ImportVoiceDialog from '../../components/voice/ImportVoiceDialog';
import ReadinessAlert, { useFeatureReadiness, whenInstalled } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import { hasSameVoiceName, sanitizeFileName, voiceLabel } from '../../components/voice/voiceFormat';
import { voiceErrorMessage } from '../../components/voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { notifyVoiceLibraryChanged, openVoiceLibrary, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import { VOICE_LANGUAGES, type VoiceLanguage } from '@shared/voice/languages';
import { TTS_READY_PREFIX } from '@shared/voice/requirements';
import type { VoiceModelCategory, VoiceModelFeature, VoiceModelInfo } from '@shared/voice/types';

const CATEGORY_COLORS: Record<VoiceModelCategory, 'primary' | 'secondary' | 'default'> = {
    trained: 'primary',
    imported: 'secondary',
    ready: 'default',
};

type Props = {
    feature: VoiceModelFeature;
};

// 声のモデルの管理 (名前付きで複数保持し、名前変更・削除・書き出し・取り込みができる)
export default function VoiceModelsPage({ feature }: Props) {
    const { t } = useTranslation();
    const readiness = useFeatureReadiness(feature === 'converter' ? 'conversion' : 'tts');
    const libraryVersion = useVoiceLibraryStore(state => state.version);
    const [voices, setVoices] = React.useState<VoiceModelInfo[]>([]);
    const [importOpen, setImportOpen] = React.useState(false);
    const [rename, setRename] = React.useState<{ voice: VoiceModelInfo; name: string } | null>(null);
    const [languagesEdit, setLanguagesEdit] = React.useState<{
        voice: VoiceModelInfo;
        languages: VoiceLanguage[];
    } | null>(null);
    // 削除の確認。閉じる間も表示が変わらないよう、開閉とは別に持つ
    const [remove, setRemove] = React.useState<{ open: boolean; voice: VoiceModelInfo | null }>({
        open: false,
        voice: null,
    });
    const closeRemove = () => setRemove(previous => ({ ...previous, open: false }));
    const { job, run, cancel } = useJobRunner();

    // 一覧を読み直す。読めない場合 (一覧のファイルの破損など) は理由を知らせる
    const load = React.useCallback(async () => {
        try {
            setVoices(await window.kuraToolkit.voice.models.list(feature));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 12000);
        }
    }, [feature, t]);
    // すぐに使えるモデルのダウンロード・削除で一覧が変わるため、取得状況が変わったら読み直す
    React.useEffect(() => {
        void load();
    }, [load, libraryVersion]);

    // すぐに使えるモデルは「ダウンロード管理」で取得する。まだ取得していないものを選んだ状態で開く
    const openReadyModels = () => {
        const readyModels = (readiness.status?.items ?? []).filter(
            item => item.id.startsWith(TTS_READY_PREFIX) && item.available && item.status !== 'installed'
        );
        openVoiceLibrary({ select: readyModels.map(item => item.id), focus: 'tts' });
    };

    const exportVoice = async (voice: VoiceModelInfo) => {
        const dest = await window.kuraToolkit.dialog.saveFile({
            defaultPath: `${sanitizeFileName(voiceLabel(t, voice))}.kuravoice`,
            filters: [{ name: t('voice.fileFilters.voiceModel'), extensions: ['kuravoice'] }],
        });
        if (!dest) return;
        try {
            await run(
                t('voice.models.exporting'),
                () => window.kuraToolkit.voice.models.export(feature, voice.id, dest),
                {
                    cancellable: false,
                }
            );
            showNotice('success', t('voice.models.exported'));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error), 10000);
        }
    };

    const saveLanguages = async () => {
        if (!languagesEdit) return;
        try {
            await window.kuraToolkit.voice.models.setLanguages(languagesEdit.voice.id, languagesEdit.languages);
            setLanguagesEdit(null);
            await load();
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const details = (voice: VoiceModelInfo) => {
        if (voice.rvc) {
            return t('voice.models.rvcInfo', {
                version: voice.rvc.version,
                rate: voice.rvc.sampleRate,
                index: voice.rvc.hasIndex ? t('voice.models.indexYes') : t('voice.models.indexNo'),
                embedder: voice.rvc.embedder,
            });
        }
        if (voice.tts) {
            return `${t('voice.models.ttsInfo', {
                engine: t(`voice.engine.${voice.tts.engine}`),
                styles: voice.tts.styles.length,
                version: voice.tts.version,
            })} / ${voice.tts.languages.map(language => t(`voice.languages.${language}`)).join(', ')}`;
        }
        return '';
    };

    return (
        <PageContainer>
            <VoiceFeatureHeader feature={feature === 'converter' ? 'conversion' : 'tts'} />
            <ReadinessAlert state={readiness} />
            <Stack direction='row' spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                {/* 取り込み時の検査に Python とパッケージ一式を使う。足りなければそれを選んだ状態でダウンロードを開く */}
                <Button
                    variant='contained'
                    startIcon={<FileUploadIcon />}
                    onClick={() =>
                        whenInstalled(readiness, ['python', `component:${feature}`], () => setImportOpen(true))
                    }
                >
                    {t('voice.models.import')}
                </Button>
                <Button
                    variant='outlined'
                    startIcon={<TravelExploreIcon />}
                    onClick={() => void window.kuraToolkit.voice.models.openHubSearch(feature)}
                >
                    {t('voice.models.searchHub')}
                </Button>
                {feature === 'tts' && (
                    <Button variant='outlined' startIcon={<LibraryAddIcon />} onClick={openReadyModels}>
                        {t('voice.models.getReadyModels')}
                    </Button>
                )}
            </Stack>
            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                {t(`voice.models.intro.${feature}`)}
            </Typography>

            <Panel disablePadding sx={{ overflow: 'auto' }}>
                {voices.length === 0 ? (
                    <Typography variant='body2' color='text.secondary' sx={{ p: 2 }}>
                        {t('voice.models.empty')}
                    </Typography>
                ) : (
                    <Table size='small'>
                        <TableHead>
                            <TableRow>
                                <TableCell>{t('voice.models.name')}</TableCell>
                                <TableCell>{t('voice.models.category')}</TableCell>
                                <TableCell>{t('voice.models.details')}</TableCell>
                                <TableCell align='right'>{t('voice.models.actions')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {voices.map(voice => (
                                <TableRow key={voice.id} hover>
                                    <TableCell>
                                        <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                            {voiceLabel(t, voice)}
                                        </Typography>
                                        <Typography variant='caption' color='text.secondary'>
                                            {new Date(voice.createdAt).toLocaleString()}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            size='small'
                                            color={CATEGORY_COLORS[voice.category]}
                                            label={t(`voice.models.categories.${voice.category}`)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant='body2' color='text.secondary'>
                                            {details(voice)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                                        <Tooltip title={t('voice.models.rename')}>
                                            <IconButton
                                                size='small'
                                                aria-label={t('voice.models.rename')}
                                                onClick={() => setRename({ voice, name: voiceLabel(t, voice) })}
                                            >
                                                <DriveFileRenameOutlineIcon fontSize='small' />
                                            </IconButton>
                                        </Tooltip>
                                        {voice.tts?.engine === 'multilingual' && (
                                            <Tooltip title={t('voice.models.editLanguages')}>
                                                <IconButton
                                                    size='small'
                                                    aria-label={t('voice.models.editLanguages')}
                                                    onClick={() =>
                                                        setLanguagesEdit({
                                                            voice,
                                                            languages: voice.tts?.languages ?? [],
                                                        })
                                                    }
                                                >
                                                    <TranslateIcon fontSize='small' />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        <Tooltip title={t('voice.models.export')}>
                                            <IconButton
                                                size='small'
                                                aria-label={t('voice.models.export')}
                                                onClick={() => void exportVoice(voice)}
                                            >
                                                <FileDownloadIcon fontSize='small' />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={t('voice.models.delete')}>
                                            <IconButton
                                                size='small'
                                                aria-label={t('voice.models.delete')}
                                                onClick={() => setRemove({ open: true, voice })}
                                            >
                                                <DeleteOutlineIcon fontSize='small' />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </Panel>

            <ImportVoiceDialog
                open={importOpen}
                feature={feature}
                existing={voices}
                onClose={() => setImportOpen(false)}
                onImported={info => {
                    showNotice('success', t('voice.models.imported', { name: voiceLabel(t, info) }));
                    void load();
                }}
            />

            <AppDialog open={rename !== null} onClose={() => setRename(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.models.rename')}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        size='small'
                        sx={{ mt: 1 }}
                        label={t('voice.models.name')}
                        value={rename?.name ?? ''}
                        onChange={event =>
                            setRename(previous => (previous ? { ...previous, name: event.target.value } : previous))
                        }
                        helperText={
                            rename && hasSameVoiceName(t, voices, rename.name, rename.voice.id)
                                ? t('voice.models.duplicateName')
                                : undefined
                        }
                        slotProps={{ formHelperText: { sx: { color: 'warning.main', whiteSpace: 'pre-line' } } }}
                    />
                    {rename?.voice.category === 'ready' && (
                        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>
                            {t('voice.models.readyRenameNote')}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRename(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        disabled={!rename?.name.trim()}
                        onClick={async () => {
                            if (!rename) return;
                            try {
                                await window.kuraToolkit.voice.models.rename(feature, rename.voice.id, rename.name);
                                setRename(null);
                                await load();
                            } catch (error) {
                                showNotice('error', voiceErrorMessage(t, error));
                            }
                        }}
                    >
                        {t('voice.common.save')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={languagesEdit !== null} onClose={() => setLanguagesEdit(null)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.models.editLanguages')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' color='text.secondary' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.models.languagesHint')}
                    </Typography>
                    <FormGroup>
                        {VOICE_LANGUAGES.map(language => (
                            <FormControlLabel
                                key={language}
                                control={
                                    <Checkbox
                                        checked={languagesEdit?.languages.includes(language) ?? false}
                                        onChange={(_e, checked) =>
                                            setLanguagesEdit(previous =>
                                                previous
                                                    ? {
                                                          ...previous,
                                                          languages: checked
                                                              ? [...previous.languages, language]
                                                              : previous.languages.filter(item => item !== language),
                                                      }
                                                    : previous
                                            )
                                        }
                                    />
                                }
                                label={t(`voice.languages.${language}`)}
                            />
                        ))}
                    </FormGroup>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLanguagesEdit(null)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        disabled={!languagesEdit || languagesEdit.languages.length === 0}
                        onClick={() => void saveLanguages()}
                    >
                        {t('voice.common.save')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={remove.open} onClose={closeRemove} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.models.delete')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                        {t('voice.models.deleteConfirm', { name: remove.voice ? voiceLabel(t, remove.voice) : '' })}
                    </Typography>
                    {remove.voice?.category === 'ready' ? (
                        <Typography variant='body2' color='text.secondary' sx={{ mt: 1.5, lineHeight: 1.6 }}>
                            {t('voice.models.deleteReady')}
                        </Typography>
                    ) : (
                        <Alert severity='warning' sx={{ mt: 1.5 }}>
                            {t('voice.models.deleteUserData')}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeRemove}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='error'
                        onClick={async () => {
                            const target = remove.voice;
                            if (!target) return;
                            closeRemove();
                            try {
                                await window.kuraToolkit.voice.models.remove(feature, target.id);
                                // すぐに使えるモデルの削除はダウンロードの取得状況も変えるため、取得状況の変化として知らせる
                                // (一覧は取得状況の変化を受けて読み直される)
                                if (target.category === 'ready') notifyVoiceLibraryChanged();
                                else await load();
                            } catch (error) {
                                showNotice('error', voiceErrorMessage(t, error));
                            }
                        }}
                    >
                        {t('voice.models.delete')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                onCancel={job?.cancellable ? cancel : undefined}
            />
        </PageContainer>
    );
}
