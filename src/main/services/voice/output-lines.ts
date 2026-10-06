// 子プロセスの出力を行に分けて渡す。
// \r で書き換えられる行 (tqdm などの進捗表示) は overwrite = true で渡し、受け取る側は直前の行を置き換える
// (端末に最後に残る内容だけを残せるようにするため)
export function createLineReader(onLine: (line: string, overwrite: boolean) => void): (chunk: string) => void {
    let buffer = '';
    let overwriting = false;
    return chunk => {
        buffer += chunk;
        // 末尾の \r は \r\n の途中かもしれないため、次の出力まで持ち越す
        const end = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length;
        const parts = buffer.slice(0, end).split(/(\r\n|\r|\n)/);
        buffer = (parts.pop() ?? '') + buffer.slice(end);
        for (let index = 0; index < parts.length; index += 2) {
            const line = parts[index].trimEnd();
            const separator = parts[index + 1];
            if (line) {
                onLine(line, overwriting);
                overwriting = separator === '\r';
            } else if (separator !== '\r') {
                overwriting = false;
            }
        }
    };
}
