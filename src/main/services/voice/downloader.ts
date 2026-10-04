import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { net } from 'electron';

// HTTP でのファイル取得。Electron の net.fetch を使い、OS のプロキシ設定に従う。
// 取得中は保存先のフォルダに「<名前>.part」として書き、照合が済んだら正式な名前にする
// (途中で止まったファイルを完成したものと取り違えないため)。再試行時は続きから取得する (Range 要求)。

type DownloadProgress = {
    received: number;
    // 配布元が大きさを返さない場合は null
    total: number | null;
};

type DownloadOptions = {
    signal?: AbortSignal;
    onProgress?(progress: DownloadProgress): void;
    // 取得後に照合する SHA-256 (16 進小文字)。不一致なら破棄してエラーにする
    sha256?: string;
};

const USER_AGENT = 'KuraToolkit';

// 配布元にあるファイルの大きさ (Content-Length) を調べる (リダイレクト先まで辿る)。
// ファイルが無い (HTTP 404) 場合は null を返す。問い合わせに失敗した場合と、大きさが返らない場合はエラーにする
export async function probeSize(url: string, signal?: AbortSignal): Promise<number | null> {
    const response = await net.fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal,
        headers: { 'User-Agent': USER_AGENT },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`DOWNLOAD_FAILED: HTTP ${response.status} ${url}`);
    const length = response.headers.get('content-length');
    const size = length === null ? NaN : Number(length);
    if (!Number.isFinite(size)) throw new Error(`DOWNLOAD_FAILED: no content-length ${url}`);
    return size;
}

async function fileSha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(filePath), hash);
    return hash.digest('hex');
}

// 応答やデータが届かないまま待つ上限。超えたら打ち切って失敗とする (再試行すれば続きから取得する)
const STALL_TIMEOUT_MS = 120_000;

// URL のファイルを destPath に保存する。完了するまでは destPath + '.part' に書き、成功したら置き換える
export async function downloadFile(url: string, destPath: string, options: DownloadOptions = {}): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const partPath = `${destPath}.part`;
    let offset = 0;
    try {
        offset = fs.statSync(partPath).size;
    } catch {
        offset = 0;
    }

    // 通信が途中で止まった場合に備え、一定時間データが届かなければ打ち切る
    const stall = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS);
    };
    const signal = options.signal ? AbortSignal.any([options.signal, stall.signal]) : stall.signal;

    try {
        const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
        if (offset > 0) headers.Range = `bytes=${offset}-`;
        arm();
        const response = await net.fetch(url, { redirect: 'follow', signal, headers });
        if (response.status === 416) {
            // 前回の途中ファイルが既に完全な大きさになっている (または壊れている)。最初から取り直す
            fs.rmSync(partPath, { force: true });
            if (timer) clearTimeout(timer);
            return await downloadFile(url, destPath, options);
        }
        if (!response.ok || !response.body) {
            throw new Error(`DOWNLOAD_FAILED: HTTP ${response.status} ${url}`);
        }
        // 圧縮して送られる場合 (raw.githubusercontent.com の JSON など)、Content-Length は圧縮後の大きさで、
        // 受け取る本文 (展開後) の大きさとは異なる。この場合は大きさの照合と続きからの取得を行わない
        const encoding = (response.headers.get('content-encoding') ?? '').trim().toLowerCase();
        const encoded = encoding !== '' && encoding !== 'identity';
        if (encoded && response.status === 206) {
            // 途中までのファイルに続きを付け足せないため、最初から取り直す
            await response.body.cancel().catch(() => undefined);
            fs.rmSync(partPath, { force: true });
            if (timer) clearTimeout(timer);
            return await downloadFile(url, destPath, options);
        }
        const resumed = response.status === 206 && offset > 0;
        if (!resumed) offset = 0;
        const lengthHeader = encoded ? null : response.headers.get('content-length');
        const remaining = lengthHeader ? Number(lengthHeader) : NaN;
        const total = Number.isFinite(remaining) ? offset + remaining : null;

        let received = offset;
        let lastReport = 0;
        const counter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                arm();
                received += chunk.length;
                const now = Date.now();
                // 進捗の通知は間引く (1 チャンクごとに IPC を送ると重くなるため)
                if (now - lastReport > 200) {
                    lastReport = now;
                    options.onProgress?.({ received, total });
                }
                callback(null, chunk);
            },
        });
        const body = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
        await pipeline(body, counter, fs.createWriteStream(partPath, { flags: resumed ? 'a' : 'w' }), { signal });
        options.onProgress?.({ received, total });

        if (total !== null && received !== total) {
            throw new Error(`DOWNLOAD_FAILED: incomplete ${received}/${total} ${url}`);
        }
    } catch (error) {
        if (stall.signal.aborted && !options.signal?.aborted) {
            throw new Error(`DOWNLOAD_FAILED: no response for ${STALL_TIMEOUT_MS / 1000}s ${url}`);
        }
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
    }

    if (options.sha256) {
        const actual = await fileSha256(partPath);
        if (actual !== options.sha256.toLowerCase()) {
            fs.rmSync(partPath, { force: true });
            throw new Error(`DOWNLOAD_FAILED: checksum mismatch ${url}`);
        }
    }
    fs.rmSync(destPath, { force: true });
    fs.renameSync(partPath, destPath);
}

// 中断 (AbortSignal) によって止まったか。呼び出し側は自分の signal.aborted も合わせて確かめる
export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
