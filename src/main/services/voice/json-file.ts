import fs from 'fs';
import path from 'path';

// 音声機能が保存する JSON ファイルの読み書き。

// JSON ファイルを読む。ファイルが無い場合は null を返す。
// 読めない・JSON として解釈できない場合は DATA_FILE_CORRUPT で失敗させる
// (空の内容として扱うと、次に書き込んだときに元の内容が失われるため)
export function readJsonFile<T>(file: string): T | null {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new Error(`DATA_FILE_CORRUPT: ${file}`, { cause: error });
    }
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new Error(`DATA_FILE_CORRUPT: ${file}`, { cause: error });
    }
}

// 一時ファイルへ書いてから置き換えるため、書き込みの途中でアプリが終了しても元の内容は壊れない
// (声のモデルの情報や学習用の音声の一覧が壊れると、ファイルが残っていても一覧に出なくなるため)。
// 書き込みか置き換えに失敗した場合は、一時ファイルを消してから失敗を返す
export function writeJsonFile(file: string, data: unknown, options: { pretty?: boolean } = {}): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, options.pretty === false ? undefined : 2), 'utf-8');
        fs.renameSync(tmp, file);
    } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error;
    }
}
