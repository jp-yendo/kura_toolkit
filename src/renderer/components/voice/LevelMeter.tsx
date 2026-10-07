import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

// 入力レベルのメーター (録音中と、マイクテストで使う)。録音ソフトの入力メーターと同じく dB で並べ、バーに重ねた
// 目盛りと、ピークの値 (dB) を示す。右端は 0 dB (録れる最大。波形の上下の端)、左端は LEVEL_FLOOR_DB (これより小さい音は
// マイクの雑音くらいのため、声の範囲が広く見えるよう切る)

// メーターの左端 (dB)
const LEVEL_FLOOR_DB = -60;
// 超えないほうがよいライン (dB)。バーに赤い線で示し、ここから上はバーを赤にする
const LIMIT_DB = -3;
// ここから上はバーを黄にする (録音でよく目安にされるピークの範囲 -12〜-6 dB の上端)
const CAUTION_DB = -6;
// 目盛り (dB)。線をバーに重ね、数字はバーの下寄せで示す
const TICKS_DB = [-40, -20, -12, -6, 0];
// 幅とバーの高さ (px)、目盛りの数字の大きさ (px)
const WIDTH = 240;
const BAR_HEIGHT = 24;
const TICK_FONT_SIZE = 10;
// これ以上を音割れとみなすピーク (最大の 99%)
export const CLIPPING_LEVEL = 0.99;

// 振幅 (0〜1 のピーク) を dB にする (0 は -Infinity)
function levelDb(level: number): number {
    return level > 0 ? 20 * Math.log10(Math.min(1, level)) : -Infinity;
}

// dB をメーターの中の位置 (0〜1) にする
function fractionOf(db: number): number {
    return Math.min(1, Math.max(0, (db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB));
}

const percent = (db: number) => `${fractionOf(db) * 100}%`;

// showValue はピークの値 (dB) をバーの右に示すか (マイクテストだけ。録音中は示さない)。clippingLabel は音割れのときに
// その値のすぐ後ろに示す文言 (マイクテストだけで渡す)。trailing は、その右に並べるもの (経過時間など)
export default function LevelMeter({
    level,
    showValue = false,
    clippingLabel,
    trailing,
}: {
    level: number;
    showValue?: boolean;
    clippingLabel?: string;
    trailing?: React.ReactNode;
}) {
    const db = levelDb(level);
    const fraction = fractionOf(db);
    // バーの色は今のピークで変える (緑 → 黄 (-6 dB 以上) → 赤 (-3 dB 以上))
    const barColor = db >= LIMIT_DB ? 'error.main' : db >= CAUTION_DB ? 'warning.main' : 'success.main';
    return (
        // 並べたもの (バー・値・trailing) の間隔は、録音の部品の間隔 (12px) と同じにする
        <Stack direction='row' spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box
                role='meter'
                aria-valuemin={LEVEL_FLOOR_DB}
                aria-valuemax={0}
                aria-valuenow={Math.round(Math.max(LEVEL_FLOOR_DB, db))}
                sx={{
                    position: 'relative',
                    width: WIDTH,
                    height: BAR_HEIGHT,
                    flexShrink: 0,
                    borderRadius: 0.5,
                    overflow: 'hidden',
                    bgcolor: theme =>
                        theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[300],
                }}
            >
                {/* 今のピークまでのバー */}
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: `${fraction * 100}%`,
                        bgcolor: barColor,
                        transition: 'width 80ms linear',
                    }}
                />
                {/* 目盛りの線と数字 (数字は下寄せ。バーの色の上でも溝の上でも読めるよう、白に影を付ける) */}
                {TICKS_DB.map(tick => (
                    <React.Fragment key={tick}>
                        {tick < 0 && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: percent(tick),
                                    width: '1px',
                                    bgcolor: 'rgba(255, 255, 255, 0.35)',
                                }}
                            />
                        )}
                        <Typography
                            component='span'
                            sx={{
                                position: 'absolute',
                                bottom: 0,
                                ...(tick === 0 ? { right: 2 } : { left: `calc(${percent(tick)} + 2px)` }),
                                color: 'common.white',
                                textShadow: '0 0 2px rgba(0, 0, 0, 0.9)',
                                fontSize: TICK_FONT_SIZE,
                                lineHeight: `${TICK_FONT_SIZE + 2}px`,
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            {tick}
                        </Typography>
                    </React.Fragment>
                ))}
                {/* 超えないほうがよいライン (赤い線) */}
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: percent(LIMIT_DB),
                        width: '1px',
                        bgcolor: 'error.main',
                    }}
                />
            </Box>
            {showValue && (
                <>
                    {/* ピークの値。バーのすぐ右に左寄せで置き (桁が変わっても位置が動かないよう、最も長い「-60 dB」の幅だけ確保する。
                        メーターの左端より小さいときは -∞ dB)、超えないほうが
                        よいラインを超えたら赤。音割れのときは、値のすぐ後ろに続けてその旨を示す */}
                    <Typography
                        variant='body2'
                        color={db >= LIMIT_DB ? 'error' : 'text.secondary'}
                        sx={{ minWidth: '6ch', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                        {db > LEVEL_FLOOR_DB ? `${Math.round(db)} dB` : '-∞ dB'}
                        {clippingLabel && level >= CLIPPING_LEVEL && ` ${clippingLabel}`}
                    </Typography>
                </>
            )}
            {trailing}
        </Stack>
    );
}
