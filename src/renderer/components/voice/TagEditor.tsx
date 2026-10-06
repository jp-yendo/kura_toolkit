import React from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

type EditorRange = {
    start: number;
    end: number;
};

export type TagEditorHandle = {
    // カーソル位置に挿入する (選択範囲があれば置き換える)
    insert(text: string): void;
    // 選択範囲を囲む。選択が無ければ placeholder を挟んで挿入する
    wrap(before: string, after: string, placeholder: string): void;
    // 指定の範囲を選択してその位置までスクロールする
    focusRange(offset: number, length: number): void;
};

type Props = {
    value: string;
    onChange(value: string): void;
    // 制御タグとして解釈される範囲 (色を付ける)
    tagRanges: EditorRange[];
    // 誤りの範囲 (波線で強調する)
    errorRanges: EditorRange[];
    placeholder?: string;
    disabled?: boolean;
    // 中身に合わせて高さを変える (表の中の入力欄。スクロールせず、余白も小さくする)
    autoHeight?: boolean;
    onFocus?(): void;
    // 支援技術に伝える名前 (見出しの無い入力欄で使う)
    ariaLabel?: string;
};

const FONT_SIZE = 14;
const LINE_HEIGHT = 1.7;
const PADDING = 12;
const AUTO_HEIGHT_PADDING = 6;

// 制御タグと誤りを強調表示する文章入力欄。
// 透明な textarea の背後に同じ文字組みの要素を置き、その要素側で範囲に色を付ける。
// 両者の折り返し位置を一致させるため、フォント・余白・スクロールバーの幅をそろえる。
const TagEditor = React.forwardRef<TagEditorHandle, Props>(function TagEditor(
    { value, onChange, tagRanges, errorRanges, placeholder, disabled, autoHeight = false, onFocus, ariaLabel },
    ref
) {
    const padding = autoHeight ? AUTO_HEIGHT_PADDING : PADDING;
    const theme = useTheme();
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const backdropRef = React.useRef<HTMLDivElement>(null);

    const syncScroll = () => {
        if (textareaRef.current && backdropRef.current) {
            backdropRef.current.scrollTop = textareaRef.current.scrollTop;
            backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    };

    // 範囲を text に置き換えてから、指定の範囲を選択する。
    // 入力欄への編集操作として入れるため、Ctrl+Z (元に戻す) で取り消せる。
    // 呼び出し元のダイアログが閉じて入力欄にフォーカスを移せるようになってから行う
    const replaceRange = (start: number, end: number, text: string, selectStart: number, selectEnd: number) => {
        requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea || textarea.disabled) return;
            textarea.focus();
            textarea.setSelectionRange(start, end);
            // execCommand は非推奨だが、入力欄の「元に戻す」の履歴に残せる挿入方法はほかに無いため使う
            if (!document.execCommand('insertText', false, text)) {
                // 挿入できない環境では値を直接置き換える (この場合は Ctrl+Z では戻せない)
                textarea.setRangeText(text, start, end);
                onChange(textarea.value);
            }
            textarea.setSelectionRange(selectStart, selectEnd);
            syncScroll();
        });
    };

    React.useImperativeHandle(ref, () => ({
        insert(text) {
            const textarea = textareaRef.current;
            const start = textarea?.selectionStart ?? value.length;
            const end = textarea?.selectionEnd ?? value.length;
            replaceRange(start, end, text, start + text.length, start + text.length);
        },
        wrap(before, after, placeholderText) {
            const textarea = textareaRef.current;
            const start = textarea?.selectionStart ?? value.length;
            const end = textarea?.selectionEnd ?? value.length;
            const inner = end > start ? value.slice(start, end) : placeholderText;
            replaceRange(
                start,
                end,
                before + inner + after,
                start + before.length,
                start + before.length + inner.length
            );
        },
        focusRange(offset, length) {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(offset, Math.min(value.length, offset + length));
            // 選択位置の行が見えるようにスクロールする
            const line = value.slice(0, offset).split('\n').length - 1;
            const lineHeightPx = FONT_SIZE * LINE_HEIGHT;
            if (autoHeight) {
                // 高さが中身に合っているため、入力欄そのものが見えるようにする
                textarea.scrollIntoView({ block: 'nearest' });
            } else {
                textarea.scrollTop = Math.max(0, line * lineHeightPx - textarea.clientHeight / 3);
            }
            syncScroll();
        },
    }));

    // 範囲の境界で文章を区切り、区間ごとに色付けの種類を決める
    const segments = React.useMemo(() => {
        const boundaries = new Set<number>([0, value.length]);
        for (const range of [...tagRanges, ...errorRanges]) {
            boundaries.add(Math.max(0, Math.min(value.length, range.start)));
            boundaries.add(Math.max(0, Math.min(value.length, range.end)));
        }
        const points = [...boundaries].sort((a, b) => a - b);
        const result: { text: string; tag: boolean; error: boolean }[] = [];
        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i + 1];
            if (end <= start) continue;
            const inside = (ranges: EditorRange[]) => ranges.some(range => range.start <= start && range.end >= end);
            result.push({ text: value.slice(start, end), tag: inside(tagRanges), error: inside(errorRanges) });
        }
        return result;
    }, [value, tagRanges, errorRanges]);

    const sharedSx = {
        position: 'absolute',
        inset: 0,
        m: 0,
        p: `${padding}px`,
        border: 0,
        fontFamily: theme.typography.fontFamily,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        letterSpacing: 'normal',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        // 高さを中身に合わせる場合はスクロールさせない (両方の折り返し位置をそろえるため、どちらにもスクロールバーを出さない)
        overflowY: autoHeight ? 'hidden' : 'scroll',
        overflowX: 'hidden',
        scrollbarGutter: autoHeight ? 'auto' : 'stable',
        boxSizing: 'border-box',
        tabSize: 4,
    } as const;

    return (
        <Box
            sx={{
                position: 'relative',
                flexGrow: autoHeight ? 0 : 1,
                minHeight: autoHeight ? undefined : 160,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                bgcolor: disabled ? 'action.disabledBackground' : 'background.paper',
                overflow: 'hidden',
                '&:focus-within': { borderColor: 'primary.main' },
            }}
        >
            {/* 高さを中身に合わせる場合は、背後の要素を文書の流れに置いて高さを決めさせ、入力欄をその上に重ねる */}
            <Box
                ref={backdropRef}
                aria-hidden
                sx={{
                    ...sharedSx,
                    ...(autoHeight ? { position: 'relative', inset: 'auto' } : {}),
                    color: 'transparent',
                    pointerEvents: 'none',
                }}
            >
                {segments.map((segment, index) => (
                    <Box
                        key={index}
                        component='span'
                        sx={{
                            bgcolor: segment.error
                                ? alpha(theme.palette.error.main, 0.18)
                                : segment.tag
                                  ? alpha(theme.palette.primary.main, 0.14)
                                  : undefined,
                            borderRadius: segment.tag || segment.error ? '3px' : undefined,
                            textDecoration: segment.error ? 'underline wavy' : undefined,
                            textDecorationColor: segment.error ? theme.palette.error.main : undefined,
                        }}
                    >
                        {segment.text}
                    </Box>
                ))}
                {/* 末尾の改行の高さを確保する (高さを中身に合わせる場合は、空のときと末尾が改行のときだけ 1 行分) */}
                {autoHeight ? (value === '' || value.endsWith('\n') ? ' ' : '') : '\n '}
            </Box>
            <Box
                component='textarea'
                ref={textareaRef}
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                spellCheck={false}
                aria-label={ariaLabel}
                onFocus={onFocus}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
                onScroll={syncScroll}
                sx={{
                    ...sharedSx,
                    width: '100%',
                    height: '100%',
                    resize: 'none',
                    outline: 'none',
                    bgcolor: 'transparent',
                    color: 'text.primary',
                    caretColor: theme.palette.text.primary,
                    '&::placeholder': { color: 'text.disabled' },
                }}
            />
        </Box>
    );
});

export default TagEditor;
