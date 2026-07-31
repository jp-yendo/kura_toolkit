import type { SvgIconComponent } from '@mui/icons-material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import PolylineIcon from '@mui/icons-material/Polyline';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';

// 機能カテゴリ (タイトルバーのメニューとダッシュボードの分類)
export type FeatureCategory = 'audio' | 'video' | 'image' | 'tools';

export const FEATURE_CATEGORIES: FeatureCategory[] = ['audio', 'video', 'image', 'tools'];

export type FeatureDef = {
    id: string;
    category: FeatureCategory;
    route: string;
    icon: SvgIconComponent;
    // ダッシュボードカードのアイコン背景色
    color: string;
    titleKey: string;
    descKey: string;
};

// 機能レジストリ: タイトルバーのドロップダウンとダッシュボードのカードが共用する
export const FEATURES: FeatureDef[] = [
    {
        id: 'audioNormalizer',
        category: 'audio',
        route: '/audio/normalizer',
        icon: GraphicEqIcon,
        color: '#1976d2',
        titleKey: 'features.audioNormalizer.title',
        descKey: 'features.audioNormalizer.desc',
    },
    {
        id: 'chapterCut',
        category: 'video',
        route: '/video/chapter-cut',
        icon: ContentCutIcon,
        color: '#e65100',
        titleKey: 'features.chapterCut.title',
        descKey: 'features.chapterCut.desc',
    },
    {
        id: 'svgConverter',
        category: 'image',
        route: '/image/svg-converter',
        icon: PolylineIcon,
        color: '#7b1fa2',
        titleKey: 'features.svgConverter.title',
        descKey: 'features.svgConverter.desc',
    },
    {
        id: 'cleanup',
        category: 'tools',
        route: '/tools/cleanup',
        icon: CleaningServicesIcon,
        color: '#2e7d32',
        titleKey: 'features.cleanup.title',
        descKey: 'features.cleanup.desc',
    },
];

export function featuresByCategory(category: FeatureCategory): FeatureDef[] {
    return FEATURES.filter(feature => feature.category === category);
}

// 現在のルートに対応する画面タイトルの翻訳キーを返す
// (タイトルは各ページではなくタイトルバーに表示する)
export function titleKeyForRoute(pathname: string): string {
    if (pathname === '/settings') return 'settingsPage.title';
    const feature = FEATURES.find(item => item.route === pathname);
    return feature ? feature.titleKey : 'dashboard.title';
}
