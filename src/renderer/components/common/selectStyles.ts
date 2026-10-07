import type { SxProps, Theme } from '@mui/material';

// モデルの名前などを省略せずに示す Select・MenuItem の sx。MUI の Select と MenuItem は、既定では 1 行に収めて
// はみ出した分を省略するため、長い名前は途中で切れて見分けられなくなる。ここでは折り返して全部示す
export const wrapSelectSx: SxProps<Theme> = {
    '& .MuiSelect-select': { whiteSpace: 'normal', overflowWrap: 'anywhere' },
};

export const wrapMenuItemSx: SxProps<Theme> = { whiteSpace: 'normal', overflowWrap: 'anywhere' };
