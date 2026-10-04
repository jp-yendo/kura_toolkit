import type { TFunction } from 'i18next';
import i18n from '../../i18n/config';

// main / Python から届くエラーコード (「CODE: 詳細」) を利用者向けの文言にする。
// 未知のコードは詳細とともにそのまま表示する。

type ParsedError = { code: string | null; detail: string; raw: string };

// Python のライブラリが詳細に端末向けの色指定 (ESC [ ... m) を含めることがあるため、表示前に取り除く
// eslint-disable-next-line no-control-regex -- 制御文字 (ESC) そのものを検出する必要がある
const ANSI_ESCAPE = /\u001b\[[0-9;]*[A-Za-z]/g;

export function parseVoiceError(error: unknown): ParsedError {
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

export function isCancelledError(error: unknown): boolean {
    return parseVoiceError(error).code === 'KURA_CANCELLED';
}

export function voiceErrorMessage(t: TFunction, error: unknown): string {
    const parsed = parseVoiceError(error);
    if (!parsed.code) return parsed.raw;
    if (parsed.code === 'FFMPEG_NOT_FOUND') return t('common.ffmpegNotFound');
    if (parsed.code === 'FFPROBE_NOT_FOUND') return t('common.ffprobeNotFound');
    if (parsed.code === 'WORK_DIR_MISSING') return t('common.workDirMissing', { detail: parsed.detail });
    const key = `voice.errors.${parsed.code}`;
    if (i18n.exists(key)) {
        const text = t(key, { detail: parsed.detail });
        // 詳細が無い場合は、詳細を入れる括弧ごと取り除く
        return parsed.detail ? text : text.replace(/\s*[(\uFF08]\s*[)\uFF09]/g, '');
    }
    return parsed.detail ? `${parsed.code}: ${parsed.detail}` : parsed.code;
}

// 「MODEL_REQUIRED: 項目 ID, 項目 ID」から、ダウンロードが必要な項目を取り出す
export function missingItemsFromError(error: unknown): string[] {
    const parsed = parseVoiceError(error);
    if (parsed.code !== 'MODEL_REQUIRED' && parsed.code !== 'MODEL_NOT_INSTALLED') return [];
    return parsed.detail
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}
