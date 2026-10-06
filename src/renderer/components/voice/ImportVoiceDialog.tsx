import React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Collapse,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    FormGroup,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { voiceErrorMessage } from './voiceErrors';
import { hasSameVoiceName } from './voiceFormat';
import { VOICE_LANGUAGES, type VoiceLanguage } from '@shared/voice/languages';
import type { FileFilter } from '@shared/types';
import type { ImportInspection, VoiceModelFeature, VoiceModelInfo } from '@shared/voice/types';

type Props = {
    open: boolean;
    feature: VoiceModelFeature;
    // 登録済みのモデル (同じ名前を付けようとしたときに注意を出す)
    existing: VoiceModelInfo[];
    onClose(): void;
    onImported(info: VoiceModelInfo): void;
};

// choosing: 確認画面で選び直したファイルを調べ直している
type Stage = 'notice' | 'select' | 'inspecting' | 'review' | 'choosing' | 'saving';

const MODEL_EXTENSIONS: Record<VoiceModelFeature, string[]> = {
    converter: ['pth', 'index', 'zip'],
    tts: ['safetensors', 'json', 'npy', 'zip'],
};

// 取り込むファイルを選ぶダイアログの種類
function fileFilters(t: TFunction, feature: VoiceModelFeature): FileFilter[] {
    return [
        {
            name: t(feature === 'converter' ? 'voice.fileFilters.rvcModel' : 'voice.fileFilters.ttsModel'),
            extensions: MODEL_EXTENSIONS[feature],
        },
        { name: t('voice.fileFilters.allFiles'), extensions: ['*'] },
    ];
}

// 声のモデルの取り込み。取り込みのたびに注意文を示し、同意した場合だけファイルの選択に進む。
// 安全な方式で読み込めないファイルは拒否せず、危険性を示したうえで制限なしの読み込みを許可するかを確認する
export default function ImportVoiceDialog({ open, feature, existing, onClose, onImported }: Props) {
    const { t } = useTranslation();
    const [stage, setStage] = React.useState<Stage>('notice');
    const [agreed, setAgreed] = React.useState(false);
    const [inspection, setInspection] = React.useState<ImportInspection | null>(null);
    const [name, setName] = React.useState('');
    const [languages, setLanguages] = React.useState<VoiceLanguage[]>([]);
    const [allowUnsafe, setAllowUnsafe] = React.useState(false);
    const [showUnsafeDetail, setShowUnsafeDetail] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) return;
        setStage('notice');
        setAgreed(false);
        setInspection(null);
        setAllowUnsafe(false);
        setShowUnsafeDetail(false);
        setError(null);
    }, [open]);

    const close = () => {
        if (inspection) void window.kuraToolkit.voice.models.cancelImport(inspection.token);
        onClose();
    };

    // 確認の段階からファイルの選択に戻る (調べた結果は使わないので破棄する)
    const backToSelect = () => {
        if (inspection) void window.kuraToolkit.voice.models.cancelImport(inspection.token);
        setInspection(null);
        setAllowUnsafe(false);
        setShowUnsafeDetail(false);
        setError(null);
        setStage('select');
    };

    const inspect = async (paths: string[]) => {
        if (paths.length === 0) return;
        setStage('inspecting');
        setError(null);
        try {
            const result = await window.kuraToolkit.voice.models.inspectImport(feature, paths);
            setInspection(result);
            setName(result.suggestedName);
            setLanguages(result.tts?.languages ?? []);
            setAllowUnsafe(false);
            setShowUnsafeDetail(false);
            setStage('review');
        } catch (caught) {
            setError(voiceErrorMessage(t, caught));
            setStage('select');
        }
    };

    // 候補が複数ある場合に、選び直したファイルで調べ直す
    const choose = async (model: string, index: string | null) => {
        if (!inspection) return;
        setStage('choosing');
        setError(null);
        try {
            const result = await window.kuraToolkit.voice.models.chooseImportFiles(inspection.token, model, index);
            // 名前を変えていなければ、選んだファイルから決まる名前にする
            if (name === inspection.suggestedName) setName(result.suggestedName);
            setLanguages(result.tts?.languages ?? []);
            setInspection(result);
            setAllowUnsafe(false);
            setShowUnsafeDetail(false);
        } catch (caught) {
            setError(voiceErrorMessage(t, caught));
        } finally {
            setStage('review');
        }
    };

    const busy = stage === 'inspecting' || stage === 'choosing' || stage === 'saving';
    const choices = inspection?.choices;

    const commit = async () => {
        if (!inspection) return;
        setStage('saving');
        try {
            const info = await window.kuraToolkit.voice.models.commitImport(inspection.token, {
                name,
                allowUnsafe,
                languages: inspection.tts?.modelType === 'multilingual' ? languages : undefined,
            });
            setInspection(null);
            onImported(info);
            onClose();
        } catch (caught) {
            setError(voiceErrorMessage(t, caught));
            setStage('review');
        }
    };

    return (
        <AppDialog open={open} onClose={busy ? undefined : close} maxWidth='sm' fullWidth>
            <DialogTitle>{t('voice.import.title')}</DialogTitle>
            <DialogContent dividers>
                {stage === 'notice' && (
                    <Stack spacing={1.5}>
                        <Alert severity='warning'>
                            <AlertTitle>{t('voice.import.noticeTitle')}</AlertTitle>
                            <Box component='ul' sx={{ m: 0, pl: 2.5 }}>
                                {['license', 'consent', 'misuse', 'responsibility'].map(key => (
                                    <Typography component='li' variant='body2' key={key} sx={{ lineHeight: 1.6 }}>
                                        {t(`voice.import.notice.${key}`)}
                                    </Typography>
                                ))}
                                <Typography component='li' variant='body2' sx={{ lineHeight: 1.6 }}>
                                    {t(`voice.import.notice.${feature}`)}
                                </Typography>
                            </Box>
                        </Alert>
                        <FormControlLabel
                            control={<Checkbox checked={agreed} onChange={(_e, value) => setAgreed(value)} />}
                            label={t('voice.import.agree')}
                        />
                    </Stack>
                )}
                {(stage === 'select' || stage === 'inspecting') && (
                    <Stack spacing={1.5}>
                        <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                            {t(`voice.import.selectHint.${feature}`)}
                        </Typography>
                        {error && <Alert severity='error'>{error}</Alert>}
                        {stage === 'inspecting' ? (
                            <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
                                <CircularProgress size={20} />
                                <Typography variant='body2'>{t('voice.import.inspecting')}</Typography>
                            </Stack>
                        ) : (
                            <Stack direction='row' spacing={1}>
                                <Button
                                    variant='outlined'
                                    onClick={async () =>
                                        inspect(
                                            await window.kuraToolkit.dialog.openFiles({
                                                filters: fileFilters(t, feature),
                                                multi: true,
                                            })
                                        )
                                    }
                                >
                                    {t('voice.import.chooseFiles')}
                                </Button>
                                <Button
                                    variant='outlined'
                                    onClick={async () => {
                                        const dir = await window.kuraToolkit.dialog.openDirectory();
                                        if (dir) await inspect([dir]);
                                    }}
                                >
                                    {t('voice.import.chooseFolder')}
                                </Button>
                            </Stack>
                        )}
                    </Stack>
                )}
                {(stage === 'review' || stage === 'choosing' || stage === 'saving') && inspection && (
                    <Stack spacing={1.5}>
                        <Typography variant='body2'>
                            {t(
                                inspection.source === 'kura' ? 'voice.import.sourceKura' : 'voice.import.sourceExternal'
                            )}
                        </Typography>
                        {choices && (choices.models.length > 1 || choices.indexes.length > 1) && (
                            <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                                {t('voice.import.multipleCandidates')}
                            </Typography>
                        )}
                        {choices && choices.models.length > 1 && (
                            <TextField
                                select
                                size='small'
                                label={t('voice.import.modelFile')}
                                value={choices.model}
                                disabled={busy}
                                onChange={event => void choose(event.target.value, choices.index)}
                            >
                                {choices.models.map(candidate => (
                                    <MenuItem key={candidate.path} value={candidate.path}>
                                        {candidate.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                        )}
                        {choices && choices.indexes.length > 1 && (
                            <TextField
                                select
                                size='small'
                                label={t('voice.import.indexFile')}
                                value={choices.index ?? ''}
                                disabled={busy}
                                onChange={event => void choose(choices.model, event.target.value)}
                            >
                                {choices.indexes.map(candidate => (
                                    <MenuItem key={candidate.path} value={candidate.path}>
                                        {candidate.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                        )}
                        {stage === 'choosing' && (
                            <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
                                <CircularProgress size={20} />
                                <Typography variant='body2'>{t('voice.import.inspecting')}</Typography>
                            </Stack>
                        )}
                        {inspection.rvc && (
                            <Typography variant='body2' color='text.secondary'>
                                {t('voice.models.rvcInfo', {
                                    version: inspection.rvc.version,
                                    rate: inspection.rvc.sampleRate,
                                    index: inspection.rvc.hasIndex
                                        ? t('voice.models.indexYes')
                                        : t('voice.models.indexNo'),
                                    embedder: inspection.rvc.embedder,
                                })}
                            </Typography>
                        )}
                        {inspection.tts && (
                            <Typography variant='body2' color='text.secondary'>
                                {t('voice.models.ttsInfo', {
                                    modelType: t(`voice.modelType.${inspection.tts.modelType}`),
                                    styles: inspection.tts.styles.length,
                                    version: inspection.tts.version,
                                })}
                            </Typography>
                        )}
                        <TextField
                            size='small'
                            label={t('voice.models.name')}
                            value={name}
                            onChange={event => setName(event.target.value)}
                            helperText={hasSameVoiceName(existing, name) ? t('voice.models.duplicateName') : undefined}
                            slotProps={{ formHelperText: { sx: { color: 'warning.main', whiteSpace: 'pre-line' } } }}
                        />
                        {inspection.tts?.modelType === 'multilingual' && (
                            <Box>
                                <Typography variant='body2'>{t('voice.models.languages')}</Typography>
                                <FormGroup row>
                                    {VOICE_LANGUAGES.map(language => (
                                        <FormControlLabel
                                            key={language}
                                            control={
                                                <Checkbox
                                                    checked={languages.includes(language)}
                                                    onChange={(_e, checked) =>
                                                        setLanguages(previous =>
                                                            checked
                                                                ? [...previous, language]
                                                                : previous.filter(item => item !== language)
                                                        )
                                                    }
                                                />
                                            }
                                            label={t(`voice.languages.${language}`)}
                                        />
                                    ))}
                                </FormGroup>
                            </Box>
                        )}
                        {!inspection.safe && (
                            <Alert severity='error'>
                                <AlertTitle>{t('voice.import.unsafeTitle')}</AlertTitle>
                                <Typography variant='body2' sx={{ lineHeight: 1.6 }}>
                                    {t(`voice.import.unsafeMessage.${feature}`)}
                                </Typography>
                                {inspection.unsafeDetail && (
                                    <>
                                        <Button
                                            size='small'
                                            color='inherit'
                                            startIcon={showUnsafeDetail ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            aria-expanded={showUnsafeDetail}
                                            onClick={() => setShowUnsafeDetail(value => !value)}
                                            sx={{ mt: 0.5, ml: -0.5 }}
                                        >
                                            {showUnsafeDetail ? t('common.hideDetails') : t('common.showDetails')}
                                        </Button>
                                        <Collapse in={showUnsafeDetail}>
                                            <Typography
                                                variant='caption'
                                                sx={{
                                                    display: 'block',
                                                    wordBreak: 'break-all',
                                                    fontFamily: 'Consolas, Menlo, monospace',
                                                }}
                                            >
                                                {inspection.unsafeDetail}
                                            </Typography>
                                        </Collapse>
                                    </>
                                )}
                                <FormControlLabel
                                    sx={{ mt: 1 }}
                                    control={
                                        <Checkbox
                                            checked={allowUnsafe}
                                            onChange={(_e, value) => setAllowUnsafe(value)}
                                        />
                                    }
                                    label={t('voice.import.allowUnsafe')}
                                />
                            </Alert>
                        )}
                        {error && <Alert severity='error'>{error}</Alert>}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={close} disabled={busy}>
                    {t('common.cancel')}
                </Button>
                {stage === 'notice' && (
                    <Button variant='contained' disabled={!agreed} onClick={() => setStage('select')}>
                        {t('voice.import.next')}
                    </Button>
                )}
                {(stage === 'review' || stage === 'choosing' || stage === 'saving') && (
                    <Button onClick={backToSelect} disabled={busy}>
                        {t('voice.common.back')}
                    </Button>
                )}
                {(stage === 'review' || stage === 'choosing' || stage === 'saving') && (
                    <Button
                        variant='contained'
                        color={inspection?.safe ? 'primary' : 'warning'}
                        disabled={
                            busy ||
                            !name.trim() ||
                            (!inspection?.safe && !allowUnsafe) ||
                            (inspection?.tts?.modelType === 'multilingual' && languages.length === 0)
                        }
                        onClick={() => void commit()}
                    >
                        {t('voice.import.run')}
                    </Button>
                )}
            </DialogActions>
        </AppDialog>
    );
}
