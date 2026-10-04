import type { TFunction } from 'i18next';
import type { VoiceModelInfo } from '@shared/voice/types';

// 音声機能の画面で共通に使う表示用の整形

export function formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '-';
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
    return `${bytes} B`;
}

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor(total / 60) % 60;
    const s = total % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

// 声のモデルの表示名。プリセットは名前を変えるまで配布時の名前とエンジンから作る
export function voiceLabel(t: TFunction, voice: VoiceModelInfo): string {
    if (voice.name) return voice.name;
    if (voice.presetName) {
        const engine = voice.tts ? t(`voice.engine.${voice.tts.engine}`) : '';
        return t('voice.models.presetLabel', { name: voice.presetName.replace(/-jp$/, ''), engine });
    }
    return voice.id;
}

// 同じ表示名のモデルがあるか (選択欄で区別できなくなるため、名前の入力時に注意を出すのに使う)
export function hasSameVoiceName(t: TFunction, voices: VoiceModelInfo[], name: string, exceptId?: string): boolean {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    return voices.some(voice => voice.id !== exceptId && voiceLabel(t, voice).trim().toLowerCase() === normalized);
}

// 作業 (分離・変換・読み上げの 1 回分の作業) の識別子
export function newWorkKey(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

// パスからファイル名 (拡張子なし) を取り出す
export function baseName(filePath: string): string {
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

export function dirName(filePath: string): string {
    const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    return index >= 0 ? filePath.slice(0, index) : '';
}

export function joinPath(dir: string, name: string): string {
    if (!dir) return name;
    const separator = dir.includes('\\') ? '\\' : '/';
    return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

// ファイル名に使えない文字を置き換える (Windows の禁止文字に合わせる)
export function sanitizeFileName(name: string): string {
    const replaced = Array.from(name)
        .map(char => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
        .join('');
    return replaced.trim() || 'output';
}
