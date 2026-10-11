import React from 'react';
import { Button, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { formatTime } from '../video/videoFormat';
import { parseTime } from './trackTagFormat';
import { chapterTimesError, type EditChapter } from '../../stores/videoTrackTagStore';

type Props = {
    // 開始・終了を変えるチャプター (null で閉じる)。focus は初めに入力する欄
    target: { chapter: EditChapter; focus: 'start' | 'end' } | null;
    chapters: EditChapter[];
    durationSec: number;
    onClose(): void;
    onSubmit(start: number, end: number): void;
};

// チャプターの開始・終了を時刻 (HH:MM:SS.mmm・MM:SS.mmm・秒) で入力する。動画の長さの外・開始が終了以降・
// ほかのチャプターと重なる場合は誤りを示し、決定できない
export default function ChapterTimesDialog({ target, chapters, durationSec, onClose, onSubmit }: Props) {
    const { t } = useTranslation();
    const [start, setStart] = React.useState('');
    const [end, setEnd] = React.useState('');
    React.useEffect(() => {
        if (!target) return;
        setStart(formatTime(target.chapter.start));
        setEnd(formatTime(target.chapter.end));
    }, [target]);

    const startSec = parseTime(start);
    const endSec = parseTime(end);
    const outOfRange = (value: number | null) => value === null || value < 0 || value > durationSec + 0.001;
    const rangeError = t('videoTrackTagPage.chapterTimeInvalid');
    let startError = outOfRange(startSec) ? rangeError : null;
    let endError = outOfRange(endSec) ? rangeError : null;
    if (target && startSec !== null && endSec !== null && !startError && !endError) {
        const error = chapterTimesError(chapters, target.chapter.id, startSec, endSec);
        if (error?.code === 'order') endError = t('videoTrackTagPage.chapterTimeOrder');
        if (error?.code === 'overlap') {
            const other = chapters[error.index];
            const message = t('videoTrackTagPage.chapterTimeOverlap', {
                number: error.index + 1,
                start: formatTime(other.start),
                end: formatTime(other.end),
            });
            if (other.start < startSec) startError = message;
            else endError = message;
        }
    }
    const valid = startError === null && endError === null;

    const field = (key: 'start' | 'end', value: string, error: string | null, onChange: (text: string) => void) => (
        <TextField
            label={t(key === 'start' ? 'videoTrackTagPage.colStart' : 'videoTrackTagPage.colEnd')}
            value={value}
            error={error !== null}
            helperText={error ?? undefined}
            autoFocus={target?.focus === key}
            onFocus={event => event.target.select()}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
                if (event.key === 'Enter' && valid) onSubmit(startSec ?? 0, endSec ?? 0);
            }}
        />
    );

    return (
        <AppDialog open={target !== null} onClose={onClose} maxWidth='xs' fullWidth>
            <DialogTitle>{t('videoTrackTagPage.chapterTimesTitle')}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    {field('start', start, startError, setStart)}
                    {field('end', end, endError, setEnd)}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant='contained' disabled={!valid} onClick={() => onSubmit(startSec ?? 0, endSec ?? 0)}>
                    {t('videoTrackTagPage.chapterTimesApply')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
