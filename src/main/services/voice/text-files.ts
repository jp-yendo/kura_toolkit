import fs from 'fs';
import type { VoiceLanguage } from '../../../shared/voice/languages';

// 読み上げの文章ファイル (通常の入力はテキスト、タイミング指定は字幕ファイル) の読み込みと保存。
// 内容の解釈 (字幕ファイルを表へ展開するなど) は画面側で行い、ここでは文字コードと改行だけを扱う。
// 読み込んだ内容は編集画面上で編集し、ディスク上のファイルへの反映は利用者が保存操作をしたときだけ行う。

// BOM の無い UTF-16 か (英数字や記号の多い文章では、2 バイトのうち片方が 0 になる)。リトルエンディアンなら 'le'
function utf16WithoutBom(buffer: Buffer): 'le' | 'be' | null {
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096) & ~1);
    if (sample.length < 4) return null;
    let evenZeros = 0;
    let oddZeros = 0;
    for (let index = 0; index < sample.length; index += 2) {
        if (sample[index] === 0) evenZeros += 1;
        if (sample[index + 1] === 0) oddZeros += 1;
    }
    const pairs = sample.length / 2;
    // UTF-8 や Shift_JIS などの文章には 0 のバイトがほとんど無い
    if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return 'le';
    if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return 'be';
    return null;
}

// 厳密に読めるか (読めない並びがあれば null)
function decodeStrict(buffer: Buffer, encoding: string): string | null {
    try {
        return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
        return null;
    }
}

function decode(buffer: Buffer, language?: VoiceLanguage): string {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString('utf-8');
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(buffer.subarray(2));
    }
    const utf16 = utf16WithoutBom(buffer);
    if (utf16) return new TextDecoder(utf16 === 'le' ? 'utf-16le' : 'utf-16be').decode(buffer);
    const utf8 = decodeStrict(buffer, 'utf-8');
    if (utf8 !== null) return utf8;
    // UTF-8 で読めないファイルは、日本語なら Shift_JIS、中国語なら GBK で作られていることが多い。
    // 片方でしか読めなければそれを使い、両方で読める場合は読み上げの言語で選ぶ
    const shiftJis = decodeStrict(buffer, 'shift_jis');
    const gbk = decodeStrict(buffer, 'gbk');
    if (shiftJis !== null && gbk === null) return shiftJis;
    if (gbk !== null && shiftJis === null) return gbk;
    if (shiftJis !== null && gbk !== null) return language === 'zh' ? gbk : shiftJis;
    return new TextDecoder(language === 'zh' ? 'gbk' : 'shift_jis').decode(buffer);
}

// 改行は LF にそろえて返す
// language: 読み上げの言語 (文字コードを見分けられないときの手がかり)
export function loadTextFile(filePath: string, language?: VoiceLanguage): string {
    return decode(fs.readFileSync(filePath), language).replace(/\r\n?/g, '\n');
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
