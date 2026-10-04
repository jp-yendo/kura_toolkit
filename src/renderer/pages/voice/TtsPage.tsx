import React from 'react';
import {
    Alert,
    Box,
    Button,
    Collapse,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    MenuItem,
    Select,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SaveIcon from '@mui/icons-material/Save';
import SaveAsIcon from '@mui/icons-material/SaveAs';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CodeIcon from '@mui/icons-material/Code';
import CampaignIcon from '@mui/icons-material/Campaign';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import DownloadIcon from '@mui/icons-material/Download';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import SectionLabel from '../../components/common/SectionLabel';
import AppDialog from '../../components/common/AppDialog';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import TagEditor, { type TagEditorHandle } from '../../components/voice/TagEditor';
import TagListDialog from '../../components/voice/TagListDialog';
import SymbolReadingsDialog, { symbolReadingsFor } from '../../components/voice/SymbolReadingsDialog';
import SyncPlayer from '../../components/voice/SyncPlayer';
import SliderField from '../../components/voice/SliderField';
import ExportDialog, { type ExportEntry } from '../../components/voice/ExportDialog';
import { voiceLabel } from '../../components/voice/voiceFormat';
import { isCancelledError, voiceErrorMessage } from '../../components/voice/voiceErrors';
import { useJobRunner } from '../../hooks/useJobRunner';
import { showNotice } from '../../stores/noticeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTtsStore } from '../../stores/ttsStore';
import { useVoiceHandoffStore } from '../../stores/voiceHandoffStore';
import { openVoiceLibrary, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import { applyTagFixes, findTagRanges, parseControlTags, type TagFix, type TagIssue } from '@shared/voice/control-tags';
import { formatTimestamp, parseSubtitles } from '@shared/voice/subtitles';
import { LANGUAGE_DEFINITIONS, VOICE_LANGUAGES, type TtsEngineId, type VoiceLanguage } from '@shared/voice/languages';
import type {
    LibraryStatus,
    SpeedupConfirmation,
    TimelineOverflowMode,
    TtsCandidate,
    TtsInputKind,
    VoiceModelInfo,
} from '@shared/voice/types';
import type { TFunction } from 'i18next';

const OVERFLOW_MODES: TimelineOverflowMode[] = ['speedup', 'overlap', 'shift', 'warn'];
// 保存するファイルの種類 (入力の種類ごと)
const SAVE_FILTER_KEYS: Record<TtsInputKind, string> = {
    text: 'voice.fileFilters.text',
    srt: 'voice.fileFilters.srt',
    vtt: 'voice.fileFilters.vtt',
};
const ENGINE_ITEMS: Record<TtsEngineId, string> = {
    'jp-extra': 'model:tts:bert-ja',
    multilingual: 'model:tts:bert-en',
};

type Analysis = { errors: TagIssue[]; fixes: TagFix[] };

// 編集中の文章を解析して、誤りと一括で直せる注意を返す (字幕は区間ごとに解析する)
function analyze(text: string, kind: TtsInputKind, language: VoiceLanguage): Analysis {
    if (kind === 'text') {
        const parsed = parseControlTags(text, { language });
        return { errors: parsed.errors, fixes: parsed.fixes };
    }
    const subtitles = parseSubtitles(text, kind);
    const errors: TagIssue[] = [...subtitles.errors];
    const fixes: TagFix[] = [];
    for (const cue of subtitles.cues) {
        const parsed = parseControlTags(cue.text, { language, baseOffset: cue.textOffset, documentText: text });
        errors.push(...parsed.errors);
        fixes.push(...parsed.fixes);
    }
    return { errors, fixes };
}

function tagIssueMessage(t: TFunction, issue: TagIssue): string {
    const params = {
        tag: issue.tag ?? '',
        attribute: issue.attribute ?? '',
        value: issue.value ?? '',
        expected: issue.expected ?? '',
        format: issue.format ? t(`voice.tagErrors.formats.${issue.format}`) : '',
        accent: issue.accentCode ? t(`voice.tagErrors.accent.${issue.accentCode}`) : '',
    };
    return t(`voice.tagErrors.${issue.code}`, params);
}

function engineInstalled(status: LibraryStatus | null, engine: TtsEngineId): boolean {
    return status?.items.find(item => item.id === ENGINE_ITEMS[engine])?.status === 'installed';
}

export default function TtsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const readiness = useFeatureReadiness('tts');
    const { settings } = useSettingsStore();
    const tts = useTtsStore();
    const editorRef = React.useRef<TagEditorHandle>(null);
    const [voices, setVoices] = React.useState<VoiceModelInfo[]>([]);
    const [analysis, setAnalysis] = React.useState<Analysis>({ errors: [], fixes: [] });
    const [tagListOpen, setTagListOpen] = React.useState(false);
    const [symbolsOpen, setSymbolsOpen] = React.useState(false);
    const [cuesOpen, setCuesOpen] = React.useState(false);
    const [fixConfirm, setFixConfirm] = React.useState<TagFix[] | null>(null);
    const [speedup, setSpeedup] = React.useState<SpeedupConfirmation | null>(null);
    const [report, setReport] = React.useState<TtsCandidate | null>(null);
    const [exportOpen, setExportOpen] = React.useState(false);
    const [confirmNew, setConfirmNew] = React.useState(false);
    const [advanced, setAdvanced] = React.useState(false);
    const { job, run, cancel } = useJobRunner();
    const status = readiness.status;
    const libraryVersion = useVoiceLibraryStore(state => state.version);

    const language: VoiceLanguage = tts.language ?? (settings?.app.language === 'en' ? 'en' : 'ja');
    const engines = LANGUAGE_DEFINITIONS[language].engines.filter(engine => engineInstalled(status, engine));
    const engine: TtsEngineId | null = tts.engine && engines.includes(tts.engine) ? tts.engine : (engines[0] ?? null);
    // 機能全体の不足 (ReadinessAlert) を案内している間は出さない (同じ案内が重なるため)。
    // 日本語のエンジンはそろっているが英語のエンジンが無い、といった場合に出す
    const languageEngineMissing = status !== null && (readiness.readiness?.ready ?? false) && engines.length === 0;
    // この言語で使えるが、まだ取得していないエンジン
    const missingEngines = LANGUAGE_DEFINITIONS[language].engines.filter(item => !engineInstalled(status, item));
    const candidatesVoices = voices.filter(
        voice => voice.tts?.engine === engine && voice.tts.languages.includes(language)
    );
    const voice = candidatesVoices.find(item => item.id === tts.voiceId) ?? candidatesVoices[0] ?? null;
    const styles = voice?.tts?.styles ?? ['Neutral'];
    const speakers = voice?.tts?.speakers ?? [];

    // 画面を開いたときと、プリセットの声やエンジンをダウンロードしたときに読み直す
    React.useEffect(() => {
        let cancelled = false;
        void window.kuraToolkit.voice.models.list('tts').then(list => {
            if (!cancelled) setVoices(list);
        });
        return () => {
            cancelled = true;
        };
    }, [libraryVersion]);

    // 入力中も随時チェックする (打つたびに解析すると重いので少し待ってから)
    React.useEffect(() => {
        const timer = window.setTimeout(() => setAnalysis(analyze(tts.text, tts.inputKind, language)), 250);
        return () => window.clearTimeout(timer);
    }, [tts.text, tts.inputKind, language]);

    const tagRanges = React.useMemo(() => findTagRanges(tts.text), [tts.text]);
    const errorRanges = analysis.errors.map(error => ({ start: error.offset, end: error.offset + error.length }));
    const cues = React.useMemo(
        () => (tts.inputKind === 'text' ? [] : parseSubtitles(tts.text, tts.inputKind).cues),
        [tts.text, tts.inputKind]
    );
    const modified = tts.text !== tts.savedText;
    const busy = job !== null;
    const ready = (readiness.readiness?.ready ?? false) && !!engine && !!voice;

    // --- ファイル ---
    const openFile = async () => {
        const paths = await window.kuraToolkit.dialog.openFiles({
            filters: [
                { name: t('voice.fileFilters.textAndSubtitles'), extensions: ['txt', 'srt', 'vtt'] },
                { name: t('voice.fileFilters.allFiles'), extensions: ['*'] },
            ],
        });
        if (!paths[0]) return;
        try {
            const loaded = await window.kuraToolkit.voice.tts.loadText(paths[0]);
            tts.loadDocument(loaded.text, loaded.kind, paths[0]);
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const saveFile = async (saveAs: boolean) => {
        let target = tts.filePath;
        if (saveAs || !target) {
            const ext = tts.inputKind === 'text' ? 'txt' : tts.inputKind;
            target = await window.kuraToolkit.dialog.saveFile({
                defaultPath: tts.filePath ?? `text.${ext}`,
                filters: [{ name: t(SAVE_FILTER_KEYS[tts.inputKind]), extensions: [ext] }],
            });
            if (!target) return;
        }
        try {
            await window.kuraToolkit.voice.tts.saveText(target, tts.text);
            tts.markSaved(target);
            showNotice('success', t('voice.tts.saved'));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    // --- 合成 ---
    const synthesize = async (text: string, confirmationToken?: string) => {
        if (!engine || !voice) return;
        try {
            const result = await run(t('voice.tts.running'), jobId =>
                window.kuraToolkit.voice.tts.run(jobId, {
                    workKey: tts.workKey,
                    engine,
                    language,
                    voiceId: voice.id,
                    params: { ...tts.params, style: styles.includes(tts.params.style) ? tts.params.style : styles[0] },
                    readSymbols: tts.readSymbols,
                    symbolReadings: symbolReadingsFor(settings, language),
                    text,
                    inputKind: tts.inputKind,
                    overflowMode: tts.overflowMode,
                    cueOverflowModes: tts.cueOverflowModes,
                    confirmationToken,
                })
            );
            if (result.status === 'needsConfirmation') {
                setSpeedup(result.confirmation);
                return;
            }
            if (result.status === 'invalid') {
                setAnalysis({ errors: result.errors, fixes: result.fixes });
                if (result.errors[0]) editorRef.current?.focusRange(result.errors[0].offset, result.errors[0].length);
                showNotice('warning', t('voice.tts.hasErrors'));
                return;
            }
            tts.addCandidate(result.candidate);
            if (result.candidate.adjusted.length > 0 || result.candidate.overflows.length > 0)
                setReport(result.candidate);
        } catch (error) {
            if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
            else showNotice('error', voiceErrorMessage(t, error), 12000);
        }
    };

    const startSynthesis = () => {
        const current = analyze(tts.text, tts.inputKind, language);
        setAnalysis(current);
        // 誤りがあれば合成を始めずに止め、該当箇所を示す
        if (current.errors.length > 0) {
            editorRef.current?.focusRange(current.errors[0].offset, current.errors[0].length);
            showNotice('warning', t('voice.tts.hasErrors'));
            return;
        }
        // 大文字小文字の違い・向き付き引用符は、一覧を示して一括で直してよいかを 1 回で確認する
        if (current.fixes.length > 0) {
            setFixConfirm(current.fixes);
            return;
        }
        if (!tts.text.trim()) {
            showNotice('warning', t('voice.tts.empty'));
            return;
        }
        void synthesize(tts.text);
    };

    const selected = tts.candidates.find(item => item.id === tts.selectedId) ?? null;
    // 候補の声の表示名 (一覧と同じ表示名。声のモデルを削除した後は、作成時の名前)
    const candidateVoiceName = (candidate: TtsCandidate) => {
        const voice = voices.find(item => item.id === candidate.voiceId);
        return voice ? voiceLabel(t, voice) : candidate.voiceName;
    };
    const exportEntries: ExportEntry[] = selected
        ? [
              {
                  key: 'tts',
                  label: t('voice.tts.exportLabel'),
                  suffix: t('voice.tts.suffix'),
                  resolve: async () => selected.media.path,
              },
          ]
        : [];

    return (
        <PageContainer>
            <VoiceFeatureHeader feature='tts' />
            <ReadinessAlert state={readiness} />
            {languageEngineMissing && (
                <Alert
                    severity='info'
                    action={
                        <Button
                            color='inherit'
                            size='small'
                            startIcon={<DownloadIcon />}
                            onClick={() =>
                                openVoiceLibrary({
                                    select: [ENGINE_ITEMS[LANGUAGE_DEFINITIONS[language].engines[0]]],
                                    focus: 'tts',
                                })
                            }
                        >
                            {t('voice.readiness.openLibrary')}
                        </Button>
                    }
                >
                    {t('voice.tts.engineMissing', { language: t(`voice.languages.${language}`) })}
                </Alert>
            )}

            <Stack direction='row' spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <Button
                    startIcon={<NoteAddIcon />}
                    onClick={() => (modified ? setConfirmNew(true) : tts.loadDocument('', 'text', null))}
                >
                    {t('voice.tts.newText')}
                </Button>
                <Button startIcon={<FolderOpenIcon />} onClick={() => void openFile()}>
                    {t('voice.tts.open')}
                </Button>
                <Button
                    startIcon={<SaveIcon />}
                    onClick={() => void saveFile(false)}
                    disabled={!modified && !!tts.filePath}
                >
                    {t('voice.tts.save')}
                </Button>
                <Button startIcon={<SaveAsIcon />} onClick={() => void saveFile(true)}>
                    {t('voice.tts.saveAs')}
                </Button>
                <FormControl size='small' sx={{ minWidth: 160 }}>
                    <InputLabel id='tts-kind'>{t('voice.tts.inputKind')}</InputLabel>
                    <Select
                        labelId='tts-kind'
                        label={t('voice.tts.inputKind')}
                        value={tts.inputKind}
                        onChange={event => tts.setInputKind(event.target.value as TtsInputKind)}
                    >
                        <MenuItem value='text'>{t('voice.tts.kinds.text')}</MenuItem>
                        <MenuItem value='srt'>SRT</MenuItem>
                        <MenuItem value='vtt'>WebVTT</MenuItem>
                    </Select>
                </FormControl>
                <Button startIcon={<CodeIcon />} onClick={() => setTagListOpen(true)}>
                    {t('voice.tags.open')}
                </Button>
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{ flexGrow: 1, textAlign: 'right', minWidth: 0 }}
                    noWrap
                    title={tts.filePath ?? ''}
                >
                    {tts.filePath ? `${tts.filePath}${modified ? ' *' : ''}` : modified ? t('voice.tts.unsaved') : ''}
                </Typography>
            </Stack>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' },
                    gap: 2,
                    flexGrow: 1,
                    minHeight: 360,
                }}
            >
                <Stack spacing={1} sx={{ minWidth: 0, minHeight: 320 }}>
                    <TagEditor
                        ref={editorRef}
                        value={tts.text}
                        onChange={tts.setText}
                        tagRanges={tagRanges}
                        errorRanges={errorRanges}
                        placeholder={
                            tts.inputKind === 'text' ? t('voice.tts.placeholder') : t('voice.tts.placeholderTimeline')
                        }
                    />
                    {analysis.errors.length > 0 && (
                        <Panel sx={{ maxHeight: 140, overflow: 'auto', p: 0 }}>
                            <List dense disablePadding>
                                {analysis.errors.map((error, index) => (
                                    <ListItemButton
                                        key={index}
                                        onClick={() => editorRef.current?.focusRange(error.offset, error.length)}
                                    >
                                        <ListItemText
                                            primary={t('voice.tts.errorAt', {
                                                line: error.line,
                                                column: error.column,
                                                message: tagIssueMessage(t, error),
                                            })}
                                            slotProps={{ primary: { variant: 'body2', color: 'error' } }}
                                        />
                                    </ListItemButton>
                                ))}
                            </List>
                        </Panel>
                    )}
                    {analysis.errors.length === 0 && analysis.fixes.length > 0 && (
                        <Alert severity='info'>{t('voice.tts.fixesPending', { count: analysis.fixes.length })}</Alert>
                    )}
                </Stack>

                <Panel sx={{ overflow: 'auto' }}>
                    <Stack spacing={2}>
                        <FormControl size='small'>
                            <InputLabel id='tts-language'>{t('voice.tts.language')}</InputLabel>
                            <Select
                                labelId='tts-language'
                                label={t('voice.tts.language')}
                                value={language}
                                onChange={event => tts.setLanguage(event.target.value as VoiceLanguage)}
                            >
                                {VOICE_LANGUAGES.map(item => (
                                    <MenuItem key={item} value={item}>
                                        {t(`voice.languages.${item}`)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl size='small' disabled={engines.length === 0}>
                            <InputLabel id='tts-engine'>{t('voice.tts.engine')}</InputLabel>
                            <Select
                                labelId='tts-engine'
                                label={t('voice.tts.engine')}
                                value={engine ?? ''}
                                onChange={event => tts.setEngine(event.target.value as TtsEngineId)}
                            >
                                {engines.map(item => (
                                    <MenuItem key={item} value={item}>
                                        {t(`voice.engine.${item}`)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {status && missingEngines.length > 0 && (
                            <Button
                                size='small'
                                startIcon={<DownloadIcon />}
                                onClick={() =>
                                    openVoiceLibrary({
                                        select: missingEngines.map(item => ENGINE_ITEMS[item]),
                                        focus: 'tts',
                                    })
                                }
                                sx={{ alignSelf: 'flex-start' }}
                            >
                                {t('voice.tts.getEngines')}
                            </Button>
                        )}
                        <FormControl size='small' disabled={candidatesVoices.length === 0}>
                            <InputLabel id='tts-voice'>{t('voice.tts.voice')}</InputLabel>
                            <Select
                                labelId='tts-voice'
                                label={t('voice.tts.voice')}
                                value={voice?.id ?? ''}
                                onChange={event => tts.setVoiceId(String(event.target.value))}
                            >
                                {candidatesVoices.map(item => (
                                    <MenuItem key={item.id} value={item.id}>
                                        {voiceLabel(t, item)}
                                        <Typography
                                            component='span'
                                            variant='caption'
                                            color='text.secondary'
                                            sx={{ ml: 1 }}
                                        >
                                            {t(`voice.models.categories.${item.category}`)}
                                        </Typography>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {engine && candidatesVoices.length === 0 && (
                            <Alert severity='info'>{t('voice.tts.noVoices')}</Alert>
                        )}
                        <FormControl size='small' disabled={!voice}>
                            <InputLabel id='tts-style'>{t('voice.tts.style')}</InputLabel>
                            <Select
                                labelId='tts-style'
                                label={t('voice.tts.style')}
                                value={styles.includes(tts.params.style) ? tts.params.style : styles[0]}
                                onChange={event => tts.setParams({ ...tts.params, style: String(event.target.value) })}
                            >
                                {styles.map(style => (
                                    <MenuItem key={style} value={style}>
                                        {style}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {speakers.length > 1 && (
                            <FormControl size='small'>
                                <InputLabel id='tts-speaker'>{t('voice.tts.speaker')}</InputLabel>
                                <Select
                                    labelId='tts-speaker'
                                    label={t('voice.tts.speaker')}
                                    value={tts.params.speakerId}
                                    onChange={event =>
                                        tts.setParams({ ...tts.params, speakerId: Number(event.target.value) })
                                    }
                                >
                                    {speakers.map((speaker, index) => (
                                        <MenuItem key={speaker} value={index}>
                                            {speaker}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        <SliderField
                            label={t('voice.tts.styleWeight')}
                            value={tts.params.styleWeight}
                            min={0}
                            max={10}
                            step={0.1}
                            format={v => v.toFixed(1)}
                            onChange={styleWeight => tts.setParams({ ...tts.params, styleWeight })}
                        />
                        <SliderField
                            label={t('voice.tts.speed')}
                            value={tts.params.speed}
                            min={0.5}
                            max={2}
                            step={0.05}
                            format={v => `${v.toFixed(2)}x`}
                            onChange={speed => tts.setParams({ ...tts.params, speed })}
                        />
                        <SliderField
                            label={t('voice.tts.pitchScale')}
                            value={tts.params.pitchScale}
                            min={0.7}
                            max={1.3}
                            step={0.01}
                            format={v => v.toFixed(2)}
                            onChange={pitchScale => tts.setParams({ ...tts.params, pitchScale })}
                        />
                        <SliderField
                            label={t('voice.tts.intonationScale')}
                            value={tts.params.intonationScale}
                            min={0}
                            max={2}
                            step={0.05}
                            format={v => v.toFixed(2)}
                            onChange={intonationScale => tts.setParams({ ...tts.params, intonationScale })}
                        />
                        <Button
                            size='small'
                            color='inherit'
                            startIcon={advanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            aria-expanded={advanced}
                            onClick={() => setAdvanced(value => !value)}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            {t('voice.tts.advanced')}
                        </Button>
                        <Collapse in={advanced} unmountOnExit>
                            <Stack spacing={1}>
                                <SliderField
                                    label={t('voice.tts.sdpRatio')}
                                    value={tts.params.sdpRatio}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    format={v => v.toFixed(2)}
                                    onChange={sdpRatio => tts.setParams({ ...tts.params, sdpRatio })}
                                />
                                <SliderField
                                    label={t('voice.tts.noise')}
                                    value={tts.params.noise}
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    format={v => v.toFixed(2)}
                                    onChange={noise => tts.setParams({ ...tts.params, noise })}
                                />
                                <SliderField
                                    label={t('voice.tts.noiseW')}
                                    value={tts.params.noiseW}
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    format={v => v.toFixed(2)}
                                    onChange={noiseW => tts.setParams({ ...tts.params, noiseW })}
                                />
                                {tts.inputKind === 'text' && (
                                    <SliderField
                                        label={t('voice.tts.paragraphPause')}
                                        value={tts.params.paragraphPause}
                                        min={0}
                                        max={3}
                                        step={0.1}
                                        format={v => `${v.toFixed(1)}s`}
                                        onChange={paragraphPause => tts.setParams({ ...tts.params, paragraphPause })}
                                    />
                                )}
                            </Stack>
                        </Collapse>
                        <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                            <FormControlLabel
                                sx={{ flexGrow: 1 }}
                                control={
                                    <Switch
                                        size='small'
                                        checked={tts.readSymbols}
                                        onChange={(_e, value) => tts.setReadSymbols(value)}
                                    />
                                }
                                label={t('voice.tts.readSymbols')}
                            />
                            <Tooltip title={t('voice.symbols.edit')}>
                                <IconButton
                                    size='small'
                                    aria-label={t('voice.symbols.edit')}
                                    onClick={() => setSymbolsOpen(true)}
                                >
                                    <EditNoteIcon fontSize='small' />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                        {tts.inputKind !== 'text' && (
                            <Stack spacing={1}>
                                <FormControl size='small'>
                                    <InputLabel id='tts-overflow'>{t('voice.tts.overflowMode')}</InputLabel>
                                    <Select
                                        labelId='tts-overflow'
                                        label={t('voice.tts.overflowMode')}
                                        value={tts.overflowMode}
                                        onChange={event =>
                                            tts.setOverflowMode(event.target.value as TimelineOverflowMode)
                                        }
                                    >
                                        {OVERFLOW_MODES.map(mode => (
                                            <MenuItem key={mode} value={mode}>
                                                {t(`voice.tts.overflow.${mode}`)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <Button size='small' disabled={cues.length === 0} onClick={() => setCuesOpen(true)}>
                                    {t('voice.tts.cueSettings', { count: Object.keys(tts.cueOverflowModes).length })}
                                </Button>
                            </Stack>
                        )}
                        <Button
                            variant='contained'
                            startIcon={<CampaignIcon />}
                            disabled={busy || !ready}
                            onClick={startSynthesis}
                        >
                            {t('voice.tts.run')}
                        </Button>
                    </Stack>
                </Panel>
            </Box>

            <Box>
                <SectionLabel
                    action={
                        <Stack direction='row' spacing={1}>
                            <Button
                                size='small'
                                startIcon={<RecordVoiceOverIcon />}
                                disabled={!selected}
                                onClick={() => {
                                    if (!selected) return;
                                    useVoiceHandoffStore.getState().send({
                                        from: 'tts',
                                        name: tts.filePath?.split(/[\\/]/).pop() ?? t('voice.tts.suffix'),
                                        sourcePath: tts.filePath ?? 'tts',
                                        sourceMedia: selected.media,
                                        vocals: selected.media.path,
                                        accompaniment: [],
                                        channels: 1,
                                    });
                                    navigate('/audio/conversion');
                                }}
                            >
                                {t('voice.tts.sendToConversion')}
                            </Button>
                            <Button
                                size='small'
                                variant='contained'
                                startIcon={<SaveAltIcon />}
                                disabled={!selected}
                                onClick={() => setExportOpen(true)}
                            >
                                {t('voice.export.open')}
                            </Button>
                        </Stack>
                    }
                >
                    {t('voice.tts.candidates')}
                </SectionLabel>
                <Panel disablePadding sx={{ maxHeight: 220, overflow: 'auto' }}>
                    {tts.candidates.length === 0 ? (
                        <Typography variant='body2' color='text.secondary' sx={{ p: 2 }}>
                            {t('voice.tts.noCandidates')}
                        </Typography>
                    ) : (
                        <Table size='small' stickyHeader>
                            <TableBody>
                                {tts.candidates.map(candidate => (
                                    <TableRow
                                        key={candidate.id}
                                        hover
                                        selected={candidate.id === tts.selectedId}
                                        onClick={() => tts.select(candidate.id)}
                                        sx={{ cursor: 'pointer' }}
                                    >
                                        <TableCell>
                                            <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                                {candidateVoiceName(candidate)}
                                            </Typography>
                                            <Typography variant='caption' color='text.secondary'>
                                                {t('voice.tts.paramsSummary', {
                                                    style: candidate.params.style,
                                                    weight: candidate.params.styleWeight.toFixed(1),
                                                    speed: candidate.params.speed.toFixed(2),
                                                    pitch: candidate.params.pitchScale.toFixed(2),
                                                    intonation: candidate.params.intonationScale.toFixed(2),
                                                })}
                                            </Typography>
                                        </TableCell>
                                        <TableCell padding='checkbox'>
                                            <Tooltip title={t('voice.common.deleteCandidate')}>
                                                <IconButton
                                                    size='small'
                                                    aria-label={t('voice.common.deleteCandidate')}
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        tts.removeCandidate(candidate.id);
                                                        void window.kuraToolkit.voice.media.discard([
                                                            candidate.media.path,
                                                        ]);
                                                    }}
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
            </Box>
            <SyncPlayer
                source={
                    selected
                        ? {
                              key: selected.id,
                              url: selected.media.url,
                              label: candidateVoiceName(selected),
                          }
                        : null
                }
                emptyHint={t('voice.tts.playHint')}
            />

            <TagListDialog
                open={tagListOpen}
                language={language}
                onClose={() => setTagListOpen(false)}
                onInsert={example => {
                    if (example.after)
                        editorRef.current?.wrap(example.before, example.after, example.placeholder ?? '');
                    else editorRef.current?.insert(example.before);
                }}
            />
            <SymbolReadingsDialog open={symbolsOpen} language={language} onClose={() => setSymbolsOpen(false)} />

            <AppDialog open={cuesOpen} onClose={() => setCuesOpen(false)} maxWidth='md' fullWidth>
                <DialogTitle>{t('voice.tts.cueSettingsTitle')}</DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <Table size='small' stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell>{t('voice.tts.cueTime')}</TableCell>
                                <TableCell>{t('voice.tts.cueText')}</TableCell>
                                <TableCell sx={{ width: 200 }}>{t('voice.tts.overflowMode')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {cues.map(cue => (
                                <TableRow key={cue.index}>
                                    <TableCell>{cue.index}</TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                        {formatTimestamp(cue.start)} - {formatTimestamp(cue.end)}
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 320 }}>
                                        <Typography variant='body2' noWrap title={cue.text}>
                                            {cue.text}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            size='small'
                                            fullWidth
                                            value={tts.cueOverflowModes[cue.index] ?? 'default'}
                                            onChange={event => {
                                                const value = event.target.value as TimelineOverflowMode | 'default';
                                                const next = { ...tts.cueOverflowModes };
                                                if (value === 'default') delete next[cue.index];
                                                else next[cue.index] = value;
                                                tts.setCueOverflowModes(next);
                                            }}
                                        >
                                            <MenuItem value='default'>{t('voice.tts.overflowDefault')}</MenuItem>
                                            {OVERFLOW_MODES.map(mode => (
                                                <MenuItem key={mode} value={mode}>
                                                    {t(`voice.tts.overflow.${mode}`)}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCuesOpen(false)}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={fixConfirm !== null} onClose={() => setFixConfirm(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.tts.fixTitle')}</DialogTitle>
                <DialogContent dividers>
                    <Typography variant='body2' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.tts.fixMessage')}
                    </Typography>
                    {fixConfirm?.map((fix, index) => (
                        <Typography
                            key={index}
                            variant='body2'
                            color='text.secondary'
                            sx={{ fontFamily: 'Consolas, Menlo, monospace' }}
                        >
                            {t('voice.tts.fixItem', {
                                line: fix.line,
                                column: fix.column,
                                from: fix.original,
                                to: fix.replacement,
                                kind: t(`voice.tts.fixKinds.${fix.code}`),
                            })}
                        </Typography>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFixConfirm(null)}>{t('voice.tts.fixReject')}</Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            const fixed = applyTagFixes(tts.text, fixConfirm ?? []);
                            setFixConfirm(null);
                            tts.setText(fixed);
                            const next = analyze(fixed, tts.inputKind, language);
                            setAnalysis(next);
                            if (next.errors.length > 0 || next.fixes.length > 0) {
                                showNotice('warning', t('voice.tts.hasErrors'));
                                return;
                            }
                            void synthesize(fixed);
                        }}
                    >
                        {t('voice.tts.fixAccept')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={speedup !== null} onClose={() => undefined} maxWidth='md' fullWidth>
                <DialogTitle>{t('voice.tts.speedupTitle')}</DialogTitle>
                <DialogContent dividers>
                    <Typography variant='body2' sx={{ mb: 1, lineHeight: 1.6 }}>
                        {t('voice.tts.speedupMessage')}
                    </Typography>
                    <Table size='small'>
                        <TableHead>
                            <TableRow>
                                <TableCell>#</TableCell>
                                <TableCell>{t('voice.tts.cueTime')}</TableCell>
                                <TableCell>{t('voice.tts.cueText')}</TableCell>
                                <TableCell align='right'>{t('voice.tts.factor')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {speedup?.items.map(item => (
                                <TableRow key={item.index}>
                                    <TableCell>{item.index}</TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                        {formatTimestamp(item.start)} - {formatTimestamp(item.end)}
                                    </TableCell>
                                    <TableCell sx={{ maxWidth: 320 }}>
                                        <Typography variant='body2' noWrap title={item.text}>
                                            {item.text}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align='right'>{item.factor.toFixed(2)}x</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => {
                            if (speedup) void window.kuraToolkit.voice.tts.cancelConfirmation(speedup.token);
                            setSpeedup(null);
                        }}
                    >
                        {t('voice.tts.speedupReject')}
                    </Button>
                    <Button
                        variant='contained'
                        onClick={() => {
                            const token = speedup?.token;
                            setSpeedup(null);
                            if (token) void synthesize(tts.text, token);
                        }}
                    >
                        {t('voice.tts.speedupAccept')}
                    </Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={report !== null} onClose={() => setReport(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('voice.tts.reportTitle')}</DialogTitle>
                <DialogContent dividers>
                    {report && report.adjusted.length > 0 && (
                        <>
                            <Typography variant='body2' sx={{ mb: 0.5 }}>
                                {t('voice.tts.reportAdjusted')}
                            </Typography>
                            {report.adjusted.map(item => (
                                <Typography key={item.index} variant='body2' color='text.secondary'>
                                    {t('voice.tts.reportAdjustedItem', {
                                        index: item.index,
                                        factor: item.factor.toFixed(2),
                                    })}
                                </Typography>
                            ))}
                        </>
                    )}
                    {report && report.overflows.length > 0 && (
                        <>
                            <Typography variant='body2' sx={{ mt: 1.5, mb: 0.5 }}>
                                {t('voice.tts.reportOverflows')}
                            </Typography>
                            {report.overflows.map(item => (
                                <Typography key={item.index} variant='body2' color='text.secondary'>
                                    {t('voice.tts.reportOverflowItem', {
                                        index: item.index,
                                        seconds: item.overflowSec.toFixed(2),
                                    })}
                                </Typography>
                            ))}
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setReport(null)}>{t('common.close')}</Button>
                </DialogActions>
            </AppDialog>

            <AppDialog open={confirmNew} onClose={() => setConfirmNew(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{t('voice.tts.newText')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2'>{t('voice.tts.discardChanges')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmNew(false)}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            tts.loadDocument('', 'text', null);
                            setConfirmNew(false);
                        }}
                    >
                        {t('voice.common.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {selected && (
                <ExportDialog
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    entries={exportEntries}
                    sourcePath={tts.filePath ?? t('voice.tts.defaultFileName')}
                />
            )}
            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                message={job?.message ?? ''}
                onCancel={cancel}
            />
        </PageContainer>
    );
}
