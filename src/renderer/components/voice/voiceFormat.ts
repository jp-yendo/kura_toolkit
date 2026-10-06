import type { TFunction } from 'i18next';
import i18n from '../../i18n/config';
import type { VoiceModelInfo } from '@shared/voice/types';
import { voiceDisplayName } from '@shared/voice/voice-name';

// 音声機能の画面で共通に使う表示用の整形

// 分離の出力 (ステム) の名前。訳がある名前は訳を、それ以外はそのまま表示する
export function stemName(t: TFunction, name: string): string {
    const key = `voice.stems.${name.toLowerCase()}`;
    return i18n.exists(key) ? t(key) : name;
}

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

// 声のモデルの表示名
export function voiceLabel(voice: VoiceModelInfo): string {
    return voiceDisplayName(voice);
}

// 同じ表示名のモデルがあるか (選択欄で区別できなくなるため、名前の入力時に注意を出すのに使う)
export function hasSameVoiceName(voices: VoiceModelInfo[], name: string, exceptId?: string): boolean {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    return voices.some(voice => voice.id !== exceptId && voiceLabel(voice).trim().toLowerCase() === normalized);
}

// 作業 (分離・変換・読み上げの 1 回分の作業) の識別子。作業の結果を置くフォルダの名前になるため、意味を持たないランダムな値にする
export function newWorkKey(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
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
