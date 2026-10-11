import React from 'react';
import { Button, Checkbox, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppDialog from '../common/AppDialog';
import { TRACK_FLAGS } from '@shared/video-track-tag';
import type { TrackKind } from '@shared/types';

type Props = {
    // フラグを変えるトラック (null で閉じる)
    target: { kind: TrackKind; flags: string[] } | null;
    onClose(): void;
    onSubmit(flags: string[]): void;
};

// トラックのフラグを 1 つずつ ON / OFF する。選べるのはトラックの種類に合うものだけ (今立っているほかのフラグは、
// 外せるように並べる)
export default function TrackFlagsDialog({ target, onClose, onSubmit }: Props) {
    const { t } = useTranslation();
    const [flags, setFlags] = React.useState<string[]>([]);
    React.useEffect(() => {
        if (target) setFlags(target.flags);
    }, [target]);
    const choices = target ? [...new Set([...TRACK_FLAGS[target.kind], ...target.flags])] : [];
    const toggle = (flag: string) =>
        setFlags(current => (current.includes(flag) ? current.filter(item => item !== flag) : [...current, flag]));
    return (
        <AppDialog open={target !== null} onClose={onClose} maxWidth='xs' fullWidth>
            <DialogTitle>{t('videoTrackTagPage.flagsTitle')}</DialogTitle>
            <DialogContent>
                <Stack>
                    {choices.map(flag => (
                        <FormControlLabel
                            key={flag}
                            control={<Checkbox checked={flags.includes(flag)} onChange={() => toggle(flag)} />}
                            label={t(`videoTrackTagPage.flags.${flag}`, { defaultValue: flag })}
                        />
                    ))}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant='contained' onClick={() => onSubmit(flags)}>
                    {t('videoTrackTagPage.flagsApply')}
                </Button>
            </DialogActions>
        </AppDialog>
    );
}
