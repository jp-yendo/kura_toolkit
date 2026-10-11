import React from 'react';
import {
    Box,
    Button,
    Checkbox,
    Chip,
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
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useTranslation } from 'react-i18next';
import FileDropTarget from '../common/FileDropTarget';
import Panel from '../common/Panel';
import AddTrackDialog from './AddTrackDialog';
import TrackFlagsDialog from './TrackFlagsDialog';
import LanguageField from './LanguageField';
import { TRACK_SOURCE_EXTENSIONS, trackSourceFilters, trackTagErrorMessage } from './trackTagFormat';
import type { TrackTagJob } from './useTrackTagJob';
import { showNotice } from '../../stores/noticeStore';
import { isLastVideo, useVideoTrackTagStore, type EditTrack } from '../../stores/videoTrackTagStore';
import { isTrackFlag, trackExportFormat } from '@shared/video-track-tag';
import type { TrackStreamInfo, TrackTagFile } from '@shared/types';

const baseName = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath;

const withoutExtension = (filePath: string) => filePath.replace(/\.[^.\\/]*$/, '');

// トラック: 映像・音声・字幕のトラックの一覧。名前・言語・既定を変え、トラックを外し、別のファイルからトラックを追加し、
// トラックを単体のファイルへ書き出す
export default function TracksTab({ job }: { job: TrackTagJob }) {
    const { t } = useTranslation();
    const tracks = useVideoTrackTagStore(state => state.tracks);
    const { setLanguage, setTitle, setFlags, setDefault, addTracks, removeTrack, restoreTrack } =
        useVideoTrackTagStore.getState();
    // フラグを変えているトラック (ダイアログを開いている間)
    const [flagging, setFlagging] = React.useState<EditTrack | null>(null);
    // トラックを選んでいるファイル (追加のダイアログを開いている間)
    const [adding, setAdding] = React.useState<TrackTagFile | null>(null);

    // トラックを追加するファイルを開き、追加するトラックを選ぶダイアログを出す
    const openSource = async (source: string) => {
        job.setActivity(t('videoTrackTagPage.loading'));
        try {
            setAdding(await window.kuraToolkit.videoTrackTag.probe(source));
        } catch (error) {
            showNotice('warning', trackTagErrorMessage(t, error));
        } finally {
            job.setActivity(null);
        }
    };

    const chooseFile = async () => {
        const [source] = await window.kuraToolkit.dialog.openFiles({ filters: trackSourceFilters(t) });
        if (source) await openSource(source);
    };

    const add = (streams: TrackStreamInfo[]) => {
        if (!adding) return;
        addTracks(
            streams.flatMap(stream =>
                stream.kind
                    ? [
                          {
                              source: adding.path,
                              streamIndex: stream.index,
                              kind: stream.kind,
                              codec: stream.codec,
                              codecTag: stream.codecTag,
                              summary: stream.summary,
                              title: stream.title,
                              language: stream.language === 'und' ? '' : stream.language,
                              isDefault: false,
                              flags: stream.dispositions.filter(isTrackFlag),
                          },
                      ]
                    : []
            )
        );
        setAdding(null);
    };

    // トラックを単体のファイルへ書き出す (形式はトラックのコーデックから決める)
    const exportTrack = async (track: EditTrack, number: number) => {
        const format = trackExportFormat(track.kind, track.codec);
        const extension = format.extension.slice(1);
        const output = await window.kuraToolkit.dialog.saveFile({
            defaultPath: `${withoutExtension(track.source)}.track${number}${format.extension}`,
            filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
        });
        if (!output) return;
        try {
            const result = await job.run(t('videoTrackTagPage.exporting'), jobId =>
                window.kuraToolkit.videoTrackTag.exportTrack(jobId, {
                    input: track.source,
                    streamIndex: track.streamIndex,
                    output,
                })
            );
            if (!result.cancelled) showNotice('success', t('videoTrackTagPage.exported', { path: output }));
        } catch (error) {
            showNotice('warning', trackTagErrorMessage(t, error));
        }
    };

    return (
        // タブ全体にファイルをドロップしてもトラックを追加できる
        <FileDropTarget
            onFiles={paths => void openSource(paths[0])}
            accept={TRACK_SOURCE_EXTENSIONS}
            onRejected={() => showNotice('warning', t('videoTrackTagPage.unsupportedFile'))}
            sx={{ minHeight: '100%' }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Button size='small' startIcon={<AddIcon />} onClick={() => void chooseFile()}>
                    {t('videoTrackTagPage.addTrack')}
                </Button>
            </Box>
            <Panel disablePadding>
                <Table size='small' sx={{ '& th': { whiteSpace: 'nowrap' } }}>
                    <TableHead>
                        <TableRow>
                            <TableCell>#</TableCell>
                            <TableCell>{t('videoTrackTagPage.colKind')}</TableCell>
                            <TableCell>{t('videoTrackTagPage.colCodec')}</TableCell>
                            <TableCell>{t('videoTrackTagPage.colTitle')}</TableCell>
                            <TableCell>{t('videoTrackTagPage.colLanguage')}</TableCell>
                            <TableCell padding='checkbox' sx={{ whiteSpace: 'nowrap' }}>
                                {t('videoTrackTagPage.colDefault')}
                            </TableCell>
                            <TableCell>{t('videoTrackTagPage.colFlags')}</TableCell>
                            <TableCell />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {tracks.map((track, i) => (
                            <TableRow
                                key={track.id}
                                // 削除の印を付けたトラックは薄くし、種類と形式に取り消し線を引く (操作は取り消しと書き出しだけ)
                                sx={
                                    track.removed
                                        ? {
                                              '& > td': { color: 'text.disabled' },
                                              '& .track-kind, & .track-codec': { textDecoration: 'line-through' },
                                          }
                                        : undefined
                                }
                            >
                                <TableCell>{i + 1}</TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    <span className='track-kind'>{t(`videoTrackTagPage.kinds.${track.kind}`)}</span>
                                    {track.removed && (
                                        <Chip
                                            label={t('videoTrackTagPage.removedTrack')}
                                            size='small'
                                            variant='outlined'
                                            color='error'
                                            sx={{ display: 'flex', width: 'fit-content', mt: 0.5, height: 20 }}
                                        />
                                    )}
                                    {/* 別のファイルから追加したトラックの印 (追加元のファイル名はツールチップで示す) */}
                                    {track.added && (
                                        <Tooltip
                                            title={t('videoTrackTagPage.addedFrom', { name: baseName(track.source) })}
                                        >
                                            <Chip
                                                label={t('videoTrackTagPage.addedTrack')}
                                                size='small'
                                                variant='outlined'
                                                color='primary'
                                                sx={{ display: 'flex', width: 'fit-content', mt: 0.5, height: 20 }}
                                            />
                                        </Tooltip>
                                    )}
                                </TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    <span className='track-codec'>
                                        {track.codecTag ? `${track.codec} ${track.codecTag}` : track.codec}
                                    </span>
                                    {track.summary.map(line => (
                                        <Typography
                                            key={line}
                                            variant='body2'
                                            color={track.removed ? 'text.disabled' : 'text.secondary'}
                                        >
                                            {line}
                                        </Typography>
                                    ))}
                                </TableCell>
                                <TableCell>
                                    <TextField
                                        size='small'
                                        fullWidth
                                        value={track.title}
                                        disabled={track.removed}
                                        onChange={event => setTitle(track.id, event.target.value)}
                                        sx={{ minWidth: 160 }}
                                        slotProps={{ htmlInput: { 'aria-label': t('videoTrackTagPage.colTitle') } }}
                                    />
                                </TableCell>
                                <TableCell>
                                    <LanguageField
                                        value={track.language}
                                        disabled={track.removed}
                                        onChange={value => setLanguage(track.id, value)}
                                    />
                                </TableCell>
                                <TableCell padding='checkbox'>
                                    <Checkbox
                                        checked={track.isDefault}
                                        disabled={track.removed}
                                        onChange={event => setDefault(track.id, event.target.checked)}
                                        slotProps={{ input: { 'aria-label': t('videoTrackTagPage.colDefault') } }}
                                    />
                                </TableCell>
                                {/* ON のフラグを並べ、右端の「…」で 1 つずつ ON / OFF するダイアログを開く */}
                                <TableCell>
                                    <Stack direction='row' spacing={0.5} sx={{ alignItems: 'center' }}>
                                        <Typography variant='body2' sx={{ flexGrow: 1, minWidth: 80 }}>
                                            {track.flags.length > 0
                                                ? track.flags
                                                      .map(flag =>
                                                          t(`videoTrackTagPage.flags.${flag}`, { defaultValue: flag })
                                                      )
                                                      .join('・')
                                                : '-'}
                                        </Typography>
                                        <Tooltip title={t('videoTrackTagPage.editFlags')}>
                                            <span>
                                                <IconButton
                                                    aria-label={t('videoTrackTagPage.editFlags')}
                                                    size='small'
                                                    disabled={track.removed}
                                                    onClick={() => setFlagging(track)}
                                                >
                                                    <MoreHorizIcon fontSize='small' />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </Stack>
                                </TableCell>
                                <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                                    <Tooltip title={t('videoTrackTagPage.exportTrack')}>
                                        <IconButton
                                            aria-label={t('videoTrackTagPage.exportTrack')}
                                            size='small'
                                            onClick={() => void exportTrack(track, i + 1)}
                                        >
                                            <FileDownloadIcon fontSize='small' />
                                        </IconButton>
                                    </Tooltip>
                                    {track.removed ? (
                                        <Tooltip title={t('videoTrackTagPage.restoreTrack')}>
                                            <IconButton
                                                aria-label={t('videoTrackTagPage.restoreTrack')}
                                                size='small'
                                                onClick={() => restoreTrack(track.id)}
                                            >
                                                <RestoreFromTrashIcon fontSize='small' />
                                            </IconButton>
                                        </Tooltip>
                                    ) : (
                                        // 映像のトラックは最低 1 つ必要なため、書き出す映像の最後の 1 つは削除できない
                                        <Tooltip
                                            title={t(
                                                isLastVideo(tracks, track.id)
                                                    ? 'videoTrackTagPage.cannotRemoveLastVideo'
                                                    : 'videoTrackTagPage.removeTrack'
                                            )}
                                        >
                                            <span>
                                                <IconButton
                                                    aria-label={t('videoTrackTagPage.removeTrack')}
                                                    size='small'
                                                    disabled={isLastVideo(tracks, track.id)}
                                                    onClick={() => removeTrack(track.id)}
                                                >
                                                    <DeleteIcon fontSize='small' />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Panel>
            <AddTrackDialog file={adding} onClose={() => setAdding(null)} onAdd={add} />
            <TrackFlagsDialog
                target={flagging}
                onClose={() => setFlagging(null)}
                onSubmit={flags => {
                    if (flagging) setFlags(flagging.id, flags);
                    setFlagging(null);
                }}
            />
        </FileDropTarget>
    );
}
