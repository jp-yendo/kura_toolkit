import {
    Box,
    Button,
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
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import TagEditor, { type TagEditorHandle } from './TagEditor';
import { findTagRanges } from '@shared/voice/control-tags';
import { formatTimestamp, parseTimeInput, type TimedLineIssueCode } from '@shared/voice/timed-text';
import type { TimedRow } from '../../stores/ttsStore';

type Range = { start: number; end: number };

type Props = {
    rows: TimedRow[];
    // 行ごとの時間とテキストの誤り (行の ID -> 誤りの種類)
    issues: Map<string, TimedLineIssueCode[]>;
    // 行ごとの制御タグの誤りの範囲 (行の ID -> その行のテキストの中の範囲)
    tagErrorRanges: Map<string, Range[]>;
    onChangeRow(id: string, patch: Partial<Omit<TimedRow, 'id'>>): void;
    onInsert(index: number): void;
    onRemove(id: string): void;
    onFocusRow(id: string): void;
    // 行のテキストの入力欄 (制御タグの挿入と、誤りの位置へ移るために使う)
    registerEditor(id: string, handle: TagEditorHandle | null): void;
    disabled?: boolean;
};

const START_ISSUES: TimedLineIssueCode[] = ['startFormat', 'startAfterLater'];
const END_ISSUES: TimedLineIssueCode[] = ['endFormat', 'endBeforeStart'];

// 読み上げのタイミング指定の入力 (左に開始時間・終了時間、右にテキストの表)。
// テキストは複数行にでき、制御タグを使える。時間は「時:分:秒.ミリ秒」で入力し、確定時に整える。
// 時間を読めない・終了が開始より前・後ろの行より遅い開始時間の行は、その欄を赤く示す
export default function TimedLinesEditor({
    rows,
    issues,
    tagErrorRanges,
    onChangeRow,
    onInsert,
    onRemove,
    onFocusRow,
    registerEditor,
    disabled = false,
}: Props) {
    const { t } = useTranslation();

    // 時間の入力を確定したときに「時:分:秒.ミリ秒」へ整える (読めない値はそのまま残して赤く示す)
    const normalizeTime = (row: TimedRow, field: 'start' | 'end') => {
        const seconds = parseTimeInput(row[field]);
        if (seconds === null) return;
        const formatted = formatTimestamp(seconds);
        if (formatted !== row[field]) onChangeRow(row.id, { [field]: formatted });
    };

    const timeField = (row: TimedRow, field: 'start' | 'end', rowIssues: TimedLineIssueCode[]) => {
        const fieldIssues = rowIssues.filter(code => (field === 'start' ? START_ISSUES : END_ISSUES).includes(code));
        const message = fieldIssues.map(code => t(`voice.tts.timed.issues.${code}`)).join('\n');
        return (
            <Tooltip title={message} disableHoverListener={!message} disableFocusListener={!message}>
                <TextField
                    size='small'
                    value={row[field]}
                    error={fieldIssues.length > 0}
                    disabled={disabled}
                    placeholder='00:00:00.000'
                    onFocus={() => onFocusRow(row.id)}
                    onChange={event => onChangeRow(row.id, { [field]: event.target.value })}
                    onBlur={() => normalizeTime(row, field)}
                    slotProps={{
                        htmlInput: {
                            'aria-label': t(`voice.tts.timed.${field}`),
                            // 誤りの一覧からこの欄へ移るための目印
                            'data-time-field': `${row.id}:${field}`,
                            spellCheck: false,
                            sx: { fontFamily: 'Consolas, Menlo, monospace', fontSize: 13, py: 0.75 },
                        },
                    }}
                    sx={{ width: 132 }}
                />
            </Tooltip>
        );
    };

    if (rows.length === 0) {
        return (
            <Panel
                sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}
            >
                <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
                    <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                        {t('voice.tts.timed.empty')}
                    </Typography>
                    <Button variant='outlined' startIcon={<AddIcon />} disabled={disabled} onClick={() => onInsert(0)}>
                        {t('voice.tts.timed.addRow')}
                    </Button>
                </Stack>
            </Panel>
        );
    }

    return (
        <Stack spacing={1} sx={{ flexGrow: 1, minHeight: 0 }}>
            <Panel disablePadding sx={{ flexGrow: 1, flexBasis: 0, minHeight: 200, overflow: 'auto' }}>
                <Table size='small' stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: 40 }}>#</TableCell>
                            <TableCell sx={{ width: 148 }}>{t('voice.tts.timed.start')}</TableCell>
                            <TableCell sx={{ width: 148 }}>{t('voice.tts.timed.end')}</TableCell>
                            <TableCell>{t('voice.tts.timed.text')}</TableCell>
                            <TableCell sx={{ width: 84 }} />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((row, index) => {
                            const rowIssues = issues.get(row.id) ?? [];
                            const emptyText = rowIssues.includes('emptyText');
                            return (
                                <TableRow key={row.id} sx={{ verticalAlign: 'top' }}>
                                    <TableCell sx={{ pt: 1.5, color: 'text.secondary' }}>{index + 1}</TableCell>
                                    <TableCell>{timeField(row, 'start', rowIssues)}</TableCell>
                                    <TableCell>{timeField(row, 'end', rowIssues)}</TableCell>
                                    <TableCell>
                                        <Tooltip
                                            title={emptyText ? t('voice.tts.timed.issues.emptyText') : ''}
                                            disableHoverListener={!emptyText}
                                            disableFocusListener={!emptyText}
                                        >
                                            <Box
                                                sx={{
                                                    borderRadius: 2,
                                                    outline: emptyText ? 1 : 0,
                                                    outlineColor: 'error.main',
                                                }}
                                            >
                                                <TagEditor
                                                    ref={handle => registerEditor(row.id, handle)}
                                                    value={row.text}
                                                    onChange={text => onChangeRow(row.id, { text })}
                                                    onFocus={() => onFocusRow(row.id)}
                                                    tagRanges={findTagRanges(row.text)}
                                                    errorRanges={tagErrorRanges.get(row.id) ?? []}
                                                    placeholder={t('voice.tts.timed.textPlaceholder')}
                                                    ariaLabel={t('voice.tts.timed.textOf', { row: index + 1 })}
                                                    disabled={disabled}
                                                    autoHeight
                                                />
                                            </Box>
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap', pt: 1 }}>
                                        <Tooltip title={t('voice.tts.timed.insertBelow')}>
                                            <span>
                                                <IconButton
                                                    size='small'
                                                    aria-label={t('voice.tts.timed.insertBelow')}
                                                    disabled={disabled}
                                                    onClick={() => onInsert(index + 1)}
                                                >
                                                    <PlaylistAddIcon fontSize='small' />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title={t('voice.tts.timed.removeRow')}>
                                            <span>
                                                <IconButton
                                                    size='small'
                                                    aria-label={t('voice.tts.timed.removeRow')}
                                                    disabled={disabled}
                                                    onClick={() => onRemove(row.id)}
                                                >
                                                    <DeleteOutlineIcon fontSize='small' />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Panel>
            <Box>
                <Button size='small' startIcon={<AddIcon />} disabled={disabled} onClick={() => onInsert(rows.length)}>
                    {t('voice.tts.timed.addRow')}
                </Button>
            </Box>
        </Stack>
    );
}
