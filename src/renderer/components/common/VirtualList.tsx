import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type Props = {
    count: number;
    // 1 行の高さ (px)。全行で同じ高さにする
    rowHeight: number;
    // index 番目の行の中身
    renderRow(index: number): React.ReactNode;
    sx?: SxProps<Theme>;
};

// 見えている範囲の前後に余分に描く行数 (速くスクロールしたときに空白が見えないようにする)
const OVERSCAN_ROWS = 10;
// スクロールさせる要素の高さの上限 (px)。ブラウザには要素の高さの上限 (Chromium で約 3,300 万 px) があり、
// 超えると末尾の行まで届かなくなるため、これを超える一覧はスクロール位置を縮尺して行に対応させる
const MAX_SCROLL_HEIGHT_PX = 10_000_000;

// 縦にスクロールする一覧のうち、見えている行だけを描く。
// 行数が数十万になっても、描く要素の数は枠の高さぶんで変わらない
export default function VirtualList({ count, rowHeight, renderRow, sx }: Props) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(0);

    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        setViewportHeight(element.clientHeight);
        const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const contentHeight = count * rowHeight;
    const scrollHeight = Math.min(contentHeight, MAX_SCROLL_HEIGHT_PX);

    // 行数が減って今の位置より下に行が無くなった場合も、残った行が見えるようにする
    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const maxScrollTop = Math.max(0, scrollHeight - element.clientHeight);
        if (element.scrollTop > maxScrollTop) element.scrollTop = maxScrollTop;
        setScrollTop(element.scrollTop);
    }, [scrollHeight]);

    // スクロール位置 (縮尺したもの) を、行を並べた本来の位置に直す
    const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
    const contentMaxScrollTop = Math.max(0, contentHeight - viewportHeight);
    const ratio = maxScrollTop > 0 ? contentMaxScrollTop / maxScrollTop : 1;
    const contentTop = Math.min(scrollTop, maxScrollTop) * ratio;

    const first = Math.max(0, Math.floor(contentTop / rowHeight) - OVERSCAN_ROWS);
    const last = Math.min(count, Math.ceil((contentTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS);
    const rows: React.ReactNode[] = [];
    for (let index = first; index < last; index++) {
        // 本来の位置から今のスクロール量を引き、実際にスクロールしている量を足して、見えている位置に置く
        const top = index * rowHeight - contentTop + scrollTop;
        // 位置はスクロールのたびに変わるため sx ではなく style で渡す (sx だと値ごとに CSS のクラスが増え続ける)
        rows.push(
            <div key={index} style={{ position: 'absolute', top, left: 0, right: 0, height: rowHeight }}>
                {renderRow(index)}
            </div>
        );
    }

    return (
        <Box
            ref={containerRef}
            onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
            sx={{ overflowY: 'auto', overflowX: 'hidden', ...sx }}
        >
            <div style={{ position: 'relative', height: scrollHeight }}>{rows}</div>
        </Box>
    );
}
