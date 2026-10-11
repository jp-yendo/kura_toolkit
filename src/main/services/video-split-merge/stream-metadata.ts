import type { FfStream } from './probe';

// 出力ストリームのタグと指定 (既定・強制・副音声など) を元のストリームから引き継ぐための ffmpeg の引数

// トラックの名前を handler_name として持つ出力形式
export const HANDLER_NAME_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.m4a']);

// 出力ストリームのタグ (言語・タイトルなど) と指定 (既定・強制・副音声など) を元のストリームから引き継ぐ。
// mp4 系はトラックの名前を handler_name で持つため、元に handler_name が無ければタイトルをそこへ書く
export function streamMetadataArgs(spec: string, stream: FfStream, extension: string): string[] {
    const args: string[] = [];
    // タグは、作り方・中身から決まる統計などの項目を除いてすべて引き継ぐ
    for (const [key, value] of Object.entries(stream.tags ?? {})) {
        if (TECHNICAL_STREAM_TAG.test(key)) continue;
        args.push(`-metadata:s:${spec}`, `${key}=${value}`);
    }
    if (!stream.tags?.handler_name && HANDLER_NAME_CONTAINERS.has(extension) && stream.tags?.title) {
        args.push(`-metadata:s:${spec}`, `handler_name=${stream.tags.title}`);
    }
    // 既定・強制・副音声・聴覚障害者向け・解説などの指定はすべて引き継ぐ (カバーアートの指定は別に付ける)
    const flags = Object.entries(stream.disposition ?? {})
        .filter(([name, value]) => value === 1 && name !== 'attached_pic' && DISPOSITION_NAMES.has(name))
        .map(([name]) => name);
    args.push(`-disposition:${spec}`, flags.length > 0 ? flags.join('+') : '0');
    return args;
}

// 引き継がないストリームのタグ (出力に合わせて書き直されるもの: 長さ・ビットレートなどの統計、エンコーダ名、
// 作成日時、透過の印、mkv の統計の一覧)
const TECHNICAL_STREAM_TAG =
    /^(duration|bps|number_of_frames|number_of_bytes|_statistics_.*|encoder|vendor_id|creation_time|alpha_mode)(-.*)?$/i;

// ffmpeg の -disposition で指定できる名前
const DISPOSITION_NAMES = new Set([
    'default',
    'dub',
    'original',
    'comment',
    'lyrics',
    'karaoke',
    'forced',
    'hearing_impaired',
    'visual_impaired',
    'clean_effects',
    'captions',
    'descriptions',
    'metadata',
    'dependent',
    'still_image',
    'non_diegetic',
    'multilayer',
]);
