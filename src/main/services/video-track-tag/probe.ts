import fs from 'fs';
import path from 'path';
import { probeJson } from '../ffmpeg/ffprobe';
import { trackTitleOf } from '../../../shared/video-track-tag';
import type { ProbeField, TrackKind, TrackStreamInfo, TrackTagFile } from '../../../shared/types';

// 動画トラック・タグ管理: ファイルの解析 (表示するすべての項目・トラック・タグ・チャプター)

type FfValue = string | number | boolean | null | undefined | FfValue[] | { [key: string]: FfValue };

export type FfprobeStream = {
    index: number;
    codec_type?: string;
    codec_name?: string;
    codec_tag_string?: string;
    width?: number;
    height?: number;
    channels?: number;
    channel_layout?: string;
    sample_rate?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    bit_rate?: string;
    nb_frames?: string;
    disposition?: Record<string, number | undefined>;
    tags?: Record<string, string>;
    [key: string]: FfValue;
};

type FfprobeResult = {
    streams?: FfprobeStream[];
    format?: { tags?: Record<string, string>; duration?: string; [key: string]: FfValue };
    chapters?: Array<{ start_time?: string; end_time?: string; tags?: Record<string, string> }>;
};

// ffprobe の項目を表示用に平らにする (入れ子の項目は「親.子」、配列は「親[番号]」の名前にする)
function flatten(value: FfValue, prefix: string, out: ProbeField[]): void {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
        value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
        return;
    }
    if (typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
        return;
    }
    out.push({ key: prefix, value: String(value) });
}

function fieldsOf(record: Record<string, FfValue>, skip: string[]): ProbeField[] {
    const out: ProbeField[] = [];
    for (const [key, value] of Object.entries(record)) {
        if (skip.includes(key)) continue;
        flatten(value, key, out);
    }
    return out;
}

// フレームレート (分数の文字列) の値。分からなければ 0
function rateOf(value: string | undefined): number {
    const [num, den = '1'] = (value ?? '').split('/');
    const rate = Number(num) / Number(den);
    return Number.isFinite(rate) && rate > 0 && rate <= 1000 ? rate : 0;
}

// mp4 はチャプターを 'text' トラックとして持つ。収録数がチャプター数と一致することで見分ける
function isChapterTrack(stream: FfprobeStream, chapterCount: number): boolean {
    return (
        stream.codec_type === 'data' &&
        (stream.codec_tag_string ?? '').toLowerCase() === 'text' &&
        chapterCount > 0 &&
        Number(stream.nb_frames) === chapterCount
    );
}

// 編集の対象にするトラックの種類 (カバーアート・データ・添付ファイル・チャプター用のトラックは null)
function kindOf(stream: FfprobeStream): TrackKind | null {
    if (stream.codec_type === 'video') return stream.disposition?.attached_pic ? null : 'video';
    if (stream.codec_type === 'audio' || stream.codec_type === 'subtitle') return stream.codec_type;
    return null;
}

// 秒を HH:MM:SS.mmm にする
function clock(sec: number): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${(sec % 60).toFixed(3).padStart(6, '0')}`;
}

// トラックの長さ (秒)。ストリームの長さ (mp4 など) か、DURATION のタグ (mkv。HH:MM:SS.nnnnnnnnn) から求め、
// どちらも無ければ fileDuration
function durationOf(stream: FfprobeStream, fileDuration: number | null): number | null {
    const direct = Number(stream.duration);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const tag = Object.entries(stream.tags ?? {}).find(([key]) => /^duration(-.*)?$/i.test(key))?.[1];
    const match = tag ? /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(tag.trim()) : null;
    if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return fileDuration;
}

// コーデックのタグ (mp4 の hvc1・avc1・mp4a など。持たない形式 (mkv は [0][0][0][0] になる) は空)
function codecTagOf(stream: FfprobeStream): string {
    const tag = stream.codec_tag_string ?? '';
    return /^[!-~]{4}$/.test(tag) && !tag.includes('[') ? tag : '';
}

// 一覧に添える要約の行: 1 行目は長さとビットレート (字幕は長さだけ。字幕のビットレートは意味を持たないため)、
// 2 行目は映像は解像度とフレームレート・音声はチャンネル数とサンプルレート・画像の字幕は解像度 (値の無い行は除く)
function summaryOf(stream: FfprobeStream, fileDuration: number | null): string[] {
    const timing: string[] = [];
    const format: string[] = [];
    if (stream.codec_type === 'video' || stream.codec_type === 'audio') {
        const duration = durationOf(stream, fileDuration);
        if (duration !== null) timing.push(clock(duration));
        const bitRate = Number(stream.bit_rate);
        if (Number.isFinite(bitRate) && bitRate > 0) timing.push(`${Math.round(bitRate / 1000)} kb/s`);
    } else if (stream.codec_type === 'subtitle') {
        // 字幕の長さはファイルの長さで代えない (字幕の終わりは本編より前のことがある)
        const duration = durationOf(stream, null);
        if (duration !== null) timing.push(clock(duration));
        if (stream.width && stream.height) format.push(`${stream.width}x${stream.height}`);
    }
    if (stream.codec_type === 'video') {
        if (stream.width && stream.height) format.push(`${stream.width}x${stream.height}`);
        const rate = rateOf(stream.avg_frame_rate) || rateOf(stream.r_frame_rate);
        if (rate) format.push(`${Number(rate.toFixed(3))} fps`);
    } else if (stream.codec_type === 'audio') {
        if (stream.channels) {
            format.push(`${stream.channels}ch${stream.channel_layout ? ` (${stream.channel_layout})` : ''}`);
        }
        if (stream.sample_rate) format.push(`${stream.sample_rate} Hz`);
    }
    return [timing.join(' / '), format.join(' / ')].filter(line => line !== '');
}

// fileDuration はファイル全体の長さ (トラックの長さが分からない場合に要約に使う)
export function toTrackStream(
    stream: FfprobeStream,
    chapterCount: number,
    fileDuration: number | null = null
): TrackStreamInfo {
    const dispositions = Object.entries(stream.disposition ?? {})
        .filter(([, value]) => value === 1)
        .map(([name]) => name);
    return {
        index: stream.index,
        codecType: stream.codec_type ?? '',
        kind: isChapterTrack(stream, chapterCount) ? null : kindOf(stream),
        codec: stream.codec_name ?? '',
        language: stream.tags?.language ?? '',
        title: trackTitleOf(stream.tags ?? {}),
        isDefault: dispositions.includes('default'),
        codecTag: codecTagOf(stream),
        summary: summaryOf(stream, fileDuration),
        fields: fieldsOf(stream, ['tags', 'disposition']),
        tags: stream.tags ?? {},
        dispositions,
    };
}

// ffprobe のストリームの一覧 (タグと指定を含む)
export async function probeStreams(input: string, jobId?: string): Promise<FfprobeStream[]> {
    const data = await probeJson<FfprobeResult>(['-show_streams', input], { jobId });
    return data.streams ?? [];
}

// ファイルの始まりの時刻 (MPEG-TS などは 0 でない)。書き出したファイルは 0 から始まるため、チャプターとフレームの時刻は
// これを引いた、ファイルの始まりを 0 とする時刻で扱う。負の場合 (mp4 の音声の先頭の遅延など) は 0 とする
function startOf(data: FfprobeResult): number {
    const start = Number.parseFloat(String(data.format?.start_time ?? ''));
    return Number.isFinite(start) && start > 0 ? start : 0;
}

export async function fileStartOf(input: string): Promise<number> {
    return startOf(await probeJson<FfprobeResult>(['-show_entries', 'format=start_time', input]));
}

export async function probeTrackFile(input: string): Promise<TrackTagFile> {
    const data = await probeJson<FfprobeResult>(['-show_format', '-show_streams', '-show_chapters', input]);
    const start = startOf(data);
    const chapters = (data.chapters ?? []).map(chapter => {
        const { title = '', ...tags } = chapter.tags ?? {};
        return {
            title,
            start: Math.max(0, Number.parseFloat(chapter.start_time ?? '0') - start),
            end: Math.max(0, Number.parseFloat(chapter.end_time ?? '0') - start),
            tags,
        };
    });
    const duration = Number.parseFloat(data.format?.duration ?? '');
    let sizeBytes = 0;
    try {
        sizeBytes = fs.statSync(input).size;
    } catch {
        // 大きさが分からなくても解析結果は示す
    }
    return {
        path: input,
        extension: path.extname(input).toLowerCase(),
        sizeBytes,
        durationSec: Number.isFinite(duration) ? duration : null,
        formatFields: data.format ? fieldsOf(data.format, ['tags']) : [],
        formatTags: data.format?.tags ?? {},
        streams: (data.streams ?? []).map(stream =>
            toTrackStream(stream, chapters.length, Number.isFinite(duration) ? duration : null)
        ),
        chapters,
    };
}
