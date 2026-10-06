import type { TFunction } from 'i18next';
import i18n from '../../i18n/config';

// main から返ったエラーを画面に出す文にする。
// main はエラーを「コード: 詳細」の形で返し、画面側でコードを翻訳する。翻訳の無いエラー (OS やライブラリの
// エラーなど) も、本文はそのまま出さず、表示言語の「失敗しました」の文に詳細として添える

type ParsedError = { code: string | null; detail: string; raw: string };

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

export function parseError(error: unknown): ParsedError {
    const message = (error instanceof Error ? error.message : String(error)).replace(ANSI_ESCAPE, '');
    // ipcRenderer.invoke の失敗は「Error invoking remote method '...': Error: 本文」の形になる
    const stripped = message
        .replace(/^Error invoking remote method '[^']+':\s*/, '')
        .replace(/^Error:\s*/, '')
        .trim();
    const match = /^([A-Z][A-Z0-9_]+)(?::\s*([\s\S]*))?$/.exec(stripped);
    if (!match) return { code: null, detail: stripped, raw: stripped };
    return { code: match[1], detail: (match[2] ?? '').trim(), raw: stripped };
}

// 詳細が無い場合は、詳細を入れる括弧ごと取り除く
function withDetail(t: TFunction, key: string, detail: string): string {
    const text = t(key, { detail });
    return detail ? text : text.replace(/\s*[(\uFF08]\s*[)\uFF09]/g, '');
}

// keyPrefixes: コードを探す翻訳の場所 (例: 'voice.errors')。見つからなければ共通の文にする
export function errorMessage(t: TFunction, error: unknown, keyPrefixes: string[] = []): string {
    const parsed = parseError(error);
    if (parsed.code === 'FFMPEG_NOT_FOUND') return t('common.ffmpegNotFound');
    if (parsed.code === 'FFPROBE_NOT_FOUND') return t('common.ffprobeNotFound');
    if (parsed.code === 'WORK_DIR_MISSING') return t('common.workDirMissing', { detail: parsed.detail });
    if (parsed.code) {
        for (const prefix of keyPrefixes) {
            const key = `${prefix}.${parsed.code}`;
            if (i18n.exists(key)) return withDetail(t, key, parsed.detail);
        }
    }
    return withDetail(t, 'common.failed', parsed.raw);
}
