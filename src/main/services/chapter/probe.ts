import { probeJson } from '../ffmpeg/ffprobe';
import type { ChapterInfo, ChapterProbeResult } from '../../../shared/types';

// ffprobe による入力メディアの解析 (元: cut-chapter.py の run_ffprobe_chapters / probe_media)

export type FfStream = {
    index: number;
    codec_type?: string;
    codec_name?: string;
    pix_fmt?: string;
    channels?: number;
    bit_rate?: string;
    max_bit_rate?: string;
    start_time?: string;
    duration?: string;
    disposition?: { attached_pic?: number };
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

// GUI 向け: チャプター一覧とコンテナ情報をまとめて取得する
export async function probeChapterFile(input: string): Promise<ChapterProbeResult> {
    const chapters = await probeChapters(input);
    const media = await probeMedia(input);
    return {
        chapters,
        formatName: media.formatName,
        durationSec: media.durationSec,
        hasVideo: findVideoStreamIndex(media.streams) !== null,
    };
}
