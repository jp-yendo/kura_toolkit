import type { TFunction } from 'i18next';
import { errorMessage } from '../common/errorMessage';
import { ISO639_LANGUAGES, type Iso639Language } from '@shared/iso639';
import { MERGE_OUTPUT_FORMATS } from '@shared/video-merge';
import { extensionOf, isSameContainer, trackOutputPlan } from '@shared/video-track-tag';
import type { TrackKind } from '@shared/types';

// 動画トラック・タグ管理で開ける動画の拡張子
export const TRACK_TAG_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts', 'm2ts', 'avi'];

// トラックを追加するときに開けるファイルの拡張子 (動画・音声・字幕)
export const TRACK_SOURCE_EXTENSIONS = [
    ...TRACK_TAG_VIDEO_EXTENSIONS,
    'mka',
    'mks',
    'mp3',
    'm4a',
    'aac',
    'ac3',
    'eac3',
    'dts',
    'flac',
    'ogg',
    'opus',
    'wav',
    'srt',
    'ass',
    'ssa',
    'vtt',
    'sup',
];

export function trackTagVideoFilters(t: TFunction) {
    return [
        { name: t('common.fileTypes.media'), extensions: TRACK_TAG_VIDEO_EXTENSIONS },
        { name: t('common.fileTypes.all'), extensions: ['*'] },
    ];
}

export function trackSourceFilters(t: TFunction) {
    return [
        { name: t('common.fileTypes.media'), extensions: TRACK_SOURCE_EXTENSIONS },
        { name: t('common.fileTypes.all'), extensions: ['*'] },
    ];
}

// 出力形式の選択肢 (extension はドット付きの拡張子)
export type OutputFormatChoice = { extension: string; label: string };

// tracks をすべて再エンコードせずに入れられる出力形式 (元の動画の形式・MP4・MKV・WebM・MOV・AVI・MPEG-TS の順。
// 文字の字幕の形式を変えるだけで入れられる形式も含む)
export function copyableOutputFormats(
    tracks: Array<{ kind: TrackKind; codec: string; source: string }>,
    inputExtension: string
): OutputFormatChoice[] {
    const input = {
        extension: inputExtension,
        label:
            MERGE_OUTPUT_FORMATS.find(format => isSameContainer(format.extension, inputExtension))?.label ??
            inputExtension.slice(1).toUpperCase(),
    };
    const candidates = [
        input,
        ...MERGE_OUTPUT_FORMATS.filter(format => !isSameContainer(format.extension, inputExtension)).map(format => ({
            extension: format.extension,
            label: format.label,
        })),
    ];
    return candidates.filter(candidate =>
        tracks.every(
            track =>
                trackOutputPlan(track.kind, track.codec, candidate.extension, extensionOf(track.source)).mode !==
                'unsupported'
        )
    );
}

// 「自動」で選ぶ出力形式: 元の動画の形式、入れられなければ MKV、それも無ければ最初の選択肢 (無ければ null)
export function autoOutputFormat(formats: OutputFormatChoice[], inputExtension: string): OutputFormatChoice | null {
    return (
        formats.find(format => isSameContainer(format.extension, inputExtension)) ??
        formats.find(format => format.extension === '.mkv') ??
        formats[0] ??
        null
    );
}

// 時刻の入力 (HH:MM:SS.mmm・MM:SS.mmm・秒) を秒にする。読み取れなければ null
export function parseTime(text: string): number | null {
    const parts = text.trim().split(':');
    if (parts.length === 0 || parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) return null;
    const value = parts.reduce((sum, part) => sum * 60 + Number(part), 0);
    return Number.isFinite(value) ? value : null;
}

// 言語のコード (ISO 639-2 の B・T のどちらでもよい) の一覧の項目 (無ければ undefined)
export function languageOf(code: string): Iso639Language | undefined {
    return ISO639_LANGUAGES.find(item => item.code === code || item.terminology === code);
}

// 言語のコードの表示名。UI の言語の名前を Intl から得て、得られなければ英語の名前、一覧に無いコードはコードのまま
export function languageName(code: string, uiLanguage: string): string {
    const entry = languageOf(code);
    if (!entry) return code;
    try {
        const name = new Intl.DisplayNames([uiLanguage], { type: 'language', fallback: 'none' }).of(entry.bcp47);
        return name ?? entry.english;
    } catch {
        return entry.english;
    }
}

// 処理から返ったエラーの表示文言
export function trackTagErrorMessage(t: TFunction, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('OUTPUT_EQUALS_INPUT')) return t('videoTrackTagPage.outputEqualsInput');
    if (message.includes('UNSUPPORTED_TRACKS')) return t('videoTrackTagPage.unsupportedTracks');
    if (message.includes('TRACK_NOT_FOUND')) return t('videoTrackTagPage.trackNotFound');
    return errorMessage(t, error);
}
