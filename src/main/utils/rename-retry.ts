import fs from 'fs';

const RENAME_ATTEMPTS = 10;
const RENAME_RETRY_MS = 500;

// ほかのプログラムがファイルを開いているために失敗したか
export function isFileBusyError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

// 名前を変えて移す。ウイルス対策ソフトや検索のインデックス作成が一時的にファイルを開いていて失敗した場合
// (Windows) は、少し待って再試行する。再試行しても移せなければ、最後の失敗を返す
export async function renameWithRetry(source: string, dest: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await fs.promises.rename(source, dest);
            return;
        } catch (error) {
            if (!isFileBusyError(error) || attempt >= RENAME_ATTEMPTS) throw error;
            await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_MS));
        }
    }
}
