import { probeJson } from '../ffmpeg/ffprobe';
import type { ChapterInfo, ChapterProbeResult, MediaStreamInfo, MediaStreamKind } from '../../../shared/types';

// ffprobe による入力メディアの解析 (元: cut-chapter.py の run_ffprobe_chapters / probe_media)

export type FfStream = {
    index: number;
    codec_type?: string;
    codec_name?: string;
    codec_tag_string?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    channels?: number;
    sample_rate?: string;
    nb_frames?: string;
    bit_rate?: string;
    max_bit_rate?: string;
    start_time?: string;
    duration?: string;
    disposition?: { attached_pic?: number; default?: number; forced?: number };
    tags?: Record<string, string>;
};

type FfprobeChaptersResult = {
    chapters?: Array<{
        id?: number | string;
        start_time?: string;
        end_time?: string;
        tags?: { title?: string };
    }>;
};

type FfprobeMediaResult = {
    streams?: FfStream[];
    format?: { format_name?: string; duration?: string };
};

// チャプター情報を取得する。チャプターが無い場合は NO_CHAPTERS を投げる
export async function probeChapters(input: string, jobId?: string): Promise<ChapterInfo[]> {
    const data = await probeJson<FfprobeChaptersResult>(['-show_chapters', input], { jobId });
    const chapters = data.chapters ?? [];
    if (chapters.length === 0) {
        throw new Error('NO_CHAPTERS');
    }
    return chapters.map((chapter, index) => ({
        id: String(chapter.id ?? index),
        index,
        start: Number.parseFloat(chapter.start_time ?? '0'),
        end: Number.parseFloat(chapter.end_time ?? '0'),
        title: chapter.tags?.title ?? '',
    }));
}

// 全ストリーム情報とコンテナ名を取得する
export async function probeMedia(
    input: string,
    jobId?: string
): Promise<{ streams: FfStream[]; formatName: string; durationSec: number | null }> {
    const data = await probeJson<FfprobeMediaResult>(['-show_streams', '-show_format', input], { jobId });
    const duration = Number.parseFloat(data.format?.duration ?? '');
    return {
        streams: data.streams ?? [],
        formatName: data.format?.format_name ?? '',
        durationSec: Number.isFinite(duration) ? duration : null,
    };
}

// 本編の映像ストリーム index を返す (カバーアートは除外、無ければ null)
export function findVideoStreamIndex(streams: FfStream[]): number | null {
    for (const stream of streams) {
        if (stream.codec_type !== 'video') continue;
        if (!stream.disposition?.attached_pic) {
            return stream.index;
        }
    }
    return null;
}

// 数値項目の取り出し (ffprobe は文字列で返し、不明な場合は "N/A" になる)
function toNumber(value: string | number | undefined): number | null {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
}

// 画面表示用にストリーム情報を整える
function toStreamInfo(stream: FfStream): MediaStreamInfo {
    const kind: MediaStreamKind =
        stream.codec_type === 'video' || stream.codec_type === 'audio' || stream.codec_type === 'subtitle'
            ? stream.codec_type
            : 'other';
    const bitrate = toNumber(stream.bit_rate) ?? toNumber(stream.max_bit_rate);
    return {
        index: stream.index,
        kind,
        codecType: stream.codec_type ?? '',
        codec: stream.codec_name ?? '',
        codecTag: stream.codec_tag_string ?? null,
        handlerName: stream.tags?.handler_name ?? null,
        frameCount: toNumber(stream.nb_frames),
        width: toNumber(stream.width),
        height: toNumber(stream.height),
        pixelFormat: stream.pix_fmt ?? null,
        attachedPic: kind === 'video' && !!stream.disposition?.attached_pic,
        isDefault: !!stream.disposition?.default,
        isForced: !!stream.disposition?.forced,
        channels: toNumber(stream.channels),
        sampleRate: toNumber(stream.sample_rate),
        // bps で返るため kbps へ丸める
        bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
        language: stream.tags?.language ?? null,
        title: stream.tags?.title ?? null,
    };
}

// VOBSUB のパレットを取り出す (extradata のテキスト "palette: 000000, efefef, ..." 部分)。
// 字幕を作り直すときに元の色をそのまま使うために必要
export async function probeSubtitlePalette(
    inputPath: string,
    subRelIndex: number,
    jobId?: string
): Promise<string | null> {
    const data = await probeJson<{ streams?: Array<{ extradata?: string }> }>(
        ['-select_streams', `s:${subRelIndex}`, '-show_streams', '-show_data', inputPath],
        { jobId }
    );
    const dump = data.streams?.[0]?.extradata;
    if (!dump) return null;
    // ffprobe の 16 進ダンプは "オフセット: 4桁組 x8  ASCII" の固定幅。16 進部分だけを取り出す
    const bytes: number[] = [];
    for (const line of dump.split('\n')) {
        if (!/^[0-9a-f]{8}:/i.test(line.trim())) continue;
        const hexArea = line.slice(line.indexOf(':') + 1, line.indexOf(':') + 41);
        for (const group of hexArea.trim().split(/\s+/)) {
            if (!/^[0-9a-f]{2,4}$/i.test(group)) continue;
            for (let i = 0; i + 2 <= group.length; i += 2) {
                bytes.push(Number.parseInt(group.slice(i, i + 2), 16));
            }
        }
    }
    const match = /palette:\s*([0-9a-f,\s]+)/i.exec(Buffer.from(bytes).toString('latin1'));
    return match ? match[1].replace(/\s+/g, '').replace(/,+$/, '') : null;
}

// GUI 向け: チャプター一覧とコンテナ情報をまとめて取得する
export async function probeChapterFile(input: string): Promise<ChapterProbeResult> {
    const chapters = await probeChapters(input);
    const media = await probeMedia(input);
    return {
        chapters,
        formatName: media.formatName,
        durationSec: media.durationSec,
        hasVideo: findVideoStreamIndex(media.streams) !== null,
        streams: media.streams.map(toStreamInfo),
    };
}
