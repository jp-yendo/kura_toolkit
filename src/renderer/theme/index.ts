import { createTheme, type Theme } from '@mui/material/styles';

// アプリの配色はここで一元管理する。
// ライト/ダークどちらでも十分なコントラストが取れる値を選ぶこと。

// 機能カードのアイコン背景。白いアイコンを載せるため、
// ライト/ダークどちらの背景に置いても白との対比が 3:1 以上になる濃さにする。
export const FEATURE_COLORS = {
    audio: '#1565c0',
    video: '#c2410c',
    image: '#6d28d9',
    tools: '#15803d',
} as const;

export type FeatureColorKey = keyof typeof FEATURE_COLORS;

export function createAppTheme(mode: 'light' | 'dark'): Theme {
    const isDark = mode === 'dark';

    return createTheme({
        palette: {
            mode,
            // ライトでは面 (paper) を白、下地をわずかに灰色にして枠が沈まないようにする
            background: isDark ? { default: '#0a0a0a', paper: '#161616' } : { default: '#f4f5f7', paper: '#ffffff' },
        },
        components: {
            MuiAlert: {
                defaultProps: {
                    // filled はダークで背景と文字色の組み合わせが破綻する (緑地に黒文字など) ため
                    // 両モード向けに設計されている standard を既定にする
                    variant: 'standard',
                },
                styleOverrides: {
                    root: {
                        // 通知は本文の上に重なるため、枠と影で面を分離する
                        border: '1px solid',
                        borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)',
                    },
                },
            },
        },
    });
}
