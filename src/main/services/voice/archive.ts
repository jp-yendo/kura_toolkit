import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import yauzl from 'yauzl';
import yazl from 'yazl';

// 書庫の展開と作成。
// - tar.gz: Python 本体 (python-build-standalone) と GitHub のソース一式の展開に使う
// - zip: 声のモデルの書き出し・取り込みと、外部で入手したモデル (zip 配布が多い) の取り込みに使う

// tar.gz を展開する。strip で先頭の階層を取り除く (Python 本体の書庫は python/、GitHub のソース一式は
// リポジトリ名の階層を持つため)
export async function extractTarGz(archivePath: string, destDir: string, strip: number): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });
    await tar.x({ file: archivePath, cwd: destDir, strip, preservePaths: false });
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
    return new Promise((resolve, reject) => {
        // decodeStrings (既定) では、絶対パスや「..」を含む不正な名前があるとエラーになる (展開先の外へ書かせない)
        yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipFile) => {
            if (error || !zipFile) reject(new Error(`ZIP_OPEN_FAILED: ${error?.message ?? ''}`));
            else resolve(zipFile);
        });
    });
}

async function forEachEntry(
    zipPath: string,
    handler: (zipFile: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>
): Promise<void> {
    const zipFile = await openZip(zipPath);
    try {
        await new Promise<void>((resolve, reject) => {
            zipFile.on('error', reject);
            zipFile.on('end', () => resolve());
            zipFile.on('entry', (entry: yauzl.Entry) => {
                handler(zipFile, entry).then(
                    () => zipFile.readEntry(),
                    error => reject(error)
                );
            });
            zipFile.readEntry();
        });
    } finally {
        zipFile.close();
    }
}

// zip から文字列として読み出す項目の大きさの上限 (書き出しファイルの情報 JSON は小さいため)
const MAX_ZIP_TEXT_BYTES = 1024 * 1024;

// zip から 1 件を取り出して文字列で返す (書き出しファイルの情報 JSON を読むため)
export async function readZipText(zipPath: string, entryName: string): Promise<string | null> {
    let result: string | null = null;
    await forEachEntry(zipPath, async (zipFile, entry) => {
        if (entry.fileName !== entryName || entry.uncompressedSize > MAX_ZIP_TEXT_BYTES) return;
        const stream = await openEntryStream(zipFile, entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        result = Buffer.concat(chunks).toString('utf-8');
    });
    return result;
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
    return new Promise((resolve, reject) => {
        zipFile.openReadStream(entry, (error, stream) => {
            if (error || !stream) reject(new Error(`ZIP_READ_FAILED: ${error?.message ?? ''}`));
            else resolve(stream);
        });
    });
}

// zip を展開する。filter が false を返した項目は取り出さない。取り出したファイルの一覧を返す
export async function extractZip(
    zipPath: string,
    destDir: string,
    filter?: (entryName: string) => boolean
): Promise<string[]> {
    fs.mkdirSync(destDir, { recursive: true });
    const root = path.resolve(destDir);
    const extracted: string[] = [];
    await forEachEntry(zipPath, async (zipFile, entry) => {
        if (entry.fileName.endsWith('/')) return;
        if (filter && !filter(entry.fileName)) return;
        const target = path.resolve(root, entry.fileName);
        // 名前の検証は yauzl が行うが、念のため展開先の外を指していないかも確かめる
        if (target !== root && !target.startsWith(root + path.sep)) {
            throw new Error(`ZIP_INVALID_ENTRY: ${entry.fileName}`);
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const stream = await openEntryStream(zipFile, entry);
        await pipeline(stream, fs.createWriteStream(target));
        extracted.push(target);
    });
    return extracted;
}

type ZipSource = { name: string; filePath: string } | { name: string; text: string };

// zip を作成する。モデルの重みは圧縮してもほとんど小さくならないため無圧縮で格納する。
// 保存先のフォルダは作らない (利用者が選んだ場所に書く)
export async function writeZip(destPath: string, sources: ZipSource[]): Promise<void> {
    const zipFile = new yazl.ZipFile();
    for (const source of sources) {
        if ('filePath' in source) {
            zipFile.addFile(source.filePath, source.name, { compress: false });
        } else {
            zipFile.addBuffer(Buffer.from(source.text, 'utf-8'), source.name, { compress: true });
        }
    }
    const tmpPath = `${destPath}.kura-tmp`;
    const output = fs.createWriteStream(tmpPath);
    const done = pipeline(zipFile.outputStream, output);
    zipFile.end();
    try {
        await done;
        fs.rmSync(destPath, { force: true });
        fs.renameSync(tmpPath, destPath);
    } catch (error) {
        fs.rmSync(tmpPath, { force: true });
        throw error;
    }
}
