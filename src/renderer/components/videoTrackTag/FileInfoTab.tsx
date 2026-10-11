import { Box, Stack, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';
import { formatTime } from '../video/videoFormat';
import type { ProbeField, TrackTagFile } from '@shared/types';

// 時間 (秒) の項目と、ビットレート・大きさの項目 (読みやすい形を添える)
const SECONDS_FIELDS = /(^|\.)(duration|start_time)$/;
const BIT_RATE_FIELDS = /(^|\.)(bit_rate|max_bit_rate)$/;

function displayValue(field: ProbeField): string {
    const number = Number(field.value);
    if (SECONDS_FIELDS.test(field.key) && Number.isFinite(number)) return `${field.value} (${formatTime(number)})`;
    if (BIT_RATE_FIELDS.test(field.key) && Number.isFinite(number)) {
        return `${field.value} (${(number / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kb/s)`;
    }
    if (field.key === 'size' && Number.isFinite(number)) {
        return `${field.value} (${(number / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB)`;
    }
    return field.value;
}

// 項目の一覧 (ffprobe の項目名と値。分かる項目には表示名を添える)
function FieldTable({ fields }: { fields: ProbeField[] }) {
    const { t } = useTranslation();
    return (
        <Table size='small'>
            <TableBody>
                {fields.map(field => {
                    const label = t(`videoTrackTagPage.fields.${field.key}`, { defaultValue: '' });
                    return (
                        <TableRow key={field.key}>
                            <TableCell sx={{ width: '40%', verticalAlign: 'top', color: 'text.secondary' }}>
                                {label ? `${label} (${field.key})` : field.key}
                            </TableCell>
                            <TableCell sx={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                                {displayValue(field)}
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}

function Section({ title, fields }: { title: string; fields: ProbeField[] }) {
    if (fields.length === 0) return null;
    return (
        <Box>
            <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 0.5 }}>
                {title}
            </Typography>
            <Panel disablePadding>
                <FieldTable fields={fields} />
            </Panel>
        </Box>
    );
}

const tagFields = (tags: Record<string, string>): ProbeField[] =>
    Object.entries(tags).map(([key, value]) => ({ key, value }));

// ファイル情報: ファイル全体と各ストリームの、ffprobe で得られるすべての項目・タグ・指定
export default function FileInfoTab({ file }: { file: TrackTagFile }) {
    const { t } = useTranslation();
    const kindLabel = (codecType: string) =>
        t(`videoTrackTagPage.streamTypes.${codecType}`, { defaultValue: codecType || '?' });
    return (
        <Stack spacing={2}>
            <Section title={t('videoTrackTagPage.infoFormat')} fields={file.formatFields} />
            <Section title={t('videoTrackTagPage.infoFormatTags')} fields={tagFields(file.formatTags)} />
            {file.streams.map(stream => (
                <Stack key={stream.index} spacing={1}>
                    <Section
                        title={`#${stream.index} ${kindLabel(stream.codecType)} ${stream.codec}`}
                        fields={stream.fields}
                    />
                    <Section
                        title={t('videoTrackTagPage.infoStreamTags', { index: stream.index })}
                        fields={tagFields(stream.tags)}
                    />
                    {stream.dispositions.length > 0 && (
                        <Typography variant='body2' color='text.secondary'>
                            {t('videoTrackTagPage.infoDispositions', { flags: stream.dispositions.join(', ') })}
                        </Typography>
                    )}
                </Stack>
            ))}
            {file.chapters.length > 0 && (
                <Section
                    title={t('videoTrackTagPage.infoChapters')}
                    fields={file.chapters.map((chapter, i) => ({
                        key: `#${i + 1}`,
                        value: `${formatTime(chapter.start)} - ${formatTime(chapter.end)}  ${chapter.title}`,
                    }))}
                />
            )}
        </Stack>
    );
}
