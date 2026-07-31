import React from 'react';
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import FileDropZone from '../../components/common/FileDropZone';
import PathField from '../../components/common/PathField';
import ProgressDialog from '../../components/common/ProgressDialog';
import LogView from '../../components/common/LogView';
import PageContainer from '../../components/common/PageContainer';
import SectionLabel from '../../components/common/SectionLabel';
import Panel from '../../components/common/Panel';
import NoticeSnackbar from '../../components/common/NoticeSnackbar';
import { useChapterStore, type ChapterMode } from '../../stores/chapterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { JobEvent } from '@shared/types';

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts', 'avi', 'mp3', 'm4a', 'flac', 'ogg'];
const VIDEO_FILTERS = [
    { name: 'Media Files', extensions: VIDEO_EXTENSIONS },
    { name: 'All Files', extensions: ['*'] },
];

function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${s.toFixed(3).padStart(6, '0')}`;
}

type RunningJob = {
    jobId: string;
    percent?: number;
    current?: number;
    total?: number;
};

export default function ChapterCutPage() {
    const { t } = useTranslation();
    const store = useChapterStore();
    const { settings, update } = useSettingsStore();
    const [job, setJob] = React.useState<RunningJob | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [warning, setWarning] = React.useState<string | null>(null);
    const [resultOutputs, setResultOutputs] = React.useState<string[] | null>(null);

    const activeJobId = job?.jobId;
    React.useEffect(() => {
        if (!activeJobId) return;
        const unsubscribe = window.kuraToolkit.jobs.onEvent((event: JobEvent) => {
            if (event.jobId !== activeJobId) return;
            if (event.kind === 'log' && event.message) {
                useChapterStore.getState().appendLog(event.message);
            } else if (event.kind === 'progress') {
                setJob(previous =>
                    previous && previous.jobId === event.jobId
                        ? {
                              ...previous,
                              percent: event.percent ?? previous.percent,
                              current: event.current ?? previous.current,
                              total: event.total ?? previous.total,
                          }
                        : previous
                );
            }
        });
        return unsubscribe;
    }, [activeJobId]);

    if (!settings) return null;
    const chapterSettings = settings.chapterCut;

    const formatError = (error: unknown): string => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('FFMPEG_NOT_FOUND')) return t('common.ffmpegNotFound');
        if (message.includes('FFPROBE_NOT_FOUND')) return t('common.ffprobeNotFound');
        if (message.includes('NO_CHAPTERS')) return t('chapterPage.noChapters');
        if (message.includes('INVALID_RANGE')) return t('chapterPage.invalidRange');
        if (message.includes('NO_SPLIT_POINT')) return t('chapterPage.noSplitPoint');
        if (message.includes('DUPLICATE_OUTPUTS')) return t('chapterPage.duplicateOutputs');
        if (message.includes('OUTPUT_EQUALS_INPUT')) return t('chapterPage.outputEqualsInput');
        return message;
    };

    const loadFile = async (paths: string[]) => {
        const input = paths[0];
        if (!input) return;
        setLoading(true);
        try {
            const probe = await window.kuraToolkit.chapter.probe(input);
            store.setInput(input, probe);
        } catch (error) {
            store.setInput(null, null);
            setWarning(formatError(error));
        } finally {
            setLoading(false);
        }
    };

    const run = async () => {
        if (!store.input || !store.probe) return;
        if (store.mode === 'split' && store.boundaries.filter(index => index > 0).length === 0) {
            setWarning(t('chapterPage.noSplitPoint'));
            return;
        }
        if (store.mode === 'cut' && store.toIndex >= 0 && store.fromIndex > store.toIndex) {
            setWarning(t('chapterPage.invalidRange'));
            return;
        }
        const jobId = crypto.randomUUID();
        store.clearLogs();
        setJob({ jobId });
        try {
            const outputDir = chapterSettings.outputDir || null;
            const result =
                store.mode === 'cut'
                    ? await window.kuraToolkit.chapter.cut(jobId, {
                          input: store.input,
                          fromIndex: store.fromIndex,
                          toIndex: store.toIndex >= 0 ? store.toIndex : null,
                          accurate: chapterSettings.accurate,
                          outputDir,
                          outputPath: store.outputPath || null,
                      })
                    : await window.kuraToolkit.chapter.split(jobId, {
                          input: store.input,
                          boundaryIndexes: store.boundaries,
                          accurate: chapterSettings.accurate,
                          outputDir,
                      });
            if (!result.cancelled) {
                setResultOutputs(result.outputs);
            }
        } catch (error) {
            setWarning(formatError(error));
        } finally {
            setJob(null);
        }
    };

    const chapters = store.probe?.chapters ?? [];

    return (
        <PageContainer>
            <FileDropZone
                onFiles={loadFile}
                filters={VIDEO_FILTERS}
                hint={store.input ?? t('chapterPage.dropHint')}
                sx={{ minHeight: 72, flexShrink: 0 }}
            />

            {chapters.length > 0 && (
                <>
                    <Tabs
                        value={store.mode}
                        onChange={(_event, value) => store.setMode(value as ChapterMode)}
                        sx={{ borderBottom: 1, borderColor: 'divider' }}
                    >
                        <Tab value='cut' label={t('chapterPage.modeCut')} />
                        <Tab value='split' label={t('chapterPage.modeSplit')} />
                    </Tabs>

                    {store.mode === 'cut' ? (
                        <Stack direction='row' spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
                            <FormControl size='small' sx={{ minWidth: 260 }}>
                                <InputLabel id='from-chapter-label'>{t('chapterPage.fromChapter')}</InputLabel>
                                <Select
                                    labelId='from-chapter-label'
                                    label={t('chapterPage.fromChapter')}
                                    value={store.fromIndex}
                                    onChange={event => store.setFromIndex(Number(event.target.value))}
                                >
                                    {chapters.map(chapter => (
                                        <MenuItem key={chapter.index} value={chapter.index}>
                                            {chapter.id}: {chapter.title || formatTime(chapter.start)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size='small' sx={{ minWidth: 260 }}>
                                <InputLabel id='to-chapter-label'>{t('chapterPage.toChapter')}</InputLabel>
                                <Select
                                    labelId='to-chapter-label'
                                    label={t('chapterPage.toChapter')}
                                    value={store.toIndex}
                                    onChange={event => store.setToIndex(Number(event.target.value))}
                                >
                                    <MenuItem value={-1}>{t('chapterPage.toLast')}</MenuItem>
                                    {chapters.map(chapter => (
                                        <MenuItem key={chapter.index} value={chapter.index}>
                                            {chapter.id}: {chapter.title || formatTime(chapter.start)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Stack>
                    ) : (
                        <Typography variant='body2' color='text.secondary'>
                            {t('chapterPage.splitHint')}
                        </Typography>
                    )}

                    <SectionLabel>{t('chapterPage.chapters')}</SectionLabel>
                    <TableContainer
                        component={Panel}
                        disablePadding
                        sx={{ flexGrow: 1, flexBasis: 0, minHeight: 180, overflow: 'auto' }}
                    >
                        <Table size='small' stickyHeader>
                            <TableHead>
                                <TableRow>
                                    {store.mode === 'split' && (
                                        <TableCell padding='checkbox'>{t('chapterPage.colSplitPoint')}</TableCell>
                                    )}
                                    <TableCell>{t('chapterPage.colId')}</TableCell>
                                    <TableCell>{t('chapterPage.colStart')}</TableCell>
                                    <TableCell>{t('chapterPage.colEnd')}</TableCell>
                                    <TableCell>{t('chapterPage.colTitle')}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {chapters.map(chapter => {
                                    const inRange =
                                        store.mode === 'cut' &&
                                        chapter.index >= store.fromIndex &&
                                        (store.toIndex < 0 || chapter.index <= store.toIndex);
                                    return (
                                        <TableRow
                                            key={chapter.index}
                                            hover
                                            selected={inRange}
                                            onClick={() => {
                                                if (store.mode === 'split' && chapter.index > 0) {
                                                    store.toggleBoundary(chapter.index);
                                                }
                                            }}
                                        >
                                            {store.mode === 'split' && (
                                                <TableCell padding='checkbox'>
                                                    <Checkbox
                                                        size='small'
                                                        disabled={chapter.index === 0}
                                                        checked={store.boundaries.includes(chapter.index)}
                                                    />
                                                </TableCell>
                                            )}
                                            <TableCell>{chapter.id}</TableCell>
                                            <TableCell>{formatTime(chapter.start)}</TableCell>
                                            <TableCell>{formatTime(chapter.end)}</TableCell>
                                            <TableCell sx={{ wordBreak: 'break-all' }}>{chapter.title}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    <Box sx={{ flexShrink: 0 }}>
                        <SectionLabel>{t('chapterPage.outputSection')}</SectionLabel>
                        <Panel>
                            <Stack spacing={2}>
                                <PathField
                                    label={t('chapterPage.outputDir')}
                                    value={chapterSettings.outputDir}
                                    onChange={value => void update({ chapterCut: { outputDir: value } })}
                                    onBrowse={() =>
                                        window.kuraToolkit.dialog.openDirectory({
                                            defaultPath: chapterSettings.outputDir || undefined,
                                        })
                                    }
                                />

                                {/* 切り出しモードのみ、出力ファイル名を明示指定できる (CLI の --output 相当) */}
                                {store.mode === 'cut' && (
                                    <PathField
                                        label={t('chapterPage.outputFile')}
                                        value={store.outputPath}
                                        helperText={t('chapterPage.outputFileHint')}
                                        onChange={value => store.setOutputPath(value)}
                                        onBrowse={() =>
                                            window.kuraToolkit.dialog.saveFile({
                                                defaultPath: store.outputPath || undefined,
                                                filters: [
                                                    { name: 'Media Files', extensions: VIDEO_EXTENSIONS },
                                                    { name: 'All Files', extensions: ['*'] },
                                                ],
                                            })
                                        }
                                    />
                                )}

                                <Box>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={chapterSettings.accurate}
                                                onChange={event =>
                                                    void update({ chapterCut: { accurate: event.target.checked } })
                                                }
                                            />
                                        }
                                        label={t('chapterPage.accurate')}
                                    />
                                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                                        {t('chapterPage.accurateHint')}
                                    </Typography>
                                </Box>
                            </Stack>
                        </Panel>
                    </Box>

                    <Button variant='contained' onClick={run} disabled={job !== null || loading} sx={{ flexShrink: 0 }}>
                        {t('chapterPage.run')}
                    </Button>

                    {store.logs.length > 0 && (
                        <Box sx={{ flexShrink: 0 }}>
                            <SectionLabel>{t('chapterPage.log')}</SectionLabel>
                            <LogView lines={store.logs} />
                        </Box>
                    )}
                </>
            )}

            <ProgressDialog
                open={job !== null || loading}
                title={t('chapterPage.running')}
                percent={job?.percent}
                current={job?.current}
                total={job?.total}
                // チャプター解析中 (ジョブ未開始) はキャンセルできないためボタンを出さない
                onCancel={
                    job
                        ? () => {
                              void window.kuraToolkit.jobs.cancel(job.jobId);
                          }
                        : undefined
                }
            />

            <NoticeSnackbar message={warning} severity='warning' onClose={() => setWarning(null)} />

            <Dialog open={resultOutputs !== null} onClose={() => setResultOutputs(null)} maxWidth='sm' fullWidth>
                <DialogTitle>{t('common.done')}</DialogTitle>
                <DialogContent>
                    <Typography variant='body2' sx={{ mb: 0.5 }}>
                        {t('chapterPage.resultOutputs')}
                    </Typography>
                    {resultOutputs?.map(output => (
                        <Typography key={output} variant='body2' color='text.secondary' sx={{ wordBreak: 'break-all' }}>
                            {output}
                        </Typography>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResultOutputs(null)}>{t('common.close')}</Button>
                </DialogActions>
            </Dialog>
        </PageContainer>
    );
}
