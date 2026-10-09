import type { SvgIconComponent } from '@mui/icons-material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import PolylineIcon from '@mui/icons-material/Polyline';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import CampaignIcon from '@mui/icons-material/Campaign';
import { FEATURE_COLORS } from '../theme';
import { featureUnavailableReasonKey, isFeatureHidden } from '@shared/voice/availability';
import type { VoiceFeatureId, VoicePlatformInfo } from '@shared/voice/types';

// 機能カテゴリ (タイトルバーのメニューとダッシュボードの分類)
export type FeatureCategory = 'audio' | 'video' | 'image' | 'tools';

export const FEATURE_CATEGORIES: FeatureCategory[] = ['audio', 'video', 'image', 'tools'];

export type FeatureDef = {
    id: string;
    category: FeatureCategory;
    route: string;
    icon: SvgIconComponent;
    // ダッシュボードカードのアイコン背景色 (白いアイコンを載せる前提の濃さ)
    color: string;
    titleKey: string;
    descKey: string;
    // 音声機能 (使えない環境ではメニューとダッシュボードで選べなくする)
    voiceFeature?: VoiceFeatureId;
};

// 機能レジストリ: タイトルバーのドロップダウンとダッシュボードのカードが共用する
export const FEATURES: FeatureDef[] = [
    {
        id: 'audioNormalizer',
        category: 'audio',
        route: '/audio/normalizer',
        icon: GraphicEqIcon,
        color: FEATURE_COLORS.audio,
        titleKey: 'features.audioNormalizer.title',
        descKey: 'features.audioNormalizer.desc',
    },
    {
        id: 'separation',
        category: 'audio',
        route: '/audio/separation',
        icon: CallSplitIcon,
        color: FEATURE_COLORS.audio,
        titleKey: 'features.separation.title',
        descKey: 'features.separation.desc',
        voiceFeature: 'separation',
    },
    {
        id: 'conversion',
        category: 'audio',
        route: '/audio/conversion',
        icon: RecordVoiceOverIcon,
        color: FEATURE_COLORS.audio,
        titleKey: 'features.conversion.title',
        descKey: 'features.conversion.desc',
        voiceFeature: 'conversion',
    },
    {
        id: 'tts',
        category: 'audio',
        route: '/audio/tts',
        icon: CampaignIcon,
        color: FEATURE_COLORS.audio,
        titleKey: 'features.tts.title',
        descKey: 'features.tts.desc',
        voiceFeature: 'tts',
    },
    {
        id: 'chapterCut',
        category: 'video',
        route: '/video/chapter-cut',
        icon: ContentCutIcon,
        color: FEATURE_COLORS.video,
        titleKey: 'features.chapterCut.title',
        descKey: 'features.chapterCut.desc',
    },
    {
        id: 'svgConverter',
        category: 'image',
        route: '/image/svg-converter',
        icon: PolylineIcon,
        color: FEATURE_COLORS.image,
        titleKey: 'features.svgConverter.title',
        descKey: 'features.svgConverter.desc',
    },
    {
        id: 'cleanup',
        category: 'tools',
        route: '/tools/cleanup',
        icon: CleaningServicesIcon,
        color: FEATURE_COLORS.tools,
        titleKey: 'features.cleanup.title',
        descKey: 'features.cleanup.desc',
    },
];

// 機能の中で切り替える画面 (声のモデルの管理・モデルの学習)。メニューには出さず、機能の画面上端の切り替えから開く。
// 画面タイトルは機能の名前とし、どの画面かは切り替えの表示で示す
const SUB_ROUTE_TITLES: Record<string, string> = {
    '/audio/conversion/models': 'features.conversion.title',
    '/audio/conversion/training': 'features.conversion.title',
    '/audio/tts/models': 'features.tts.title',
    '/audio/tts/training': 'features.tts.title',
};

// 機能をその環境で使えない理由の翻訳キー (使える場合と、環境がまだ分からない場合は null)。
// アプリが固定している版のライブラリに、その環境向けの配布物が無い機能が当てはまる
export function featureUnavailableKey(feature: FeatureDef, platform: VoicePlatformInfo | null): string | null {
    if (!feature.voiceFeature || !platform || !isFeatureHidden(platform, feature.voiceFeature)) return null;
    return featureUnavailableReasonKey(platform, feature.voiceFeature);
}

export function featuresByCategory(category: FeatureCategory): FeatureDef[] {
    return FEATURES.filter(feature => feature.category === category);
}

// 現在のルートに対応する画面タイトルの翻訳キーを返す
// (タイトルは各ページではなくタイトルバーに表示する)
export function titleKeyForRoute(pathname: string): string {
    if (pathname === '/settings') return 'settingsPage.title';
    if (SUB_ROUTE_TITLES[pathname]) return SUB_ROUTE_TITLES[pathname];
    const feature = FEATURES.find(item => item.route === pathname);
    return feature ? feature.titleKey : 'dashboard.title';
}
