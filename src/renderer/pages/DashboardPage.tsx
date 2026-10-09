import { Avatar, Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useGuardedNavigate } from '../stores/navigationGuard';
import PageContainer from '../components/common/PageContainer';
import SectionLabel from '../components/common/SectionLabel';
import { FEATURE_CATEGORIES, featuresByCategory, featureUnavailableKey, type FeatureDef } from '../navigation/features';
import { useVoicePlatform } from '../stores/voicePlatformStore';

// 1 行に並べるカードの最大数と、カードの最小幅・列の間隔 (px。間隔は theme.spacing(2))
const MAX_COLUMNS = 4;
const MIN_CARD_WIDTH = 220;
const COLUMN_GAP_PX = 16;
// カテゴリの行と行の間を、カードの行の間 (theme.spacing(1)) より広げる量
const GROUP_GAP = 2;

// 列数 n を使える幅 (コンテナクエリの境目)
function minWidthFor(columns: number): number {
    return columns * MIN_CARD_WIDTH + (columns - 1) * COLUMN_GAP_PX;
}

// 機能が count 個のカテゴリが、列数 columns のときに使う範囲 (横は列数まで。縦は見出しの 1 行とカードの行数)
function groupArea(count: number, columns: number) {
    return {
        gridColumn: `span ${Math.min(count, columns)}`,
        gridRow: `span ${Math.ceil(count / columns) + 1}`,
    };
}

// 列数を幅に応じて 1〜4 に切り替える (コンテナクエリ)。並べ方は 4 列のときの決まりを、そのまま少ない列で使う
function responsive<T extends object>(build: (columns: number) => T): Record<string, T> {
    const result: Record<string, T> = {};
    for (let columns = 2; columns <= MAX_COLUMNS; columns++) {
        result[`@container (min-width: ${minWidthFor(columns)}px)`] = build(columns);
    }
    return result;
}

// unavailableKey: その環境で使えない機能の理由 (翻訳キー)。指定すると選べなくし、理由をツールチップで示す
function FeatureCard({
    feature,
    onOpen,
    unavailableKey,
}: {
    feature: FeatureDef;
    onOpen: () => void;
    unavailableKey: string | null;
}) {
    const { t } = useTranslation();
    const Icon = feature.icon;
    const card = (
        <ButtonBase
            onClick={onOpen}
            disabled={unavailableKey !== null}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                justifyContent: 'flex-start',
                gap: 1,
                p: 1.5,
                borderRadius: 2,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                textAlign: 'left',
                minWidth: 0,
                transition: 'background-color 0.15s, border-color 0.15s',
                '&:hover': { bgcolor: 'action.hover', borderColor: 'text.disabled' },
                '&.Mui-disabled': { opacity: theme => theme.palette.action.disabledOpacity },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                <Avatar
                    variant='rounded'
                    sx={{
                        bgcolor: feature.color,
                        // Avatar の既定色は背景色に追随して暗くなるため明示する
                        color: '#fff',
                        width: 32,
                        height: 32,
                    }}
                >
                    <Icon sx={{ fontSize: 20 }} />
                </Avatar>
                <Typography
                    sx={{
                        fontWeight: 600,
                        fontSize: '0.95rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {t(feature.titleKey)}
                </Typography>
            </Box>
            <Typography variant='body2' color='text.secondary' sx={{ lineHeight: 1.6 }}>
                {t(feature.descKey)}
            </Typography>
        </ButtonBase>
    );
    if (unavailableKey === null) return card;
    // 選べないボタンはマウスの操作を受けないため、ツールチップは外側の枠に付ける (枠はグリッドの 1 マスを埋める)
    return (
        <Tooltip title={t(unavailableKey)}>
            <Box sx={{ display: 'flex', minWidth: 0, '& > *': { flexGrow: 1 } }}>{card}</Box>
        </Tooltip>
    );
}

export default function DashboardPage() {
    const { t } = useTranslation();
    const navigate = useGuardedNavigate();
    const platform = useVoicePlatform();

    return (
        <PageContainer sx={{ maxWidth: 1400, mx: 'auto', width: '100%' }}>
            <Box sx={{ containerType: 'inline-size' }}>
                {/*
                 * カテゴリごとにカードを横に並べ、カテゴリを前から順に行へ詰める (グリッドの自動配置)。
                 * いまの行の空きに収まらないカテゴリは次の行へ送られ、列数より多いカテゴリは全幅で複数の行を使う。
                 * 先頭の行の見出しの上に余白が付かないよう、付けた分だけ上へずらす
                 */}
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr)',
                        ...responsive(columns => ({ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` })),
                        columnGap: 2,
                        rowGap: 1,
                        mt: -GROUP_GAP,
                    }}
                >
                    {FEATURE_CATEGORIES.map(category => {
                        const features = featuresByCategory(category);
                        if (features.length === 0) return null;
                        return (
                            // 見出しとカードの行をグリッド全体と共有し (subgrid)、同じ行のカードの高さをカテゴリをまたいでそろえる
                            <Box
                                key={category}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: 'subgrid',
                                    gridTemplateRows: 'subgrid',
                                    ...groupArea(features.length, 1),
                                    ...responsive(columns => groupArea(features.length, columns)),
                                }}
                            >
                                <SectionLabel sx={{ gridColumn: '1 / -1', pt: GROUP_GAP }}>
                                    {t(`nav.${category}`)}
                                </SectionLabel>
                                {features.map(feature => (
                                    <FeatureCard
                                        key={feature.id}
                                        feature={feature}
                                        onOpen={() => navigate(feature.route)}
                                        unavailableKey={featureUnavailableKey(feature, platform)}
                                    />
                                ))}
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        </PageContainer>
    );
}
