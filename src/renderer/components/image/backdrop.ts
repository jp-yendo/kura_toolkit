import type { SxProps, Theme } from '@mui/material/styles';
import { IMAGE_BACKDROP_COLORS } from '../../theme';

// 透過した画像を確かめる背景 (市松・白・黒)

export type ImageBackdrop = 'checker' | 'white' | 'black';

// 市松の 1 マスの大きさ (px)
const CHECKER_CELL_PX = 8;

// 背景の見た目 (画像の要素に付ける)
export function backdropSx(backdrop: ImageBackdrop): SxProps<Theme> {
    if (backdrop === 'white') return { bgcolor: IMAGE_BACKDROP_COLORS.white };
    if (backdrop === 'black') return { bgcolor: IMAGE_BACKDROP_COLORS.black };
    const { checkerLight: light, checkerDark: dark } = IMAGE_BACKDROP_COLORS;
    return {
        backgroundColor: light,
        backgroundImage: `repeating-conic-gradient(${dark} 0% 25%, ${light} 0% 50%)`,
        backgroundSize: `${CHECKER_CELL_PX * 2}px ${CHECKER_CELL_PX * 2}px`,
    };
}
