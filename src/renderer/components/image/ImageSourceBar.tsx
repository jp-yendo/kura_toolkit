import React from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import Panel from '../common/Panel';

type Props = {
    // 選んだ画像のパスと表示用 URL
    path: string;
    url: string;
    onReselect(): void;
    disabled?: boolean;
};

// 選んだ画像のファイル名と大きさ (幅 x 高さ px)、選び直すボタンの行。ファイル名の全体 (パス) はツールチップで示す
export default function ImageSourceBar({ path, url, onReselect, disabled }: Props) {
    const { t } = useTranslation();
    const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
    React.useEffect(() => {
        setSize(null);
        const image = new Image();
        image.onload = () => setSize({ width: image.naturalWidth, height: image.naturalHeight });
        image.src = url;
        return () => {
            image.onload = null;
        };
    }, [url]);
    const fileName = path.split(/[\\/]/).pop() ?? path;
    return (
        <Panel sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <Stack sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap title={path}>
                    {fileName}
                </Typography>
                <Typography variant='caption' color='text.secondary' sx={{ minHeight: '1.66em' }}>
                    {size ? t('svgPage.imageSize', size) : ''}
                </Typography>
            </Stack>
            <Button size='small' onClick={onReselect} disabled={disabled} sx={{ flexShrink: 0 }}>
                {t('svgPage.reselectImage')}
            </Button>
        </Panel>
    );
}
