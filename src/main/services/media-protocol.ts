import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { protocol } from 'electron';

// プレビュー用に、ローカルの音声・画像ファイルを renderer の <audio> / <img> へ渡す独自スキーム。
// ファイルの中身を renderer のメモリに文字列として持たせず (dataURL を使わず)、必要な分だけ読ませる。
// renderer は開発時 http://localhost、配布時 file:// から読み込まれるため file:// を直接参照できない。
// 任意のファイルを読ませないよう、main が登録したファイルだけを推測できない識別子で公開する。
// シーク (Range 要求) に対応しないと再生位置を合わせた切り替えができないため、部分応答を返す。

const MEDIA_SCHEME = 'kura-media';

const tokenToPath = new Map<string, string>();
const pathToToken = new Map<string, string>();

// 公開するファイルの形式 (音声: 処理の結果と、学習用に追加・録音した音声。画像: SVG 変換の元画像と変換結果)
const CONTENT_TYPES: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
};

// app の ready より前に呼ぶ必要がある
export function registerMediaSchemePrivileges(): void {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: MEDIA_SCHEME,
            privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true },
        },
    ]);
}

export function registerMediaProtocol(): void {
    protocol.handle(MEDIA_SCHEME, request => handleRequest(request));
}

// ファイルを公開して URL を返す。同じファイルには同じ URL を返す。
// ファイルの更新でブラウザのキャッシュが使われないよう、更新時刻を付ける (ファイルを調べられなければ失敗する)
export function mediaUrl(filePath: string): string {
    const resolved = path.resolve(filePath);
    const version = Math.floor(fs.statSync(resolved).mtimeMs);
    let token = pathToToken.get(resolved);
    if (!token) {
        token = crypto.randomBytes(12).toString('hex');
        tokenToPath.set(token, resolved);
        pathToToken.set(resolved, token);
    }
    return `${MEDIA_SCHEME}://media/${token}/${encodeURIComponent(path.basename(resolved))}?v=${version}`;
}

// フォルダの中のファイルの公開をやめる (作業をまとめて破棄するとき)
export function forgetMediaUnder(dir: string): void {
    const prefix = path.resolve(dir) + path.sep;
    for (const [filePath, token] of pathToToken) {
        if (!filePath.startsWith(prefix)) continue;
        pathToToken.delete(filePath);
        tokenToPath.delete(token);
    }
}

// 公開をやめる (作業の破棄でファイルを消すとき)
export function forgetMedia(filePath: string): void {
    const resolved = path.resolve(filePath);
    const token = pathToToken.get(resolved);
    if (!token) return;
    pathToToken.delete(resolved);
    tokenToPath.delete(token);
}

// 公開している URL のファイルのパス (公開していない URL は null)
export function mediaPathOf(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
    const token = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return tokenToPath.get(token) ?? null;
}

function handleRequest(request: Request): Response {
    const url = new URL(request.url);
    const token = url.pathname.split('/').filter(Boolean)[0] ?? '';
    const filePath = tokenToPath.get(token);
    if (!filePath) return new Response('not found', { status: 404 });
    let size: number;
    try {
        size = fs.statSync(filePath).size;
    } catch {
        return new Response('not found', { status: 404 });
    }
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
    };
    const range = request.headers.get('range');
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (match && (match[1] !== '' || match[2] !== '')) {
        let start: number;
        let end: number;
        if (match[1] === '') {
            // 末尾から n バイト
            start = Math.max(0, size - Number(match[2]));
            end = size - 1;
        } else {
            start = Number(match[1]);
            end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
        }
        if (start >= size || start > end) {
            return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
        }
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
                ...headers,
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Content-Length': String(end - start + 1),
            },
        });
    }
    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) },
    });
}
