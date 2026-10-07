import React from 'react';

type Options = {
    // 受け取ったファイルの絶対パス (受け付けたものだけ)
    onFiles(paths: string[]): void;
    // 受け付ける拡張子 (小文字、ドットなし)。省略時は無制限
    accept?: string[];
    // ディレクトリのドロップを許可する。renderer からはファイルかディレクトリか判別できないため、
    // 拡張子で絞り込まずにそのまま渡し、展開と絞り込みは呼び出し側 (main) に任せる
    allowDirectories?: boolean;
    // 複数を受け付ける (受け付けない場合は、受け付けたもののうち先頭の 1 つだけを渡す)
    multiple?: boolean;
    // 対象外の形式だけがドロップされたときの通知
    onRejected?(): void;
    // 受け付けない状態 (ドロップしても何もせず、ドラッグ中の強調もしない)
    disabled?: boolean;
};

// ファイルのドラッグ&ドロップ。要素に渡す handlers と、ドラッグ中か (強調の表示用) を返す。中の要素に出入りするたびに
// dragenter / dragleave が届くため、数を数えて外に出たときだけ強調を消す
export function useFileDrop({ onFiles, accept, allowDirectories, multiple, onRejected, disabled }: Options) {
    const [dragOver, setDragOver] = React.useState(false);
    const depth = React.useRef(0);

    const acceptPath = React.useCallback(
        (filePath: string) => {
            if (allowDirectories) return true;
            if (!accept || accept.length === 0) return true;
            const dot = filePath.lastIndexOf('.');
            if (dot < 0) return false;
            return accept.includes(filePath.slice(dot + 1).toLowerCase());
        },
        [accept, allowDirectories]
    );

    // 受け取ったパスを絞り込んで渡す (ファイル選択のダイアログで選んだものにも使う)
    const deliver = React.useCallback(
        (paths: string[]) => {
            const accepted = paths.filter(filePath => filePath && acceptPath(filePath));
            if (accepted.length === 0) {
                // 何も受け付けられなかったことを伝える (無反応にしない)
                if (paths.length > 0) onRejected?.();
                return;
            }
            onFiles(multiple ? accepted : accepted.slice(0, 1));
        },
        [acceptPath, multiple, onFiles, onRejected]
    );

    const handlers = {
        onDragEnter: (event: React.DragEvent) => {
            event.preventDefault();
            if (disabled) return;
            depth.current += 1;
            setDragOver(true);
        },
        onDragOver: (event: React.DragEvent) => {
            event.preventDefault();
            if (disabled) event.dataTransfer.dropEffect = 'none';
        },
        onDragLeave: () => {
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setDragOver(false);
        },
        onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            depth.current = 0;
            setDragOver(false);
            if (disabled) return;
            const files = Array.from(event.dataTransfer.files);
            deliver(files.map(file => window.kuraToolkit.getPathForFile(file)));
        },
    };

    return { dragOver: dragOver && !disabled, handlers, deliver };
}
