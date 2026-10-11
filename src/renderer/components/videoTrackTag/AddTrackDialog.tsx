import React from 'react';
import {
    Button,
    Checkbox,
    DialogActions,
    DialogContent,
    DialogTitle,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { languageName } from './trackTagFormat';
import type { TrackStreamInfo, TrackTagFile } from '@shared/types';

type Props = {
    // トラックを選ぶファイル (null で閉じる)
    file: TrackTagFile | null;
    onClose(): void;
    onAdd(streams: TrackStreamInfo[]): void;
};

// 選んだファイルのトラック (映像・音声・字幕) から、追加するものを選ぶ
export default function AddTrackDialog({ file, onClose, onAdd }: Props) {
    const { t, i18n } = useTranslation();
    const streams = React.useMemo(() => file?.streams.filter(stream => stream.kind !== null) ?? [], [file]);
    const [selected, setSelected] = React.useState<number[]>([]);
    // ファイルを選び直したら、すべてのトラックを選んだ状態から始める
    React.useEffect(() => setSelected(streams.map(stream => stream.index)), [streams]);
    const toggle = (index: number) =>
        setSelected(current =>
            current.includes(index) ? current.filter(value => value !== index) : [...current, index]
        );
    return (
        <AppDialog open={file !== null} onClose={onClose} maxWidth='md' fullWidth>
            <DialogTitle>{t('videoTrackTagPage.addTrackTitle')}</DialogTitle>
            <DialogContent>
                <Typography variant='body2' color='text.secondary' sx={{ mb: 1, wordBreak: 'break-all' }}>
                    {file?.path}
                </Typography>
                {streams.length === 0 ? (
                    <Typography>{t('videoTrackTagPage.noTracksInFile')}</Typography>
                ) : (
                    <Table size='small'>
                        <TableHead>
                            <TableRow>
                                <TableCell padding='checkbox' />
                                <TableCell>{t('videoTrackTagPage.colKind')}</TableCell>
                                <TableCell>{t('videoTrackTagPage.colCodec')}</TableCell>
                                <TableCell>{t('videoTrackTagPage.colLanguage')}</TableCell>
                                <TableCell>{t('videoTrackTagPage.colTitle')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {streams.map(stream => (
                                <TableRow
                                    key={stream.index}
                                    hover
                                    onClick={() => toggle(stream.index)}
                                    sx={{ cursor: 'pointer' }}
                                >
                                    <TableCell padding='checkbox'>
                                        <Checkbox
                                            size='small'
                                            checked={selected.includes(stream.index)}
                                            slotProps={{
                                                input: {
                                                    'aria-label': `${t(`videoTrackTagPage.kinds.${stream.kind}`)} ${stream.codec}`,
                                                },
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>{t(`videoTrackTagPage.kinds.${stream.kind}`)}</TableCell>
                                    <TableCell>
                                        {stream.codecTag ? `${stream.codec} ${stream.codecTag}` : stream.codec}
                                        {stream.summary.map(line => (
                                            <Typography key={line} variant='body2' color='text.secondary'>
                                                {line}
                                            </Typography>
                                        ))}
                                    </TableCell>
                                    <TableCell>
                                        {stream.language && stream.language !== 'und'
                                            ? languageName(stream.language, i18n.language)
                                            : t('videoTrackTagPage.languageNone')}
                                    </TableCell>
                                    <TableCell sx={{ wordBreak: 'break-all' }}>{stream.title}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button
                    variant='contained'
                    disabled={selected.length === 0}
                    onClick={() => onAdd(streams.filter(stream => selected.includes(stream.index)))}
                >
                    {t('videoTrackTagPage.addTrackRun')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
