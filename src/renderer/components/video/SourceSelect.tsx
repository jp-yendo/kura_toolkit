import { Stack, Typography } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import { useTranslation } from 'react-i18next';
import FileDropZone from '../common/FileDropZone';
import { showNotice } from '../../stores/noticeStore';
import { VIDEO_EXTENSIONS, videoFilters } from './videoFormat';

type ZoneProps = {
    icon: SvgIconComponent;
    title: string;
    hint: string;
    multiple?: boolean;
    onFiles(paths: string[]): void;
};

// 処理ごとのファイルの受け皿 (アイコン・処理の名前・操作の案内)
function SourceZone({ icon: Icon, title, hint, multiple, onFiles }: ZoneProps) {
    const { t } = useTranslation();
    return (
        <FileDropZone
            onFiles={onFiles}
            filters={videoFilters(t)}
            accept={VIDEO_EXTENSIONS}
            multiple={multiple}
            onRejected={() => showNotice('warning', t('videoSplitMergePage.unsupportedFile'))}
            sx={{ flexGrow: 1, flexBasis: 0, minHeight: 160 }}
        >
            <Stack spacing={1} sx={{ alignItems: 'center' }}>
                <Icon sx={{ fontSize: 40, color: 'text.secondary' }} />
                <Typography variant='subtitle1' sx={{ fontWeight: 700 }}>
                    {title}
                </Typography>
                <Typography color='text.secondary' align='center' sx={{ whiteSpace: 'pre-line' }}>
                    {hint}
                </Typography>
            </Stack>
        </FileDropZone>
    );
}

type Props = {
    onSplit(paths: string[]): void;
    onMerge(paths: string[]): void;
};

// 初めに表示する、処理ごとのファイルの受け皿 (上: チャプターで分割する 1 ファイル、下: 結合する複数のファイル)
export default function SourceSelect({ onSplit, onMerge }: Props) {
    const { t } = useTranslation();
    return (
        <>
            <SourceZone
                icon={ContentCutIcon}
                title={t('videoSplitMergePage.splitTitle')}
                hint={t('videoSplitMergePage.splitDropHint')}
                onFiles={onSplit}
            />
            <SourceZone
                icon={CallMergeIcon}
                title={t('videoSplitMergePage.mergeTitle')}
                hint={t('videoSplitMergePage.mergeDropHint')}
                multiple
                onFiles={onMerge}
            />
        </>
    );
}
