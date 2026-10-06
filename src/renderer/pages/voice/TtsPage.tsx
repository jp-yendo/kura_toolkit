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
import DownloadIcon from '@mui/icons-material/Download';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../components/common/PageContainer';
import Panel from '../../components/common/Panel';
import AppDialog from '../../components/common/AppDialog';
import ProgressDialog from '../../components/common/ProgressDialog';
import ReadinessAlert, { useFeatureReadiness } from '../../components/voice/ReadinessAlert';
import VoiceFeatureHeader from '../../components/voice/VoiceFeatureHeader';
import UserModelIcon from '../../components/voice/UserModelIcon';
import TagEditor, { type TagEditorHandle } from '../../components/voice/TagEditor';
import TimedLinesEditor from '../../components/voice/TimedLinesEditor';
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
import { timedSnapshot, useTtsStore, type TimedRow } from '../../stores/ttsStore';
import { openVoiceLibrary, useVoiceLibraryStore } from '../../stores/voiceLibraryStore';
import { applyTagFixes, findTagRanges, parseControlTags, type TagFix, type TagIssue } from '@shared/voice/control-tags';
import {
    formatSrt,
    formatTimestamp,
    parseSubtitleFile,
    parseTimeInput,
    subtitleFormatOf,
    SUBTITLE_EXTENSIONS,
    validateTimedLines,
    type TimedLineIssue,
    type TimedLineIssueCode,
} from '@shared/voice/timed-text';
import {
    LANGUAGE_DEFINITIONS,
    TTS_LANGUAGE_MODEL_ITEMS,
    VOICE_LANGUAGES,
    type TtsModelType,
    type VoiceLanguage,
} from '@shared/voice/languages';
import type {
    LibraryStatus,
    SpeedupConfirmation,
    TimedLine,
    TimelineOverflowMode,
    TtsAudio,
    TtsInputMode,
    VoiceModelInfo,
} from '@shared/voice/types';
import type { TFunction } from 'i18next';

const OVERFLOW_MODES: TimelineOverflowMode[] = ['speedup', 'overlap', 'shift', 'warn'];
const INPUT_MODES: TtsInputMode[] = ['normal', 'timed'];
// 入力方法ごとのファイルの種類 (通常はテキスト、タイミング指定の保存は SRT だけ)
const TEXT_EXTENSIONS = ['txt'];
const SAVE_EXTENSION: Record<TtsInputMode, string> = { normal: 'txt', timed: 'srt' };
const SAVE_FILTER_KEYS: Record<TtsInputMode, string> = {
    normal: 'voice.fileFilters.text',
    timed: 'voice.fileFilters.srt',
};

// 制御タグの誤りと一括で直せる注意。タイミング指定では、それぞれが行の番号 (row) を持つ
type Analysis = { errors: TagIssue[]; fixes: TagFix[] };

function analyzeNormal(text: string, language: VoiceLanguage): Analysis {
    const parsed = parseControlTags(text, { language });
    return { errors: parsed.errors, fixes: parsed.fixes };
}

function analyzeTimed(rows: TimedRow[], language: VoiceLanguage): Analysis {
    const errors: TagIssue[] = [];
    const fixes: TagFix[] = [];
    rows.forEach((row, index) => {
        const parsed = parseControlTags(row.text, { language, timed: true });
        errors.push(...parsed.errors.map(issue => ({ ...issue, row: index + 1 })));
        fixes.push(...parsed.fixes.map(fix => ({ ...fix, row: index + 1 })));
    });
    return { errors, fixes };
}

// 行の時間 (読めない場合は null) とテキスト
function parsedRows(rows: TimedRow[]) {
    return rows.map(row => ({ start: parseTimeInput(row.start), end: parseTimeInput(row.end), text: row.text }));
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

// 読み上げる言語の言語モデル (BERT) を取得済みか。どちらの形式の声も、読み上げる言語のものだけを使う
function languageInstalled(status: LibraryStatus | null, language: VoiceLanguage): boolean {
    return status?.items.find(item => item.id === TTS_LANGUAGE_MODEL_ITEMS[language])?.status === 'installed';
}

export default function TtsPage() {
    const { t } = useTranslation();
    const readiness = useFeatureReadiness('tts');
    const { settings } = useSettingsStore();
    const tts = useTtsStore();
    const editorRef = React.useRef<TagEditorHandle>(null);
    // タイミング指定の行のテキストの入力欄 (行の ID -> 入力欄) と、最後に操作した行
    const rowEditorsRef = React.useRef(new Map<string, TagEditorHandle>());
    const focusedRowRef = React.useRef<string | null>(null);
    const [voices, setVoices] = React.useState<VoiceModelInfo[]>([]);
    const [analysis, setAnalysis] = React.useState<Analysis>({ errors: [], fixes: [] });
    const [tagListOpen, setTagListOpen] = React.useState(false);
    const [symbolsOpen, setSymbolsOpen] = React.useState(false);
    const [fixConfirm, setFixConfirm] = React.useState<TagFix[] | null>(null);
    const [speedup, setSpeedup] = React.useState<SpeedupConfirmation | null>(null);
    const [report, setReport] = React.useState<TtsAudio | null>(null);
    const [exportOpen, setExportOpen] = React.useState(false);
    // 変更を破棄してよいかの確認 (新しい文章・ファイルを開く)。閉じる間も表示が変わらないよう、開閉とは別に持つ
    const [discardConfirm, setDiscardConfirm] = React.useState<{ open: boolean; action: 'new' | 'open' }>({
        open: false,
        action: 'new',
    });
    const [advanced, setAdvanced] = React.useState(false);
    const { job, run, cancel } = useJobRunner();
    const status = readiness.status;
    const libraryVersion = useVoiceLibraryStore(state => state.version);

    const language: VoiceLanguage = tts.language ?? (settings?.app.language === 'en' ? 'en' : 'ja');
    const languageReady = languageInstalled(status, language);
    const modelTypes = languageReady ? LANGUAGE_DEFINITIONS[language].modelTypes : [];
    const modelType: TtsModelType | null =
        tts.modelType && modelTypes.includes(tts.modelType) ? tts.modelType : (modelTypes[0] ?? null);
    // 機能全体の不足 (ReadinessAlert) を案内している間は出さない (同じ案内が重なるため)。
    // 日本語の言語モデルはそろっているが英語の言語モデルが無い、といった場合に出す
    const languageModelMissing = status !== null && (readiness.readiness?.ready ?? false) && !languageReady;
    const candidatesVoices = voices.filter(
        voice => voice.tts?.modelType === modelType && voice.tts.languages.includes(language)
    );
    const voice = candidatesVoices.find(item => item.id === tts.voiceId) ?? candidatesVoices[0] ?? null;
    // スタイルはモデルが持つものだけを使う (モデルに無ければ選べない)
    const styles = voice?.tts?.styles ?? [];
    const style = styles.includes(tts.params.style) ? tts.params.style : (styles[0] ?? '');
    const speakers = voice?.tts?.speakers ?? [];
    // 話者はモデルごとに違うため、選んでいるモデルに無い番号 (別のモデルで選んだもの) は最初の話者にする
    const speakerId = tts.params.speakerId < speakers.length ? tts.params.speakerId : 0;
    const timedMode = tts.inputMode === 'timed';
    const rows = tts.timed.rows;

    // 画面を開いたときと、すぐに使えるモデルや言語モデルをダウンロードしたときに読み直す
    React.useEffect(() => {
        let cancelled = false;
        window.kuraToolkit.voice.models
            .list('tts')
            .then(list => {
                if (!cancelled) setVoices(list);
            })
            .catch(error => {
                if (!cancelled) showNotice('error', voiceErrorMessage(t, error), 12000);
            });
        return () => {
            cancelled = true;
        };
    }, [libraryVersion, t]);

    const analyzeCurrent = React.useCallback(
        (): Analysis => (timedMode ? analyzeTimed(rows, language) : analyzeNormal(tts.normal.text, language)),
        [timedMode, rows, tts.normal.text, language]
    );

    // 入力中も随時チェックする (打つたびに解析すると重いので少し待ってから)。
    // 入力方法や言語を切り替えたときは、前の内容の誤りが残って見えないようにすぐにチェックする
    const analyzedForRef = React.useRef(`${tts.inputMode}:${language}`);
    React.useEffect(() => {
        const analyzedFor = `${tts.inputMode}:${language}`;
        if (analyzedForRef.current !== analyzedFor) {
            analyzedForRef.current = analyzedFor;
            setAnalysis(analyzeCurrent());
            return undefined;
        }
        const timer = window.setTimeout(() => setAnalysis(analyzeCurrent()), 250);
        return () => window.clearTimeout(timer);
    }, [analyzeCurrent, tts.inputMode, language]);

    // タイミング指定の時間とテキストの誤り (表の欄を赤く示す)
    const timingIssues = React.useMemo(
        () => (timedMode ? validateTimedLines(parsedRows(rows)) : []),
        [timedMode, rows]
    );
    const issuesByRow = React.useMemo(() => {
        const map = new Map<string, TimedLineIssueCode[]>();
        for (const issue of timingIssues) {
            const id = rows[issue.row - 1]?.id;
            if (id) map.set(id, [...(map.get(id) ?? []), issue.code]);
        }
        return map;
    }, [timingIssues, rows]);
    const tagErrorRangesByRow = React.useMemo(() => {
        const map = new Map<string, { start: number; end: number }[]>();
        for (const error of analysis.errors) {
            const id = error.row ? rows[error.row - 1]?.id : undefined;
            if (id) map.set(id, [...(map.get(id) ?? []), { start: error.offset, end: error.offset + error.length }]);
        }
        return map;
    }, [analysis.errors, rows]);

    const tagRanges = React.useMemo(() => findTagRanges(tts.normal.text), [tts.normal.text]);
    const errorRanges = timedMode
        ? []
        : analysis.errors.map(error => ({ start: error.offset, end: error.offset + error.length }));
    // 保存先と、開いたファイル (保存先にしない字幕ファイルを含む。表示と保存するときの名前の候補に使う)
    const filePath = timedMode ? tts.timed.filePath : tts.normal.filePath;
    const openedPath = timedMode ? (tts.timed.filePath ?? tts.timed.sourcePath) : tts.normal.filePath;
    const modified = timedMode
        ? timedSnapshot(rows) !== tts.timed.savedSnapshot
        : tts.normal.text !== tts.normal.savedText;
    const busy = job !== null;
    const ready = (readiness.readiness?.ready ?? false) && !!modelType && !!voice;

    // 誤りの位置へ移る (タイミング指定では、その行のテキストの入力欄)
    const focusIssue = (issue: TagIssue) => {
        if (issue.row) {
            const id = rows[issue.row - 1]?.id;
            if (id) rowEditorsRef.current.get(id)?.focusRange(issue.offset, issue.length);
            return;
        }
        editorRef.current?.focusRange(issue.offset, issue.length);
    };
    // 時間とテキストの誤りの欄へ移る (時間の誤りはその時間の欄、テキストの誤りはテキストの欄)
    const focusTimingIssue = (issue: TimedLineIssue) => {
        const id = rows[issue.row - 1]?.id;
        if (!id) return;
        const field =
            issue.code === 'startFormat' || issue.code === 'startAfterLater'
                ? 'start'
                : issue.code === 'endFormat' || issue.code === 'endBeforeStart'
                  ? 'end'
                  : null;
        if (!field) {
            rowEditorsRef.current.get(id)?.focusRange(0, 0);
            return;
        }
        document.querySelector<HTMLInputElement>(`[data-time-field="${id}:${field}"]`)?.focus();
    };

    // --- ファイル ---
    const closeDiscardConfirm = () => setDiscardConfirm(previous => ({ ...previous, open: false }));

    const newDocument = () => {
        if (timedMode) tts.loadTimed([], null, true);
        else tts.loadNormal('', null);
    };

    const openFile = async () => {
        const paths = await window.kuraToolkit.dialog.openFiles({
            filters: timedMode
                ? [{ name: t('voice.fileFilters.subtitles'), extensions: SUBTITLE_EXTENSIONS }]
                : [{ name: t('voice.fileFilters.text'), extensions: TEXT_EXTENSIONS }],
        });
        const target = paths[0];
        if (!target) return;
        try {
            const text = await window.kuraToolkit.voice.tts.loadText(target, language);
            if (!timedMode) {
                tts.loadNormal(text, target);
                return;
            }
            // 字幕ファイルは表へ展開し、元の形式は覚えない。保存は SRT で行うため、SRT のファイルだけを保存先として残す
            const format = subtitleFormatOf(target);
            if (!format) {
                showNotice('error', t('voice.tts.timed.unsupportedFile'));
                return;
            }
            const parsed = parseSubtitleFile(text, format);
            if (parsed.lines.length === 0) {
                showNotice('error', t('voice.tts.timed.noLines'));
                return;
            }
            // 読み込んだ内容がファイルと同じになる SRT だけを、保存先として持つ (読み飛ばした区間がある場合は、
            // 上書きでその区間を消さないよう保存先にせず、保存していない内容として扱う)
            const sameAsFile = format === 'srt' && parsed.skipped === 0;
            tts.loadTimed(parsed.lines, sameAsFile ? target : null, sameAsFile, target);
            if (parsed.skipped > 0) showNotice('warning', t('voice.tts.timed.skipped', { count: parsed.skipped }));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    const saveFile = async (saveAs: boolean) => {
        let content: string;
        if (timedMode) {
            // 時間を読めない行があると SRT に書けないため、その行を示して止める
            const lines = parsedRows(rows);
            const unreadable = lines.findIndex(line => line.start === null || line.end === null);
            if (unreadable >= 0) {
                showNotice('warning', t('voice.tts.timed.saveInvalidTime', { row: unreadable + 1 }));
                return;
            }
            content = formatSrt(lines as TimedLine[]);
        } else {
            content = tts.normal.text;
        }
        let target = filePath;
        if (saveAs || !target) {
            const ext = SAVE_EXTENSION[tts.inputMode];
            // 保存したことが無い文章は、名前を入れずに保存ダイアログを開く (勝手な名前を付けない)。
            // 開いたファイルを保存先にしていない場合 (一部を読めなかった SRT など)、同じファイルを候補にすると
            // 上書きで読めなかった部分を消してしまうため、そのフォルダだけを示す
            const suggested = openedPath ? `${openedPath.replace(/\.[^.\\/]*$/, '')}.${ext}` : undefined;
            const overwritesSource =
                suggested !== undefined && !filePath && suggested.toLowerCase() === openedPath?.toLowerCase();
            target = await window.kuraToolkit.dialog.saveFile({
                defaultPath: overwritesSource ? openedPath?.replace(/[\\/][^\\/]*$/, '') : suggested,
                filters: [{ name: t(SAVE_FILTER_KEYS[tts.inputMode]), extensions: [ext] }],
            });
            if (!target) return;
        }
        try {
            await window.kuraToolkit.voice.tts.saveText(target, content);
            if (timedMode) tts.markTimedSaved(target);
            else tts.markNormalSaved(target);
            showNotice('success', t('voice.tts.saved'));
        } catch (error) {
            showNotice('error', voiceErrorMessage(t, error));
        }
    };

    // --- 合成 ---
    const synthesize = async (input: { text: string; rows: TimedRow[] }, confirmationToken?: string) => {
        if (!modelType || !voice) return;
        try {
            const result = await run(t('voice.tts.running'), jobId =>
                window.kuraToolkit.voice.tts.run(jobId, {
                    workKey: tts.workKey,
                    modelType,
                    language,
                    voiceId: voice.id,
                    params: { ...tts.params, style, speakerId },
                    readSymbols: tts.readSymbols,
                    symbolReadings: symbolReadingsFor(settings, language),
                    inputMode: tts.inputMode,
                    text: timedMode ? '' : input.text,
                    lines: timedMode ? (parsedRows(input.rows) as TimedLine[]) : [],
                    overflowMode: tts.overflowMode,
                    confirmationToken,
                })
            );
            if (result.status === 'needsConfirmation') {
                setSpeedup(result.confirmation);
                return;
            }
            if (result.status === 'invalid') {
                setAnalysis({ errors: result.errors, fixes: result.fixes });
                if (result.errors[0]) focusIssue(result.errors[0]);
                showNotice('warning', t('voice.tts.hasErrors'));
                return;
            }
            // 作成した音声で前の音声を置き換える (前の音声のファイルは要らなくなるため消す)
            const previous = tts.result;
            tts.setResult(result.audio, openedPath);
            if (previous) void window.kuraToolkit.voice.media.discard(tts.workKey, [previous.media.path]);
            if (result.audio.adjusted.length > 0 || result.audio.overflows.length > 0) setReport(result.audio);
        } catch (error) {
            if (isCancelledError(error)) showNotice('warning', t('voice.common.cancelled'));
            else showNotice('error', voiceErrorMessage(t, error), 12000);
        }
    };

    const startSynthesis = () => {
        if (timedMode ? rows.length === 0 : !tts.normal.text.trim()) {
            showNotice('warning', t(timedMode ? 'voice.tts.timed.empty' : 'voice.tts.empty'));
            return;
        }
        // 時間とテキストの誤りがあれば始めない (赤く示した欄を直してもらう)
        if (timingIssues.length > 0) {
            focusTimingIssue(timingIssues[0]);
            showNotice('warning', t('voice.tts.hasErrors'));
            return;
        }
        const current = analyzeCurrent();
        setAnalysis(current);
        // 誤りがあれば合成を始めずに止め、該当箇所を示す
        if (current.errors.length > 0) {
            focusIssue(current.errors[0]);
            showNotice('warning', t('voice.tts.hasErrors'));
            return;
        }
        // 大文字小文字の違い・向き付き引用符は、一覧を示して一括で直してよいかを 1 回で確認する
        if (current.fixes.length > 0) {
            setFixConfirm(current.fixes);
            return;
        }
        void synthesize({ text: tts.normal.text, rows });
    };

    // 一括で直せる注意を直す (タイミング指定では行ごとに直す)
    const applyFixes = (fixes: TagFix[]): { text: string; rows: TimedRow[] } => {
        if (!timedMode) {
            const text = applyTagFixes(tts.normal.text, fixes);
            tts.setText(text);
            return { text, rows };
        }
        const nextRows = rows.map((row, index) => {
            const rowFixes = fixes.filter(fix => fix.row === index + 1);
            return rowFixes.length > 0 ? { ...row, text: applyTagFixes(row.text, rowFixes) } : row;
        });
        nextRows.forEach((row, index) => {
            if (row.text !== rows[index].text) tts.updateRow(row.id, { text: row.text });
        });
        return { text: tts.normal.text, rows: nextRows };
    };

    // 制御タグの一覧から選んだ例を、入力中の欄に入れる (タイミング指定では最後に操作した行)
    const insertExample = (example: { before: string; after?: string; placeholder?: string }) => {
        let editor: TagEditorHandle | null | undefined = editorRef.current;
        if (timedMode) {
            const id =
                focusedRowRef.current && rows.some(row => row.id === focusedRowRef.current)
                    ? focusedRowRef.current
                    : rows[0]?.id;
            editor = id ? rowEditorsRef.current.get(id) : null;
            if (!editor) {
                showNotice('info', t('voice.tts.timed.addRowFirst'));
                return;
            }
        }
        if (example.after) editor?.wrap(example.before, example.after, example.placeholder ?? '');
        else editor?.insert(example.before);
    };

    const selected = tts.result;
    // 作成した音声の声の表示名 (一覧と同じ表示名。声のモデルを削除した後は、作成時の名前)
    const resultVoiceName = (result: TtsAudio) => {
        const voice = voices.find(item => item.id === result.voiceId);
        return voice ? voiceLabel(voice) : result.voiceName;
    };
    // 書き出しの既定のファイル名: モデル名_スタイル_作成日時 (スタイルを持たないモデルはモデル名_作成日時)
    const exportBaseName = (audio: TtsAudio) => {
        const created = new Date(audio.createdAt);
        const pad = (value: number) => String(value).padStart(2, '0');
        const stamp =
            `${created.getFullYear()}${pad(created.getMonth() + 1)}${pad(created.getDate())}-` +
            `${pad(created.getHours())}${pad(created.getMinutes())}${pad(created.getSeconds())}`;
        return [resultVoiceName(audio), audio.params.style, stamp].filter(Boolean).join('_');
    };
    const exportEntries: ExportEntry[] = selected
        ? [
              {
                  key: 'tts',
                  label: t('voice.tts.exportLabel'),
                  // 書き出すのは 1 つだけのため、接尾辞は付けない (名前は exportBaseName で決める)
                  suffix: '',
                  resolve: async () => selected.media.path,
              },
          ]
        : [];

    return (
        // ページをウィンドウの高さに収める。再生の行は下に置いたままにし、入力と設定の部分の高さを残りに合わせる
        // (ウィンドウが極端に低い場合だけ、ページ全体をスクロールさせる)
        <PageContainer sx={{ height: '100%', minHeight: 640 }}>
            <VoiceFeatureHeader feature='tts' />
            <ReadinessAlert state={readiness} />
            {languageModelMissing && (
                <Alert
                    severity='info'
                    action={
                        <Button
                            color='inherit'
                            size='small'
                            startIcon={<DownloadIcon />}
                            onClick={() =>
                                openVoiceLibrary({
                                    select: [TTS_LANGUAGE_MODEL_ITEMS[language]],
                                    focus: 'tts',
                                })
                            }
                        >
                            {t('voice.readiness.openLibrary')}
                        </Button>
                    }
                >
                    {t('voice.tts.languageModelMissing', { language: t(`voice.languages.${language}`) })}
                </Alert>
            )}

            <Stack direction='row' spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <FormControl size='small' sx={{ minWidth: 160 }}>
                    <InputLabel id='tts-input-mode'>{t('voice.tts.inputMode')}</InputLabel>
                    <Select
                        labelId='tts-input-mode'
                        label={t('voice.tts.inputMode')}
                        value={tts.inputMode}
                        onChange={event => tts.setInputMode(event.target.value as TtsInputMode)}
                    >
                        {INPUT_MODES.map(mode => (
                            <MenuItem key={mode} value={mode}>
                                {t(`voice.tts.inputModes.${mode}`)}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Button
                    startIcon={<NoteAddIcon />}
                    onClick={() => (modified ? setDiscardConfirm({ open: true, action: 'new' }) : newDocument())}
                >
                    {t('voice.tts.newText')}
                </Button>
                <Button
                    startIcon={<FolderOpenIcon />}
                    onClick={() => (modified ? setDiscardConfirm({ open: true, action: 'open' }) : void openFile())}
                >
                    {t('voice.tts.open')}
                </Button>
                <Button
                    startIcon={<SaveIcon />}
                    onClick={() => void saveFile(false)}
                    disabled={!modified && !!filePath}
                >
                    {t('voice.tts.save')}
                </Button>
                <Button startIcon={<SaveAsIcon />} onClick={() => void saveFile(true)}>
                    {t('voice.tts.saveAs')}
                </Button>
                <Button startIcon={<CodeIcon />} onClick={() => setTagListOpen(true)}>
                    {t('voice.tags.open')}
                </Button>
                <Typography
                    variant='caption'
                    color='text.secondary'
                    sx={{ flexGrow: 1, textAlign: 'right', minWidth: 0 }}
                    noWrap
                    title={openedPath ?? ''}
                >
                    {openedPath ?? ''}
                </Typography>
            </Stack>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' },
                    gridTemplateRows: 'minmax(0, 1fr)',
                    gap: 2,
                    flexGrow: 1,
                    minHeight: 0,
                }}
            >
                <Stack spacing={1} sx={{ minWidth: 0, minHeight: 0 }}>
                    {timedMode ? (
                        <TimedLinesEditor
                            rows={rows}
                            issues={issuesByRow}
                            tagErrorRanges={tagErrorRangesByRow}
                            onChangeRow={tts.updateRow}
                            onInsert={index => {
                                // 足した行のテキストの欄へ移る (表示されてから)
                                const id = tts.insertRow(index);
                                window.setTimeout(() => rowEditorsRef.current.get(id)?.focusRange(0, 0));
                            }}
                            onRemove={id => {
                                // 消した行の位置にくる行 (最後の行なら前の行) のテキストの欄へ移る
                                const index = rows.findIndex(row => row.id === id);
                                const next = rows[index + 1] ?? rows[index - 1];
                                rowEditorsRef.current.delete(id);
                                tts.removeRow(id);
                                if (next) window.setTimeout(() => rowEditorsRef.current.get(next.id)?.focusRange(0, 0));
                            }}
                            onFocusRow={id => {
                                focusedRowRef.current = id;
                            }}
                            registerEditor={(id, handle) => {
                                if (handle) rowEditorsRef.current.set(id, handle);
                                else rowEditorsRef.current.delete(id);
                            }}
                            disabled={busy}
                        />
                    ) : (
                        <TagEditor
                            ref={editorRef}
                            value={tts.normal.text}
                            onChange={tts.setText}
                            tagRanges={tagRanges}
                            errorRanges={errorRanges}
                            placeholder={t('voice.tts.placeholder')}
                        />
                    )}
                    {(analysis.errors.length > 0 || timingIssues.length > 0) && (
                        <Panel sx={{ maxHeight: 140, overflow: 'auto', p: 0 }}>
                            <List dense disablePadding>
                                {timingIssues.map((issue, index) => (
                                    <ListItemButton key={`timing-${index}`} onClick={() => focusTimingIssue(issue)}>
                                        <ListItemText
                                            primary={t('voice.tts.timed.rowIssue', {
                                                row: issue.row,
                                                message: t(`voice.tts.timed.issues.${issue.code}`),
                                            })}
                                            slotProps={{ primary: { variant: 'body2', color: 'error' } }}
                                        />
                                    </ListItemButton>
                                ))}
                                {analysis.errors.map((error, index) => (
                                    <ListItemButton key={index} onClick={() => focusIssue(error)}>
                                        <ListItemText
                                            primary={
                                                error.row
                                                    ? t('voice.tts.timed.errorAt', {
                                                          row: error.row,
                                                          line: error.line,
                                                          column: error.column,
                                                          message: tagIssueMessage(t, error),
                                                      })
                                                    : t('voice.tts.errorAt', {
                                                          line: error.line,
                                                          column: error.column,
                                                          message: tagIssueMessage(t, error),
                                                      })
                                            }
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

                <Panel disablePadding sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    {/* 高さに収まらない分は中でスクロールさせる。各項目は縮めない (縮めると、詳細な設定を開いたときに重なるため) */}
                    <Stack
                        spacing={2}
                        sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', p: 2, '& > *': { flexShrink: 0 } }}
                    >
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
                        <FormControl size='small' disabled={modelTypes.length === 0}>
                            <InputLabel id='tts-model-type'>{t('voice.tts.modelType')}</InputLabel>
                            <Select
                                labelId='tts-model-type'
                                label={t('voice.tts.modelType')}
                                value={modelType ?? ''}
                                onChange={event => tts.setModelType(event.target.value as TtsModelType)}
                            >
                                {modelTypes.map(item => (
                                    <MenuItem key={item} value={item}>
                                        {t(`voice.modelType.${item}`)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
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
                                        {/* ユーザーモデルにだけ、名前の右にアイコンを付ける */}
                                        <Box component='span' sx={{ flexGrow: 1, minWidth: 0, mr: 1 }}>
                                            {voiceLabel(item)}
                                        </Box>
                                        <UserModelIcon voice={item} />
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {modelType && candidatesVoices.length === 0 && (
                            <Alert severity='info'>{t('voice.tts.noVoices')}</Alert>
                        )}
                        <FormControl size='small' disabled={styles.length === 0}>
                            <InputLabel id='tts-style'>{t('voice.tts.style')}</InputLabel>
                            <Select
                                labelId='tts-style'
                                label={t('voice.tts.style')}
                                value={style}
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
                                    value={speakerId}
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
                            disabled={styles.length === 0}
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
                                {!timedMode && (
                                    <SliderField
                                        label={t('voice.tts.paragraphPause')}
                                        value={tts.params.paragraphPause}
                                        min={0}
                                        max={3}
                                        step={0.1}
                                        format={v => t('voice.tts.secondsValue', { value: v.toFixed(1) })}
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
                        {timedMode && (
                            <Stack spacing={0.5}>
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
                                <Typography variant='caption' color='text.secondary' sx={{ lineHeight: 1.5 }}>
                                    {t('voice.tts.overflowHint')}
                                </Typography>
                            </Stack>
                        )}
                    </Stack>
                    <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                        <Button variant='contained' fullWidth disabled={busy || !ready} onClick={startSynthesis}>
                            {t('voice.tts.run')}
                        </Button>
                    </Box>
                </Panel>
            </Box>

            <SyncPlayer
                keepPosition={false}
                source={selected ? { key: selected.id, url: selected.media.url } : null}
                actions={
                    <Button size='small' variant='contained' disabled={!selected} onClick={() => setExportOpen(true)}>
                        {t('voice.export.open')}
                    </Button>
                }
            />

            <TagListDialog
                open={tagListOpen}
                language={language}
                onClose={() => setTagListOpen(false)}
                onInsert={insertExample}
            />
            <SymbolReadingsDialog open={symbolsOpen} language={language} onClose={() => setSymbolsOpen(false)} />

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
                            {t(fix.row ? 'voice.tts.timed.fixItem' : 'voice.tts.fixItem', {
                                row: fix.row,
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
                            const fixed = applyFixes(fixConfirm ?? []);
                            setFixConfirm(null);
                            const next = timedMode
                                ? analyzeTimed(fixed.rows, language)
                                : analyzeNormal(fixed.text, language);
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
                            if (token) void synthesize({ text: tts.normal.text, rows }, token);
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

            <AppDialog open={discardConfirm.open} onClose={closeDiscardConfirm} maxWidth='xs' fullWidth>
                <DialogTitle>{t(discardConfirm.action === 'new' ? 'voice.tts.newText' : 'voice.tts.open')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2'>
                        {t(discardConfirm.action === 'new' ? 'voice.tts.discardChanges' : 'voice.tts.discardForOpen')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDiscardConfirm}>{t('common.cancel')}</Button>
                    <Button
                        variant='contained'
                        color='warning'
                        onClick={() => {
                            closeDiscardConfirm();
                            if (discardConfirm.action === 'new') newDocument();
                            else void openFile();
                        }}
                    >
                        {t('voice.common.discard')}
                    </Button>
                </DialogActions>
            </AppDialog>

            {selected && (
                <ExportDialog
                    workKey={tts.workKey}
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    entries={exportEntries}
                    sourcePath={tts.resultSourcePath ?? ''}
                    baseFileName={exportBaseName(selected)}
                />
            )}
            <ProgressDialog
                open={job !== null}
                title={job?.title ?? ''}
                percent={job?.percent}
                status={job?.status}
                message={job?.message ?? ''}
                onCancel={cancel}
            />
        </PageContainer>
    );
}
