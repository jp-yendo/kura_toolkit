import { probeJson } from '../ffmpeg/ffprobe';
import type { ChapterInfo, VideoProbeResult, MediaStreamInfo, MediaStreamKind } from '../../../shared/types';

// ffprobe による入力メディアの解析

export type FfStream = {
    index: number;
    codec_type?: string;
    codec_name?: string;
    codec_tag_string?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    channels?: number;
    channel_layout?: string;
    sample_rate?: string;
    nb_frames?: string;
    // 映像のフレームレート (分数の文字列。例: "30000/1001")
    r_frame_rate?: string;
    avg_frame_rate?: string;
    bit_rate?: string;
    max_bit_rate?: string;
    start_time?: string;
    duration?: string;
    profile?: string;
    // H.264 などのレベル (例: 40 = 4.0)
    level?: number;
    // 色の規格 (色域・伝達特性・行列・範囲)
    color_primaries?: string;
    color_transfer?: string;
    color_space?: string;
    color_range?: string;
    // 画素の縦横比 (例: "32:27")
    sample_aspect_ratio?: string;
    // インターレース ("progressive" / "tt" / "bb" / "tb" / "bt")
    field_order?: string;
    // 音声のビット深度 (分かる場合のみ) と標本の形式
    bits_per_raw_sample?: string;
    bits_per_sample?: number;
    sample_fmt?: string;
    // コーデックの初期化データの CRC32 (-show_data_hash。同じ設定で作られたものかの判定に使う)
    extradata_hash?: string;
    // 回転 (Display Matrix) など
    side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
    // 既定・強制・副音声・聴覚障害者向けなどの指定 (名前 -> 0/1)
    disposition?: Record<string, number | undefined>;
    tags?: Record<string, string>;
};

type FfprobeChaptersResult = {
    chapters?: Array<{
        start_time?: string;
        end_time?: string;
        tags?: Record<string, string>;
    }>;
};

type FfprobeMediaResult = {
    streams?: FfStream[];
    format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
};

// チャプター情報を取得する (チャプターが無い場合は空)
export async function readChapters(input: string, jobId?: string): Promise<ChapterInfo[]> {
    const data = await probeJson<FfprobeChaptersResult>(['-show_chapters', input], { jobId });
    const chapters = data.chapters ?? [];
    return chapters.map((chapter, index) => ({
        index,
        start: Number.parseFloat(chapter.start_time ?? '0'),
        end: Number.parseFloat(chapter.end_time ?? '0'),
        title: chapter.tags?.title ?? '',
        tags: chapter.tags ?? {},
    }));
}

// チャプター情報を取得する。チャプターが無い場合は NO_CHAPTERS を投げる
export async function probeChapters(input: string, jobId?: string): Promise<ChapterInfo[]> {
    const chapters = await readChapters(input, jobId);
    if (chapters.length === 0) {
        throw new Error('NO_CHAPTERS');
    }
    return chapters;
}

// 全ストリーム情報とコンテナ名を取得する
export async function probeMedia(
    input: string,
    jobId?: string
): Promise<{
    streams: FfStream[];
    formatName: string;
    durationSec: number | null;
    // ファイル全体のメタ情報 (タイトル・作者など)
    formatTags: Record<string, string>;
}> {
    const data = await probeJson<FfprobeMediaResult>(
        ['-show_streams', '-show_format', '-show_data_hash', 'CRC32', input],
        { jobId }
    );
    const duration = Number.parseFloat(data.format?.duration ?? '');
    return {
        streams: data.streams ?? [],
        formatName: data.format?.format_name ?? '',
        durationSec: Number.isFinite(duration) ? duration : null,
        formatTags: data.format?.tags ?? {},
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

// 画面表示と結合できるかの判定用にストリーム情報を整える
export function toStreamInfo(stream: FfStream): MediaStreamInfo {
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
        // VP8・VP9 の透過は別の層に持つため、ffprobe は透過の無い画素形式を返す。透過の印 (alpha_mode) があれば透過付きとする
        pixelFormat: hasAlphaLayer(stream) && stream.pix_fmt === 'yuv420p' ? 'yuva420p' : (stream.pix_fmt ?? null),
        attachedPic: kind === 'video' && !!stream.disposition?.attached_pic,
        isDefault: !!stream.disposition?.default,
        isForced: !!stream.disposition?.forced,
        channels: toNumber(stream.channels),
        sampleRate: toNumber(stream.sample_rate),
        // bps で返るため kbps へ丸める
        bitrateKbps: bitrate === null ? null : Math.round(bitrate / 1000),
        language: stream.tags?.language ?? null,
        title: stream.tags?.title ?? null,
        profile: stream.profile ?? null,
        colorPrimaries: knownValue(stream.color_primaries),
        colorTransfer: knownValue(stream.color_transfer),
        colorSpace: knownValue(stream.color_space),
        colorRange: knownValue(stream.color_range),
        sampleAspectRatio: knownValue(stream.sample_aspect_ratio),
        fieldOrder: knownValue(stream.field_order),
        rotation: streamRotation(stream),
        bitsPerSample: audioBits(stream),
        sampleFormat: stream.sample_fmt ?? null,
        extradataHash: stream.extradata_hash ?? null,
        fileName: stream.tags?.filename ?? null,
        timecode: stream.tags?.timecode ?? null,
    };
}

// HDR のマスタリングの情報 (表示装置の色域の座標・白色点・明るさ (cd/m²) と、コンテンツの最大・平均の明るさ)
export type HdrMetadata = {
    display: {
        red: [number, number];
        green: [number, number];
        blue: [number, number];
        white: [number, number];
        minLuminance: number;
        maxLuminance: number;
    } | null;
    light: { maxContent: number; maxAverage: number } | null;
};

// 分数の文字列 ("34000/50000") の値
function ratio(value: string | number | undefined): number {
    if (typeof value === 'number') return value;
    const [num, den = '1'] = (value ?? '').split('/');
    const result = Number(num) / Number(den);
    return Number.isFinite(result) ? result : 0;
}

// 映像の最初のフレームから HDR のマスタリングの情報を読む (無ければ null)。videoIndex は映像ストリームの中での順番
export async function probeHdrMetadata(input: string, videoIndex: number, jobId?: string): Promise<HdrMetadata | null> {
    type SideData = Record<string, string | number | undefined> & { side_data_type?: string };
    const data = await probeJson<{ frames?: Array<{ side_data_list?: SideData[] }> }>(
        [
            '-select_streams',
            `v:${videoIndex}`,
            '-read_intervals',
            '%+#1',
            '-show_frames',
            '-show_entries',
            'frame=side_data_list',
            input,
        ],
        { jobId }
    );
    const list = data.frames?.[0]?.side_data_list ?? [];
    const display = list.find(item => item.side_data_type === 'Mastering display metadata');
    const light = list.find(item => item.side_data_type === 'Content light level metadata');
    if (!display && !light) return null;
    return {
        display: display
            ? {
                  red: [ratio(display.red_x), ratio(display.red_y)],
                  green: [ratio(display.green_x), ratio(display.green_y)],
                  blue: [ratio(display.blue_x), ratio(display.blue_y)],
                  white: [ratio(display.white_point_x), ratio(display.white_point_y)],
                  minLuminance: ratio(display.min_luminance),
                  maxLuminance: ratio(display.max_luminance),
              }
            : null,
        light: light ? { maxContent: ratio(light.max_content), maxAverage: ratio(light.max_average) } : null,
    };
}

// VP8・VP9 の透過の層を持つか (webm・mkv の alpha_mode)
export function hasAlphaLayer(stream: FfStream): boolean {
    return (
        (stream.codec_name === 'vp8' || stream.codec_name === 'vp9') &&
        (stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE) === '1'
    );
}

// ffprobe が「分からない」を表す値は null にそろえる
function knownValue(value: string | undefined): string | null {
    return value && value !== 'unknown' && value !== 'N/A' && value !== '0:1' ? value : null;
}

// 回転の角度 (0・90・180・270。Display Matrix は反時計回りの角度で返るため、時計回りへ直さず符号だけ正規化する)
function streamRotation(stream: FfStream): number {
    const matrix = stream.side_data_list?.find(item => item.side_data_type === 'Display Matrix');
    const rotation = Math.round(matrix?.rotation ?? Number(stream.tags?.rotate ?? 0)) || 0;
    return ((rotation % 360) + 360) % 360;
}

// 音声の 1 標本のビット数 (分かる場合のみ。非可逆圧縮の音声は持たない)
function audioBits(stream: FfStream): number | null {
    if (stream.codec_type !== 'audio') return null;
    const raw = toNumber(stream.bits_per_raw_sample);
    if (raw) return raw;
    return stream.bits_per_sample ? stream.bits_per_sample : null;
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

// GUI 向け: チャプター一覧 (無ければ空) とコンテナ情報をまとめて取得する
export async function probeVideoFile(input: string): Promise<VideoProbeResult> {
    const chapters = await readChapters(input);
    const media = await probeMedia(input);
    return {
        chapters,
        formatName: media.formatName,
        durationSec: media.durationSec,
        hasVideo: findVideoStreamIndex(media.streams) !== null,
        streams: media.streams.map(toStreamInfo),
        formatTags: media.formatTags,
    };
}
