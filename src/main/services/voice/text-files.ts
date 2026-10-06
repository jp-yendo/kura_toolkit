import fs from 'fs';

// 読み上げの文章ファイル (通常の入力はテキスト、タイミング指定は字幕ファイル) の読み込みと保存。
// 内容の解釈 (字幕ファイルを表へ展開するなど) は画面側で行い、ここでは文字コードと改行だけを扱う。
// 読み込んだ内容は編集画面上で編集し、ディスク上のファイルへの反映は利用者が保存操作をしたときだけ行う。

function decode(buffer: Buffer): string {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString('utf-8');
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(buffer.subarray(2));
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        // 日本語の字幕ファイルは Shift_JIS で作られていることがある
        return new TextDecoder('shift_jis').decode(buffer);
    }
}

// 改行は LF にそろえて返す
export function loadTextFile(filePath: string): string {
    return decode(fs.readFileSync(filePath)).replace(/\r\n?/g, '\n');
}

// UTF-8 (BOM なし) で保存する。改行は OS の標準に合わせる。
// 一時ファイルへ書いてから置き換え、書き込みか置き換えに失敗した場合は一時ファイルを消してから失敗を返す
export function saveTextFile(filePath: string, text: string): void {
    const newline = process.platform === 'win32' ? '\r\n' : '\n';
    const tmp = `${filePath}.kura-tmp`;
    try {
        fs.writeFileSync(tmp, text.replace(/\r\n?/g, '\n').split('\n').join(newline), 'utf-8');
        fs.renameSync(tmp, filePath);
    } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error;
    }
}
