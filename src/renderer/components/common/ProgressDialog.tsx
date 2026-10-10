import React from 'react';
import {
    Box,
    Button,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    LinearProgress,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import LogView, { LOG_LINE_HEIGHT_PX, LOG_PADDING_PX } from './LogView';

type Props = {
    open: boolean;
    title: string;
    // 0-100。未指定なら不確定表示
    percent?: number;
    // 進捗バーを出すかどうか。総数が事前に分からず完了予測できない処理では false にする
    showProgressBar?: boolean;
    // n/m 件表示
    current?: number;
    total?: number;
    // 処理状況を表す短い一行 (件数など)
    status?: string;
    // 残り時間 (「残り 約 …」)。件数があるときは件数と同じ行に、間を空けて並べる
    remaining?: string;
    // 現在の処理対象。長さが変わってもダイアログの高さは変えない
    message?: string;
    // message に確保する行数。処理対象が変わるたびに高さが動くとちらつくため常に固定で確保する。
    // 既定は 1 行。フルパスなど 1 行に収まらないものを出す画面だけ 2 以上を渡す
    messageLines?: number;
    // 開閉して見せる詳細行 (並列処理でスレッドごとの現在位置を出すなど)。
    // 開閉ボタンはキャンセルと同じ行に置き、閉じている間は場所を取らない
    details?: string[];
    // 省略時はキャンセルボタンを表示しない (キャンセル不可の処理)
    onCancel?(): void;
};

// メッセージ欄の既定の行数。ファイル名なら 1 行で収まる。
// フルパスのような長文を出す画面は messageLines で 2 以上を指定する
const DEFAULT_MESSAGE_LINES = 1;
const MESSAGE_LINE_HEIGHT = 1.5;

// 詳細欄の高さは行数 (= 並列数) に合わせて変えるが、開閉でダイアログの高さが暴れないよう上下限を設ける。
// 収まらない分は枠の中で縦横にスクロールさせる
const DETAIL_MIN_LINES = 3;
const DETAIL_MAX_LINES = 10;
// 折り返さないので横スクロールバーが出る。その高さを見込まないと最終行が隠れ、
// 縦スクロールバーまで出てしまう
const DETAIL_SCROLLBAR_PX = 18;

function detailAreaHeight(lineCount: number): number {
    const lines = Math.min(Math.max(lineCount, DETAIL_MIN_LINES), DETAIL_MAX_LINES);
    return lines * LOG_LINE_HEIGHT_PX + LOG_PADDING_PX + DETAIL_SCROLLBAR_PX;
}

// キャンセル可能な進捗ダイアログ
export default function ProgressDialog({
    open,
    title,
    percent,
    showProgressBar = true,
    current,
    total,
    status,
    remaining,
    message,
    messageLines = DEFAULT_MESSAGE_LINES,
    details,
    onCancel,
}: Props) {
    const { t } = useTranslation();
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    // メッセージ欄はパスの長さで高さが変わらないよう行数を固定している。
    // message を使わない画面ではこの高さがそのまま余白になるため、message があるときだけ出す
    const showMessageArea = message !== undefined;
    const hasDetails = details !== undefined;
    // 高さを固定して、行数が増えても減ってもダイアログの大きさが変わらないようにする
    const detailHeight = detailAreaHeight(details?.length ?? 0);
    // ボタンが 1 つも無い場合 (取り消せない処理) はアクション行自体を出さない
    const hasActions = hasDetails || onCancel !== undefined;

    return (
        <Dialog open={open} maxWidth='sm' fullWidth>
            <DialogTitle>{title}</DialogTitle>
            {/* アクション行があるときは、その padding (8px) と合わせて 16px あれば足りるので
                既定の padding-bottom (20px) を詰める。
                アクション行が無いときは本文の下がそのままダイアログの端になるため既定のまま残す */}
            <DialogContent sx={hasActions ? { pb: 1 } : undefined}>
                {showProgressBar && (
                    <Box sx={{ mb: 1 }}>
                        {percent !== undefined ? (
                            <LinearProgress variant='determinate' value={Math.max(0, Math.min(100, percent))} />
                        ) : (
                            <LinearProgress />
                        )}
                    </Box>
                )}
                {((current !== undefined && total !== undefined) || remaining !== undefined) && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
                        {current !== undefined && total !== undefined && (
                            <Typography variant='body2' color='text.secondary'>
                                {current} / {total}
                            </Typography>
                        )}
                        {remaining !== undefined && (
                            <Typography variant='body2' color='text.secondary'>
                                {remaining}
                            </Typography>
                        )}
                    </Box>
                )}
                {status !== undefined && (
                    <Typography variant='body2' color='text.secondary'>
                        {status}
                    </Typography>
                )}
                {showMessageArea && (
                    <Typography
                        variant='body2'
                        color='text.secondary'
                        sx={{
                            // 常に同じ高さを確保し、収まらない分は末尾を省略する
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: messageLines,
                            overflow: 'hidden',
                            wordBreak: 'break-all',
                            lineHeight: MESSAGE_LINE_HEIGHT,
                            height: `${messageLines * MESSAGE_LINE_HEIGHT}em`,
                        }}
                    >
                        {message ?? ''}
                    </Typography>
                )}
                {hasDetails && (
                    <Collapse in={detailsOpen} unmountOnExit>
                        {/* 全行が定期的に書き換わるため自動で末尾へ飛ばさない。
                            パスは折り返さず、枠の中で縦横にスクロールさせる */}
                        <LogView
                            lines={details}
                            autoScroll={false}
                            wrap={false}
                            sx={{ mt: 1, height: detailHeight, minHeight: detailHeight, maxHeight: detailHeight }}
                        />
                    </Collapse>
                )}
            </DialogContent>
            {/* DialogActions の既定 padding (8px) だとボタンの文字が本文より内側にずれるため、
                ボタン自身の padding (8px) と合わせて本文の左右 (24px) に揃える */}
            {hasActions && (
                <DialogActions sx={{ px: 2, ...(hasDetails ? { justifyContent: 'space-between' } : null) }}>
                    {hasDetails && (
                        <Button size='small' color='inherit' onClick={() => setDetailsOpen(previous => !previous)}>
                            {detailsOpen ? t('common.hideDetails') : t('common.showDetails')}
                        </Button>
                    )}
                    {onCancel && <Button onClick={onCancel}>{t('common.cancel')}</Button>}
                </DialogActions>
            )}
        </Dialog>
    );
}
