// 動画トラック・タグ管理で、トラックを出力形式へ再エンコードせずに入れられるかの判定と、トラックを単体のファイルへ
// 書き出すときの形式の決定 (main / renderer で共用)。Node / DOM に依存させない。

import { COPY_CODECS } from './video-merge';
import type { TrackKind } from './types';

// ファイル全体のタグのうち、書き出すときに出力形式が書き直すもの (編集しても反映されないため編集の対象にしない)
const TECHNICAL_FORMAT_TAGS = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder']);

export function isTechnicalFormatTag(key: string): boolean {
    return TECHNICAL_FORMAT_TAGS.has(key.toLowerCase());
}

// mp4 系の handler_name のうち、作ったソフトが付ける既定の値 (トラックの名前ではない)
const GENERIC_HANDLER_NAMES = new Set(
    [
        'VideoHandler',
        'SoundHandler',
        'SubtitleHandler',
        'DataHandler',
        'TimeCodeHandler',
        'Apple Video Media Handler',
        'Apple Sound Media Handler',
        'Apple Text Media Handler',
        'Core Media Video',
        'Core Media Audio',
        'Core Media Text',
    ].map(name => name.toLowerCase())
);

// トラックの名前 (title のタグ。無ければ mp4 系の handler_name。ただし既定の値は名前としない)
export function trackTitleOf(tags: Record<string, string>): string {
    const find = (name: string) =>
        Object.entries(tags)
            .find(([key]) => key.toLowerCase() === name)?.[1]
            ?.trim() ?? '';
    const title = find('title');
    if (title) return title;
    const handler = find('handler_name');
    return handler && !GENERIC_HANDLER_NAMES.has(handler.toLowerCase()) ? handler : '';
}

// トラックの種類ごとに編集できるフラグ (ffmpeg の disposition の名前。既定は別に扱う)
export const TRACK_FLAGS: Record<TrackKind, readonly string[]> = {
    video: ['original', 'comment', 'hearing_impaired'],
    audio: ['original', 'dub', 'comment', 'visual_impaired', 'hearing_impaired'],
    subtitle: ['forced', 'hearing_impaired', 'descriptions', 'comment', 'original'],
};

// トラックのフラグとして扱わない指定 (既定は別に扱い、カバーアートの印はトラックの性質のため)
export function isTrackFlag(name: string): boolean {
    return name !== 'default' && name !== 'attached_pic';
}

// 文字の字幕と画像の字幕
const TEXT_SUBTITLES = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const BITMAP_SUBTITLES = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']);

// mp4 系の出力形式
const MP4_FAMILY = new Set(['.mp4', '.m4v', '.mov']);

// MPEG-TS の拡張子 (Blu-ray の m2ts を含む)
const TS_FAMILY = new Set(['.ts', '.m2ts', '.mts']);

// 2 つの拡張子が同じ形式か (MPEG-TS の拡張子どうしは同じ形式とする)
export function isSameContainer(a: string, b: string): boolean {
    return a === b || (TS_FAMILY.has(a) && TS_FAMILY.has(b));
}

// パスの拡張子 (小文字、ドット付き。無ければ空)
export function extensionOf(filePath: string): string {
    const match = /\.[^.\\/]*$/.exec(filePath);
    return match ? match[0].toLowerCase() : '';
}

// トラックを出力形式へ入れる方法: copy = そのまま写す、convert = 字幕の形式を変える (encoder へ)、
// unsupported = 再エンコードしなければ入れられない
export type TrackOutputPlan = { mode: 'copy' } | { mode: 'convert'; encoder: string } | { mode: 'unsupported' };

// sourceExtension はトラックを持つファイルの拡張子。同じ形式へ書く場合は、元に入っていたトラックをそのまま入れられる
export function trackOutputPlan(
    kind: TrackKind,
    codec: string,
    extension: string,
    sourceExtension: string
): TrackOutputPlan {
    if (isSameContainer(extension, sourceExtension)) return { mode: 'copy' };
    if (kind === 'subtitle') return subtitleOutputPlan(codec, extension);
    // mkv はどの映像・音声も入れられる。表に無い形式も制限しない (書き出しの失敗で知らせる)
    const rule = COPY_CODECS[TS_FAMILY.has(extension) ? '.ts' : extension];
    if (!rule) return { mode: 'copy' };
    return rule[kind].includes(codec) ? { mode: 'copy' } : { mode: 'unsupported' };
}

function subtitleOutputPlan(codec: string, extension: string): TrackOutputPlan {
    const text = TEXT_SUBTITLES.has(codec);
    if (extension === '.mkv') {
        // mkv は mp4 の字幕 (mov_text) を持てないため SubRip にする
        if (codec === 'mov_text' || codec === 'text') return { mode: 'convert', encoder: 'srt' };
        return { mode: 'copy' };
    }
    if (MP4_FAMILY.has(extension)) {
        if (codec === 'mov_text') return { mode: 'copy' };
        // DVD の字幕 (VobSub) は mp4 だけが持てる (mov・m4v は持てない)
        if (codec === 'dvd_subtitle') return extension === '.mp4' ? { mode: 'copy' } : { mode: 'unsupported' };
        return text ? { mode: 'convert', encoder: 'mov_text' } : { mode: 'unsupported' };
    }
    if (extension === '.webm') {
        if (codec === 'webvtt') return { mode: 'copy' };
        return text ? { mode: 'convert', encoder: 'webvtt' } : { mode: 'unsupported' };
    }
    if (TS_FAMILY.has(extension)) return codec === 'dvb_subtitle' ? { mode: 'copy' } : { mode: 'unsupported' };
    if (BITMAP_SUBTITLES.has(codec) || text) return { mode: 'unsupported' };
    return { mode: 'copy' };
}

// トラックを単体のファイルへ書き出すときの拡張子と、形式を変える場合のエンコーダ (null = そのまま写す)
export function trackExportFormat(kind: TrackKind, codec: string): { extension: string; encoder: string | null } {
    if (kind === 'video') {
        if (['h264', 'hevc', 'mpeg4', 'av1'].includes(codec)) return { extension: '.mp4', encoder: null };
        if (['vp8', 'vp9'].includes(codec)) return { extension: '.webm', encoder: null };
        return { extension: '.mkv', encoder: null };
    }
    if (kind === 'audio') {
        const audio: Record<string, string> = {
            aac: '.m4a',
            alac: '.m4a',
            mp3: '.mp3',
            mp2: '.mp2',
            ac3: '.ac3',
            eac3: '.eac3',
            dts: '.dts',
            flac: '.flac',
            opus: '.opus',
            vorbis: '.ogg',
        };
        if (audio[codec]) return { extension: audio[codec], encoder: null };
        // wav は little endian の整数・浮動小数と 8bit 符号なしの PCM だけを持てる (big endian や Blu-ray・DVD の PCM は mka)
        if (/^pcm_(s16le|s24le|s32le|f32le|f64le|u8)$/.test(codec)) return { extension: '.wav', encoder: null };
        return { extension: '.mka', encoder: null };
    }
    const subtitle: Record<string, string> = {
        subrip: '.srt',
        srt: '.srt',
        ass: '.ass',
        ssa: '.ass',
        webvtt: '.vtt',
        hdmv_pgs_subtitle: '.sup',
    };
    if (subtitle[codec]) return { extension: subtitle[codec], encoder: null };
    // mp4 の字幕は単体のファイルの形式が無いため SubRip にする
    if (codec === 'mov_text' || codec === 'text') return { extension: '.srt', encoder: 'srt' };
    // DVD・DVB の字幕などは単体のファイルの形式で書けないため、字幕だけの mkv (mks) にする
    return { extension: '.mks', encoder: null };
}
