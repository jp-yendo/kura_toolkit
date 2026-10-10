import { Chip, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { SvgAutoVersion } from '@shared/types';
import { formatBytes } from '../voice/voiceFormat';

// 再現度の表示の桁数
const FIDELITY_DIGITS = 3;

// 版の名前 (試行の候補は順位、補正の版は「補正」)
export function versionTitle(t: TFunction, version: SvgAutoVersion): string {
    return version.source.kind === 'trial'
        ? t('svgAutoPage.trialVersion', { rank: version.source.rank })
        : t('svgAutoPage.refineVersion');
}

// 版の再現度・パス数・大きさ
export function versionMetrics(t: TFunction, version: SvgAutoVersion): string {
    return t('svgAutoPage.metrics', {
        fidelity: version.fidelity.toFixed(FIDELITY_DIGITS),
        paths: version.pathCount.toLocaleString(),
        size: formatBytes(version.bytes),
    });
}

// 版の出どころの説明 (試行の候補は元にしたプリセットか探索した設定と段階の数、補正の版は採った調整)
function versionDetail(t: TFunction, version: SvgAutoVersion): string {
    const { source } = version;
    if (source.kind === 'refine') {
        return source.adjustments.map(adjustment => t(`svgAutoPage.adjustments.${adjustment}`)).join(' + ');
    }
    const setting = version.presetNameKey ? t(version.presetNameKey) : t('svgAutoPage.tuned');
    return source.grayLevels ? `${setting} / ${t('svgAutoPage.grayLevels', { count: source.grayLevels })}` : setting;
}

type Props = {
    versions: SvgAutoVersion[];
    selectedId: string | null;
    bestId: string;
    onSelect(id: string): void;
};

// 自動変換の版の一覧 (再現度・パス数・大きさ)。最も再現度の高い版に印を付ける
export default function SvgAutoVersionList({ versions, selectedId, bestId, onSelect }: Props) {
    const { t } = useTranslation();
    return (
        <List dense disablePadding>
            {versions.map(version => (
                <ListItemButton
                    key={version.id}
                    selected={version.id === selectedId}
                    onClick={() => onSelect(version.id)}
                    sx={{ borderRadius: 1, mb: 0.5, alignItems: 'flex-start' }}
                >
                    <ListItemText
                        primary={
                            <Stack direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                                <Typography variant='body2' sx={{ fontWeight: 600 }}>
                                    {versionTitle(t, version)}
                                </Typography>
                                {version.id === bestId && (
                                    <Chip
                                        size='small'
                                        color='primary'
                                        variant='outlined'
                                        label={t('svgAutoPage.best')}
                                    />
                                )}
                            </Stack>
                        }
                        secondary={
                            <>
                                <Typography
                                    component='span'
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ display: 'block' }}
                                >
                                    {versionDetail(t, version)}
                                </Typography>
                                <Typography
                                    component='span'
                                    variant='body2'
                                    color='text.secondary'
                                    sx={{ display: 'block' }}
                                >
                                    {versionMetrics(t, version)}
                                </Typography>
                            </>
                        }
                        slotProps={{ primary: { component: 'div' }, secondary: { component: 'div' } }}
                    />
                </ListItemButton>
            ))}
        </List>
    );
}
