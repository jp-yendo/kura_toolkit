import { Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SEPARATOR_ARCH_LABELS, separatorFileNoteKey, separatorFileOutputs } from './separatorModelNotes';
import type { SeparationArch } from '@shared/voice/types';

const captionSx = { display: 'block', lineHeight: 1.5 } as const;

type Props = {
    filename: string;
    arch: SeparationArch;
    // 一覧にある出力の名前 (無ければ設定ファイルにある名前を示す)
    stems: string[];
    // 出力ごとの分離の品質 (SDR)
    sdr: Record<string, number | null>;
};

// 分離モデルの概要 (何をするモデルか・方式・出力・分離の品質)。ダウンロード画面と分離の画面で同じものを示す
export default function SeparatorModelSummary({ filename, arch, stems, sdr }: Props) {
    const { t } = useTranslation();
    const note = separatorFileNoteKey(filename);
    const outputs = separatorFileOutputs(filename, stems).join(t('voice.common.listSeparator'));
    const quality = Object.entries(sdr)
        .filter(([, value]) => value !== null)
        .map(([stem, value]) => `${stem} ${Number(value).toFixed(1)}`)
        .join(' / ');
    return (
        <>
            {note && (
                <Typography variant='caption' color='text.secondary' sx={captionSx}>
                    {t(note)}
                </Typography>
            )}
            <Typography variant='caption' color='text.secondary' sx={captionSx}>
                {t('voice.library.separatorArch', { arch: SEPARATOR_ARCH_LABELS[arch] })}
                {outputs && ` / ${t('voice.library.separatorOutputs', { outputs })}`}
            </Typography>
            {quality && (
                <Typography variant='caption' color='text.secondary' sx={captionSx}>
                    {t('voice.separation.quality', { values: quality })}
                </Typography>
            )}
        </>
    );
}
