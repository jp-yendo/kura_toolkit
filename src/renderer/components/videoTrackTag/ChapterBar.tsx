import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { EditChapter } from '../../stores/videoTrackTagStore';

type Props = {
    chapters: EditChapter[];
    durationSec: number;
    // 再生位置 (秒)
    position: number;
    // 再生位置が含まれるチャプター (無ければ null)
    currentId: string | null;
    // 押した位置の時刻へ移る
    onSeek(time: number): void;
    // 帯の名前 (読み上げ用)
    label: string;
};

// キーボードの左右で動かす秒数
const KEY_STEP_SEC = 5;

// 帯の高さ (px)
const BAR_HEIGHT = 34;

// プレビューの幅いっぱいに、チャプターの位置を帯で示す (各チャプターの左上に小さく番号、その下に名前を入れ、収まらない分は省く。
// 再生位置の線と、再生位置のチャプターを強調する)
export default function ChapterBar({ chapters, durationSec, position, currentId, onSeek, label }: Props) {
    const percent = (time: number) => `${Math.min(100, Math.max(0, (time / durationSec) * 100))}%`;
    return (
        <Box
            role='slider'
            tabIndex={0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={durationSec}
            aria-valuenow={position}
            onKeyDown={event => {
                if (event.key === 'ArrowLeft') onSeek(Math.max(0, position - KEY_STEP_SEC));
                else if (event.key === 'ArrowRight') onSeek(Math.min(durationSec, position + KEY_STEP_SEC));
                else return;
                event.preventDefault();
            }}
            onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                onSeek(((event.clientX - rect.left) / rect.width) * durationSec);
            }}
            sx={{
                position: 'relative',
                height: BAR_HEIGHT,
                borderRadius: 1,
                bgcolor: 'action.hover',
                cursor: 'pointer',
                overflow: 'hidden',
            }}
        >
            {durationSec > 0 &&
                chapters.map((chapter, i) => (
                    <Tooltip key={chapter.id} title={`${i + 1}: ${chapter.title}`}>
                        <Box
                            sx={theme => ({
                                position: 'absolute',
                                top: 2,
                                bottom: 2,
                                left: percent(chapter.start),
                                width: `calc(${percent(chapter.end - chapter.start)} - 2px)`,
                                ml: '1px',
                                px: 0.5,
                                pt: '2px',
                                borderRadius: 0.5,
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                lineHeight: 1,
                                color: chapter.id === currentId ? 'primary.contrastText' : 'text.primary',
                                bgcolor:
                                    chapter.id === currentId
                                        ? 'primary.main'
                                        : alpha(theme.palette.primary.main, i % 2 === 0 ? 0.35 : 0.2),
                            })}
                        >
                            <Box component='span' sx={{ fontSize: 9, opacity: 0.8 }}>
                                {i + 1}
                            </Box>
                            <Box
                                component='span'
                                sx={{ mt: '3px', pl: 0.5, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                                {chapter.title}
                            </Box>
                        </Box>
                    </Tooltip>
                ))}
            {durationSec > 0 && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: percent(position),
                        width: 2,
                        ml: '-1px',
                        bgcolor: 'text.primary',
                        pointerEvents: 'none',
                    }}
                />
            )}
        </Box>
    );
}
