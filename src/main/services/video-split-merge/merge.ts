import fs from 'fs';
import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { discardLater, newTempDir, produceFile } from '../work-dir';
import { formatTime } from './cut';
import { availableEncoders } from '../audio-formats';
import { LOSSLESS_AUDIO, streamBitrate, videoQualityArgs } from './encoders';
import { hdrArgs } from './hdr';
import { escapeMeta } from './metadata';
import { HANDLER_NAME_CONTAINERS, streamMetadataArgs } from './stream-metadata';
import { availableFilters } from '../ffmpeg/filters';
import { buildSubtitleTracks, concatPath } from './merge-subtitles';
import {
    hasAlphaLayer,
    probeHdrMetadata,
    probeMedia,
    readChapters,
    toStreamInfo,
    type FfStream,
    type HdrMetadata,
} from './probe';
import {
    AUDIO_ONLY_EXTENSIONS,
    choosePixelFormat,
    encoderLosses,
    HDR_METADATA_ENCODERS,
    planCodecs,
    requiredAudioBits,
    requiredPixel,
} from '../../../shared/video-codecs';
import {
    canMergeWithoutReencode,
    colorRank,
    planMerge,
    type MergeLoss,
    type MergeSource as SharedMergeSource,
} from '../../../shared/video-merge';
import type { ChapterInfo, VideoMergeRequest } from '../../../shared/types';

// 複数のファイルを並べた順に 1 つのファイルへ結合する

export type MergeOptions = {
    request: VideoMergeRequest;
    jobId: string;
    log: (line: string) => void;
    onProgress?: (percent: number) => void;
};

type MergeSource = {
    input: string;
    // 結合部に付けるチャプターの名前
    title: string;
    streams: FfStream[];
    formatName: string;
    formatTags: Record<string, string>;
    duration: number;
    // 結合後のファイルでの始まりの位置 (秒)
    offset: number;
    chapters: ChapterInfo[];
};

type MergedChapter = {
    start: number;
    end: number;
    // タイトル・言語などのタグ
    tags: Record<string, string>;
};

// チャンネル数ごとの標準のチャンネル配置 (元の配置が分からない場合に使う)
const CHANNEL_LAYOUTS: Record<number, string> = {
    1: 'mono',
    2: 'stereo',
    3: '2.1',
    4: 'quad',
    5: '5.0',
    6: '5.1',
    7: '6.1',
    8: '7.1',
};

const FFMPEG_QUIET = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];

// 長さ (秒) を求める。コンテナの長さが分からない場合はストリームの長さの最大で代える
function mediaDuration(durationSec: number | null, streams: FfStream[]): number {
    if (durationSec !== null && durationSec > 0) return durationSec;
    const lengths = streams
        .map(stream => Number.parseFloat(stream.duration ?? ''))
        .filter(value => Number.isFinite(value) && value > 0);
    if (lengths.length === 0) throw new Error('UNKNOWN_DURATION');
    return Math.max(...lengths);
}

async function loadSource(input: string, title: string, offset: number, jobId: string): Promise<MergeSource> {
    const media = await probeMedia(input, jobId);
    if (!media.streams.some(stream => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
        throw new Error('NO_MEDIA_STREAMS');
    }
    const chapters = await readChapters(input, jobId);
    return {
        input,
        // 名前が空の場合はファイル名 (拡張子なし) を使う
        title: title.trim() || path.basename(input, path.extname(input)),
        streams: media.streams,
        formatName: media.formatName,
        formatTags: media.formatTags,
        duration: mediaDuration(media.durationSec, media.streams),
        offset,
        chapters,
    };
}

function toShared(source: MergeSource): SharedMergeSource {
    return {
        extension: path.extname(source.input).toLowerCase(),
        formatName: source.formatName,
        streams: source.streams.map(toStreamInfo),
        chapterCount: source.chapters.length,
        formatTags: source.formatTags,
    };
}

// 本編の映像 (カバーアートを除く) と音声
function mainVideos(source: MergeSource): FfStream[] {
    return source.streams.filter(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
}
function audios(source: MergeSource): FfStream[] {
    return source.streams.filter(stream => stream.codec_type === 'audio');
}
function subtitlesOf(source: MergeSource): FfStream[] {
    return source.streams.filter(stream => stream.codec_type === 'subtitle');
}

// 映像ストリームの中での順番 (カバーアートも数える。-map の v:N 指定に使う)
function videoOrder(source: MergeSource, stream: FfStream): number {
    return source.streams.filter(item => item.codec_type === 'video').indexOf(stream);
}

// 結合した後のチャプターを決める。元のファイルのチャプターは結合後の位置へずらして残し、
// addChapters のときは各ファイルの始まりにチャプターを足す
function buildMergedChapters(sources: MergeSource[], addChapters: boolean): MergedChapter[] {
    const chapters: MergedChapter[] = [];
    for (const source of sources) {
        const fileEnd = source.offset + source.duration;
        if (addChapters) {
            // 終わりは次のチャプターの始まりで決める
            chapters.push({ start: source.offset, end: Number.POSITIVE_INFINITY, tags: { title: source.title } });
        }
        for (const chapter of source.chapters) {
            const start = source.offset + Math.max(0, chapter.start);
            // ファイルの長さより後に始まるチャプターは、結合後には次のファイルの位置になってしまうため置けない
            if (start >= fileEnd) continue;
            chapters.push({ start, end: Math.min(source.offset + chapter.end, fileEnd), tags: chapter.tags });
        }
    }
    const total = sources.reduce((sum, source) => sum + source.duration, 0);
    // 次のチャプターに重ならないようにする
    for (let i = 0; i < chapters.length; i++) {
        const next = i + 1 < chapters.length ? chapters[i + 1].start : total;
        chapters[i].end = Math.max(chapters[i].start, Math.min(chapters[i].end, next));
    }
    return chapters;
}

// 全体のメタ情報 (1 つ目のファイルのもの) とチャプターの FFMETADATA
function buildMetadata(tags: Record<string, string>, chapters: MergedChapter[]): string {
    const lines = [';FFMETADATA1'];
    for (const [key, value] of Object.entries(tags)) {
        lines.push(`${escapeMeta(key)}=${escapeMeta(value)}`);
    }
    for (const chapter of chapters) {
        lines.push('[CHAPTER]', 'TIMEBASE=1/1000');
        lines.push(`START=${Math.round(chapter.start * 1000)}`, `END=${Math.round(chapter.end * 1000)}`);
        for (const [key, value] of Object.entries(chapter.tags)) {
            lines.push(`${escapeMeta(key)}=${escapeMeta(value)}`);
        }
    }
    return lines.join('\n') + '\n';
}

// フレームレートの文字列 (分数) の値。使えない値は 0
function frameRateValue(value: string | undefined): number {
    if (!value) return 0;
    const [numerator, denominator = '1'] = value.split('/');
    const rate = Number(numerator) / Number(denominator);
    return Number.isFinite(rate) && rate > 0 && rate <= 240 ? rate : 0;
}

// 値が最大の要素 (同じ値なら先のもの)
function maxBy<T>(items: T[], value: (item: T) => number): T {
    return items.reduce((best, item) => (value(item) > value(best) ? item : best));
}

// 分かっているビットレートの最大 (どれも分からなければ null)
// 映像のビットレートの最大。分からないものがある場合は null (分かるものだけの最大に合わせると、分からないものより
// 低くなりうるため、固定品質で書く)
function maxVideoBitrate(streams: FfStream[]): number | null {
    const rates = streams.map(streamBitrate);
    if (rates.some(rate => rate === null || rate <= 0)) return null;
    return Math.max(...(rates as number[]));
}

// 音声のビットレートの最大。分からないものはチャンネル数から概算する (64000 × チャンネル数)
function maxAudioBitrate(streams: FfStream[]): number {
    return Math.max(...streams.map(stream => streamBitrate(stream) ?? 64000 * (stream.channels ?? 2)));
}

// 画素の縦横比 ("32:27" -> 1.185...。分からない・使えない値は 1)
function sampleAspect(stream: FfStream): number {
    const [num, den] = (stream.sample_aspect_ratio ?? '').split(':').map(Number);
    return num > 0 && den > 0 ? num / den : 1;
}

// 回転 (ffmpeg は回転の指定に従って映像を回してからフィルタへ渡すため、90°・270° では縦横が入れ替わる)
function isSideways(stream: FfStream): boolean {
    const rotation = toStreamInfo(stream).rotation;
    return rotation === 90 || rotation === 270;
}

// 表示される大きさ (画素の縦横比と回転を反映したもの)
function displaySize(stream: FfStream): { width: number; height: number } {
    const width = (stream.width ?? 0) * sampleAspect(stream);
    const height = stream.height ?? 0;
    return isSideways(stream) ? { width: height, height: width } : { width, height };
}

// インターレースか
function isInterlaced(stream: FfStream): boolean {
    return ['tt', 'bb', 'tb', 'bt'].includes(stream.field_order ?? '');
}

// ffprobe の color_space を scale フィルタの色の行列の名前に直す (分からないものは null)
function scaleMatrix(colorSpace: string | undefined): string | null {
    switch (colorSpace) {
        case 'bt709':
            return 'bt709';
        case 'bt470bg':
            return 'bt470';
        case 'smpte170m':
            return 'smpte170m';
        case 'smpte240m':
            return 'smpte240m';
        case 'fcc':
            return 'fcc';
        case 'bt2020nc':
        case 'bt2020c':
            return 'bt2020';
        default:
            return null;
    }
}

// 色の規格の zscale での名前
const ZSCALE_TRANSFER: Record<string, string> = {
    bt709: '709',
    smpte170m: '601',
    bt470bg: '601',
    smpte2084: 'smpte2084',
    'arib-std-b67': 'arib-std-b67',
    'bt2020-10': '2020_10',
    'bt2020-12': '2020_12',
    linear: 'linear',
    'iec61966-2-1': 'iec61966-2-1',
};
const ZSCALE_PRIMARIES: Record<string, string> = {
    bt709: '709',
    smpte170m: '170m',
    bt470bg: '470bg',
    smpte240m: '240m',
    bt2020: '2020',
    smpte432: 'smpte432',
};
const ZSCALE_MATRIX: Record<string, string> = {
    bt709: '709',
    smpte170m: '170m',
    bt470bg: '470bg',
    smpte240m: '240m',
    bt2020nc: '2020_ncl',
    bt2020c: '2020_cl',
};

// 伝達特性・色域が出力と違う映像を、出力の色の規格へ変換する zscale の処理 (変換が要らない・できない場合は null)。
// 指定の無い映像は、再生ソフトと同じく HD 以上は BT.709、それより小さいものは BT.601 として扱う。
// SDR を HDR へ入れる場合は、SDR の白を 203 cd/m² (BT.2408 の基準の白) に合わせ、HLG は 1000 cd/m² を基準にする
function colorConversionChain(
    stream: FfStream,
    target: { primaries?: string; transfer?: string; space?: string; range?: string },
    pixelFormat: string
): string | null {
    const standard = (stream.height ?? 0) >= 720 ? 'bt709' : 'smpte170m';
    const inTransfer = colorValue(stream.color_transfer) ?? 'bt709';
    const inPrimaries = colorValue(stream.color_primaries) ?? standard;
    const inMatrix = colorValue(stream.color_space) ?? standard;
    const inRange = colorValue(stream.color_range) ?? 'tv';
    const outTransfer = target.transfer ?? 'bt709';
    const outPrimaries = target.primaries ?? inPrimaries;
    const outMatrix = target.space ?? inMatrix;
    const outRange = target.range ?? inRange;
    const sdr = (value: string) => value !== 'smpte2084' && value !== 'arib-std-b67';
    const sameTransfer = inTransfer === outTransfer || (sdr(inTransfer) && sdr(outTransfer));
    if (sameTransfer && inPrimaries === outPrimaries) return null;
    const names = [
        ZSCALE_TRANSFER[inTransfer],
        ZSCALE_PRIMARIES[inPrimaries],
        ZSCALE_MATRIX[inMatrix],
        ZSCALE_TRANSFER[outTransfer],
        ZSCALE_PRIMARIES[outPrimaries],
        ZSCALE_MATRIX[outMatrix],
    ];
    // zscale が扱えない規格は変換しない (結合の前に知らせる対象にはならないため、ログで分かるようにする)
    if (names.some(name => !name)) return null;
    const [tin, pin, min, tout, pout, mout] = names;
    const rangeName = (value: string) => (value === 'pc' ? 'full' : 'limited');
    const npl = inTransfer === 'arib-std-b67' ? 1000 : 203;
    return (
        `zscale=tin=${tin}:pin=${pin}:min=${min}:rin=${rangeName(inRange)}:t=linear:p=${pin}:npl=${npl},` +
        `format=gbrpf32le,` +
        `zscale=t=${tout}:p=${pout}:m=${mout}:r=${rangeName(outRange)}:npl=${npl},format=${pixelFormat}`
    );
}

// 色の規格の値 (分からないものは undefined)
function colorValue(value: string | undefined): string | undefined {
    return value && value !== 'unknown' ? value : undefined;
}

function channelLayout(stream: FfStream): string {
    const layout = stream.channel_layout;
    if (layout && layout !== 'unknown') return layout;
    const channels = stream.channels ?? 2;
    return CHANNEL_LAYOUTS[channels] ?? `${channels}c`;
}

// トラックの HDR のマスタリングの情報を、HDR (PQ) の各ファイルの最初のフレームから読み、最大のものにそろえる
// (表示装置の情報は最大の明るさのもの、コンテンツの明るさは最大・平均それぞれの最大)
async function trackHdrMetadata(sources: MergeSource[], track: number, jobId: string): Promise<HdrMetadata | null> {
    const found: HdrMetadata[] = [];
    for (const source of sources) {
        const stream = mainVideos(source)[track];
        if (!stream || stream.color_transfer !== 'smpte2084') continue;
        const metadata = await probeHdrMetadata(source.input, videoOrder(source, stream), jobId);
        if (metadata) found.push(metadata);
    }
    if (found.length === 0) return null;
    const displays = found.map(item => item.display).filter(item => item !== null);
    const lights = found.map(item => item.light).filter(item => item !== null);
    return {
        display: displays.length > 0 ? maxBy(displays, item => item.maxLuminance) : null,
        light:
            lights.length > 0
                ? {
                      maxContent: Math.max(...lights.map(item => item.maxContent)),
                      maxAverage: Math.max(...lights.map(item => item.maxAverage)),
                  }
                : null,
    };
}

// 入力に付けるデコーダの指定。VP8・VP9 の透過は ffmpeg 標準のデコーダでは読めないため、libvpx で読む
function decoderArgs(source: MergeSource): string[] {
    const alpha = mainVideos(source).find(hasAlphaLayer);
    if (!alpha) return [];
    return ['-c:v', alpha.codec_name === 'vp8' ? 'libvpx' : 'libvpx-vp9'];
}

// ffmpeg の入力を順に積み、何番目の入力になったかを返す
class InputList {
    readonly args: string[] = [];
    private count = 0;
    add(...args: string[]): number {
        this.args.push(...args);
        return this.count++;
    }
}

// 再エンコードせずに映像・音声をつなげる (concat デマルチプレクサ。各ファイルの長さを明示して、チャプターの位置と合わせる)。
// 戻り値は本編の映像の数 (カバーアートはこの後ろに並べる)
function addCopyStreams(
    sources: MergeSource[],
    extension: string,
    tempDir: string,
    inputs: InputList,
    outputs: string[]
): number {
    const listPath = path.join(tempDir, 'inputs.txt');
    const lines = ['ffconcat version 1.0'];
    for (const source of sources) {
        lines.push(`file ${concatPath(source.input)}`, `duration ${source.duration.toFixed(6)}`);
    }
    fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf-8');
    const index = inputs.add('-f', 'concat', '-safe', '0', '-i', listPath);
    // 字幕・カバーアート・添付ファイルは別に取り込むため、ここでは本編の映像と音声だけを取る
    outputs.push('-map', `${index}:v?`, '-map', `${index}:a?`);
    for (const stream of sources[0].streams) {
        if (stream.codec_type === 'video' && stream.disposition?.attached_pic) {
            outputs.push('-map', `-${index}:v:${videoOrder(sources[0], stream)}`);
        }
    }
    outputs.push('-c:v', 'copy', '-c:a', 'copy');
    // 言語・タイトルなどは 1 つ目のファイルのものを引き継ぐ (mp4 系ではタイトルを handler_name に書くため明示する)
    mainVideos(sources[0]).forEach((stream, k) => outputs.push(...streamMetadataArgs(`v:${k}`, stream, extension)));
    audios(sources[0]).forEach((stream, k) => outputs.push(...streamMetadataArgs(`a:${k}`, stream, extension)));
    return mainVideos(sources[0]).length;
}

// 再エンコードして映像・音声をつなげる (concat フィルタ)。映像・音声はトラックごとに (各ファイルの同じ順番のものを) つなげる。
// 各トラックは、そのトラックを持つファイルの中で最大のもの (映像は画素数が最大のものの大きさ、フレームレート・ビット深度・
// ビットレート、音声はサンプリング周波数・チャンネル数・ビットレート) にそろえ (映像は縦横比を保って縮め、余白は黒で埋める)、
// そのトラックを持たないファイルの分は黒い画面・無音で埋める。言語などのメタ情報は、そのトラックを持つ最初のファイルから引き継ぐ。
// 戻り値は本編の映像の数
function addReencodeStreams(
    sources: MergeSource[],
    sourceInputs: number[],
    extension: string,
    // 使う映像・音声のエンコーダ (映像・音声が無い場合は null)
    encoders: { video: string | null; audio: string | null },
    // 映像のトラックごとの HDR のマスタリングの情報 (無ければ null)
    hdr: Array<HdrMetadata | null>,
    // 色の規格を変換できるか (zscale がある)
    colorConversion: boolean,
    inputs: InputList,
    outputs: string[],
    plan: (line: string) => void
): number {
    const videoTracks = AUDIO_ONLY_EXTENSIONS.has(extension)
        ? 0
        : Math.max(0, ...sources.map(source => mainVideos(source).length));
    const audioTracks = Math.max(0, ...sources.map(source => audios(source).length));
    if (videoTracks === 0 && audioTracks === 0) throw new Error('NO_MEDIA_STREAMS');

    const filters: string[] = [];
    const segments: string[] = sources.map(() => '');

    for (let track = 0; track < videoTracks; track++) {
        const members = sources
            .map(source => mainVideos(source)[track])
            .filter((stream): stream is FfStream => stream !== undefined);
        const area = (stream: FfStream) => displaySize(stream).width * displaySize(stream).height;
        const largest = maxBy(members, area);
        // 大きさは、表示される大きさ (画素の縦横比・回転を反映したもの) が最大のものにそろえ、画素は正方形にする。
        // エンコーダの都合で偶数にする
        const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
        const width = even(displaySize(largest).width);
        const height = even(displaySize(largest).height);
        // フレームレートの表記 (分数のまま渡す。r_frame_rate が使えなければ avg_frame_rate)。インターレースはフィールドを
        // 1 枚ずつのフレームにする (動きの細かさを保つ) ため 2 倍で数える
        const rateText = (stream: FfStream) => {
            const text = [stream.r_frame_rate, stream.avg_frame_rate].find(value => frameRateValue(value) > 0);
            if (!text || !isInterlaced(stream)) return text;
            const [numerator, denominator = '1'] = text.split('/');
            return `${Number(numerator) * 2}/${denominator}`;
        };
        const fps = rateText(maxBy(members, stream => frameRateValue(rateText(stream)))) ?? '30';
        const encoder = encoders.video as string;
        // 透過・色差・ビット深度を保てる画素形式 (保てないものは結合の前に知らせている)
        const { pixelFormat, lost } = choosePixelFormat(requiredPixel(members.map(toStreamInfo)), encoder, extension);
        const alpha = pixelFormat.startsWith('yuva');
        const background = alpha ? 'black@0' : 'black';
        // 色の規格は最も広いもの (HDR > SDR、BT.2020 > それ以外。同じなら表示される大きさが最大のもの) にそろえ、
        // 分からない項目はほかのファイルのものを使う。伝達特性・色域の違うものは zscale で変換し、行列・範囲の違いは scale で変換する
        const colorBase = members.reduce((best, stream) => {
            const rank = colorRank(toStreamInfo(stream)) - colorRank(toStreamInfo(best));
            return rank > 0 || (rank === 0 && area(stream) > area(best)) ? stream : best;
        });
        const pick = (key: 'color_primaries' | 'color_transfer' | 'color_space' | 'color_range') =>
            colorValue(colorBase[key]) ?? members.map(stream => colorValue(stream[key])).find(Boolean);
        const primaries = pick('color_primaries');
        const transfer = pick('color_transfer');
        const space = pick('color_space');
        const range = pick('color_range');
        const bitrate = maxVideoBitrate(members);
        sources.forEach((source, i) => {
            const label = `[v${track}_${i}]`;
            const stream = mainVideos(source)[track];
            if (stream) {
                const chain: string[] = [];
                // インターレースはフィールドごとのフレームに分ける
                if (isInterlaced(stream)) chain.push('bwdif=mode=send_field:parity=auto:deint=all');
                // 画素が正方形でないものは、先に正方形の画素へ直す
                if (Math.abs(sampleAspect(stream) - 1) > 0.001) chain.push("scale='trunc(iw*sar/2)*2':ih");
                const fit = [`scale=${width}:${height}:force_original_aspect_ratio=decrease`];
                const conversion = colorConversion
                    ? colorConversionChain(stream, { primaries, transfer, space, range }, pixelFormat)
                    : null;
                if (conversion) {
                    chain.push(conversion);
                } else {
                    const inMatrix = scaleMatrix(stream.color_space);
                    const outMatrix = scaleMatrix(space);
                    if (inMatrix && outMatrix && inMatrix !== outMatrix) {
                        fit.push(`in_color_matrix=${inMatrix}`, `out_color_matrix=${outMatrix}`);
                    }
                    const inRange = colorValue(stream.color_range);
                    if (inRange && range && inRange !== range) fit.push(`in_range=${inRange}`, `out_range=${range}`);
                }
                chain.push(fit.join(':'));
                chain.push(
                    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background}`,
                    'setsar=1',
                    // ファイルの中の映像と音声の始まりのずれを保つため、始まりの時刻はそのままにし、0 秒から
                    // 映像が始まるまでは最初のフレームで埋める
                    `fps=fps=${fps}:start_time=0`,
                    `format=${pixelFormat}`
                );
                filters.push(`[${sourceInputs[i]}:v:${videoOrder(source, stream)}]${chain.join(',')}${label}`);
            } else {
                const blank = inputs.add(
                    '-f',
                    'lavfi',
                    '-t',
                    source.duration.toFixed(6),
                    '-i',
                    `color=c=${background}:s=${width}x${height}:r=${fps}`
                );
                filters.push(`[${blank}:v]format=${pixelFormat},setsar=1${label}`);
            }
            segments[i] += label;
        });
        // ビットレートが分かればその最大、どれも分からなければ固定品質
        const quality = bitrate !== null ? [`-b:v:${track}`, String(bitrate)] : videoQualityArgs(encoder, `v:${track}`);
        outputs.push('-map', `[vout${track}]`, `-c:v:${track}`, encoder, ...quality);
        // mp4 系の HEVC は、Apple の再生ソフトでも再生できるよう hvc1 として書く (ffmpeg の既定は hev1)
        if (encoder === 'libx265' && HANDLER_NAME_CONTAINERS.has(extension)) outputs.push(`-tag:v:${track}`, 'hvc1');
        // 色の規格を出力に書く (HDR のマスタリングの情報は、ffmpeg がフレームから引き継ぐ)
        if (primaries) outputs.push(`-color_primaries:v:${track}`, primaries);
        if (transfer) outputs.push(`-color_trc:v:${track}`, transfer);
        if (space) outputs.push(`-colorspace:v:${track}`, space);
        if (range) outputs.push(`-color_range:v:${track}`, range);
        outputs.push(...hdrArgs(encoder, track, hdr[track] ?? null));
        outputs.push(...streamMetadataArgs(`v:${track}`, members[0], extension));
        plan(
            `  v:${track}  ${width}x${height} ${fps} fps ${pixelFormat}` +
                `${transfer ? ` ${primaries ?? '?'}/${transfer}` : ''} -> ${encoder} (${quality.join(' ')})` +
                `${lost.length > 0 ? ` lost: ${lost.join(', ')}` : ''}`
        );
    }

    for (let track = 0; track < audioTracks; track++) {
        const members = sources
            .map(source => audios(source)[track])
            .filter((stream): stream is FfStream => stream !== undefined);
        const sampleRate =
            Math.max(...members.map(stream => Number.parseInt(stream.sample_rate ?? '', 10) || 0)) || 48000;
        const widest = maxBy(members, stream => stream.channels ?? 0);
        const layout = channelLayout(widest);
        const encoder = encoders.audio as string;
        // 可逆のエンコーダで 16bit を超える音声を書く場合は、32bit の標本で渡す (エンコーダが元のビット深度で書く)
        const bits = requiredAudioBits(members.map(toStreamInfo));
        const lossless = LOSSLESS_AUDIO.has(encoder) || encoder.startsWith('pcm_');
        const sampleFormats = lossless && bits > 16 ? ':sample_fmts=s32|s32p' : '';
        sources.forEach((source, i) => {
            const label = `[a${track}_${i}]`;
            if (audios(source)[track]) {
                filters.push(
                    // ファイルの中の映像と音声の始まりのずれを保つため、0 秒から音声が始まるまでは無音で埋める
                    `[${sourceInputs[i]}:a:${track}]aresample=${sampleRate}:async=1:first_pts=0,` +
                        `aformat=sample_rates=${sampleRate}:channel_layouts=${layout}${sampleFormats}${label}`
                );
            } else {
                const silent = inputs.add(
                    '-f',
                    'lavfi',
                    '-t',
                    source.duration.toFixed(6),
                    '-i',
                    `anullsrc=r=${sampleRate}:cl=${layout}`
                );
                filters.push(
                    `[${silent}:a]aformat=sample_rates=${sampleRate}:channel_layouts=${layout}${sampleFormats}${label}`
                );
            }
            segments[i] += label;
        });
        outputs.push('-map', `[aout${track}]`, `-c:a:${track}`, encoder);
        let detail = `${sampleRate} Hz ${layout}${lossless ? ` ${bits} bit` : ''}`;
        if (!lossless) {
            // 元より少ないチャンネルの音声のビットレートで、多いチャンネルの音声を書かないようにする
            const rate = Math.max(maxAudioBitrate(members), 64000 * (widest.channels ?? 2));
            outputs.push(`-b:a:${track}`, String(rate));
            detail += `, ${rate} b/s`;
        }
        outputs.push(...streamMetadataArgs(`a:${track}`, members[0], extension));
        plan(`  a:${track}  ${detail} -> ${encoder}`);
    }

    const outLabels = [
        ...Array.from({ length: videoTracks }, (_, track) => `[vout${track}]`),
        ...Array.from({ length: audioTracks }, (_, track) => `[aout${track}]`),
    ].join('');
    filters.push(`${segments.join('')}concat=n=${sources.length}:v=${videoTracks}:a=${audioTracks}${outLabels}`);
    outputs.push('-filter_complex', filters.join(';'));
    return videoTracks;
}

// カバーアートを画像として取り出す (jpeg は jpg、それ以外は png。jpeg・png 以外の形式は png に変換する)。order は名前の番号
async function extractCover(
    source: MergeSource,
    videoIndex: number,
    order: number,
    tempDir: string,
    jobId: string
): Promise<string> {
    const stream = source.streams.filter(item => item.codec_type === 'video')[videoIndex];
    const codec = stream?.codec_name ?? '';
    const copy = codec === 'mjpeg' || codec === 'png';
    const image = path.join(tempDir, `cover${order}.${codec === 'mjpeg' ? 'jpg' : 'png'}`);
    await runFfmpeg(
        [
            ...FFMPEG_QUIET,
            '-i',
            source.input,
            '-map',
            `0:v:${videoIndex}`,
            '-frames:v',
            '1',
            '-c:v',
            copy ? 'copy' : 'png',
            image,
        ],
        { jobId }
    );
    return image;
}

function lossLine(loss: MergeLoss): string {
    switch (loss.kind) {
        case 'video':
            return 'video (the output format holds audio only)';
        case 'subtitle':
            return `subtitles ${loss.codec} (the output format cannot hold them)`;
        case 'coverArt':
            return 'cover art (the output format cannot hold it)';
        case 'timecode':
            return `timecode of file ${loss.files.join(', ')} (the output timecode continues from file 1)`;
        case 'attachments':
            return 'attachments (the output format cannot hold them)';
        case 'data':
            return `data stream ${loss.codec} (cannot be joined)`;
        case 'subtitleStyle':
            return `subtitle styles (${loss.encoder} cannot hold them)`;
        case 'colorMismatch':
            return `colors of file ${loss.files.join(', ')} (different color standard, not converted)`;
        case 'metadata':
            return `metadata of file ${loss.files.join(', ')} (the one of file 1 is used)`;
        case 'trackNames':
            return `track languages and names of file ${loss.files.join(', ')} (the ones of the first file are used)`;
        case 'hdrMetadata':
            return 'HDR mastering information (the encoder cannot write it)';
        case 'pixelFormat':
            return `video ${loss.lost.join(', ')} (the encoder cannot hold them)`;
    }
}

export async function mergeFiles(options: MergeOptions): Promise<string> {
    const { request, jobId, log } = options;
    if (request.items.length < 2) throw new Error('NEED_TWO_FILES');
    // 拡張子が無いと ffmpeg が出力形式を決められないため、1 つ目のファイルと同じ拡張子を補う
    const requested = path.resolve(request.output);
    const output = path.extname(requested) ? requested : requested + path.extname(request.items[0].input);
    if (request.items.some(item => path.resolve(item.input) === output)) {
        throw new Error('OUTPUT_EQUALS_INPUT');
    }
    const extension = path.extname(output).toLowerCase();

    const sources: MergeSource[] = [];
    let offset = 0;
    for (const item of request.items) {
        const source = await loadSource(item.input, item.chapterTitle, offset, jobId);
        sources.push(source);
        offset += source.duration;
    }
    const total = offset;
    const shared = sources.map(toShared);
    const compatible = canMergeWithoutReencode(shared, extension);
    const reencode = request.reencode || !compatible;
    // 色の規格の変換には zscale が要る
    const colorConversion = (await availableFilters())?.has('zscale') ?? false;
    const mergePlan = planMerge(shared, extension, { colorConversion });
    // 再エンコードのエンコーダは、指定が無ければ元のコーデックから決める (使えるものが無ければ結合できない)
    const available = await availableEncoders();
    const codecPlans = planCodecs(shared, extension, available ? [...available] : null);
    const encoders = {
        video: codecPlans.video ? (request.videoEncoder ?? codecPlans.video.auto) : null,
        audio: codecPlans.audio ? (request.audioEncoder ?? codecPlans.audio.auto) : null,
    };
    if (reencode && ((codecPlans.video && !encoders.video) || (codecPlans.audio && !encoders.audio))) {
        throw new Error('NO_ENCODER');
    }
    // 選んだ映像のエンコーダで書けないもの (結合の前に知らせている) もログに残す
    const losses = [...mergePlan.losses];
    if (reencode && encoders.video) losses.push(...encoderLosses(shared, encoders.video, extension));
    // HDR のマスタリングの情報は、書けるエンコーダで再エンコードする場合に、各トラックについて読む
    const hdr: Array<HdrMetadata | null> = [];
    if (reencode && encoders.video && HDR_METADATA_ENCODERS.has(encoders.video)) {
        const videoTracks = Math.max(0, ...sources.map(source => mainVideos(source).length));
        for (let track = 0; track < videoTracks; track++) hdr.push(await trackHdrMetadata(sources, track, jobId));
    }
    const chapters = buildMergedChapters(sources, request.addChapters);

    log(`files         : ${sources.length}`);
    for (const source of sources) log(`  ${formatTime(source.offset).padStart(14)}  ${source.input}`);
    log(`duration      : ${formatTime(total)}`);
    if (reencode) {
        log(
            compatible
                ? 'mode          : re-encode'
                : 'mode          : re-encode (the files differ in format, or the output format cannot hold them as they are)'
        );
    } else {
        log('mode          : stream copy');
    }
    log(`chapters      : ${chapters.length}`);
    for (const chapter of chapters) {
        log(`  ${formatTime(chapter.start).padStart(14)}  ${chapter.tags.title || '(no title)'}`);
    }
    for (const loss of losses) log(`not included  : ${lossLine(loss)}`);
    log(`output        : ${output}`);

    const tempDir = newTempDir();
    try {
        const plan: string[] = [];
        const inputs = new InputList();
        const outputs: string[] = [];
        // 再エンコードでは各ファイルを入力にする (字幕は別に取り出すため、ストリームコピーでは入力にしない)
        const sourceInputs = reencode
            ? sources.map(source => inputs.add(...decoderArgs(source), '-i', source.input))
            : [];
        const videoCount = reencode
            ? addReencodeStreams(
                  sources,
                  sourceInputs,
                  extension,
                  encoders,
                  hdr,
                  colorConversion,
                  inputs,
                  outputs,
                  line => plan.push(line)
              )
            : addCopyStreams(sources, extension, tempDir, inputs, outputs);

        // 字幕
        const subtitleTracks = await buildSubtitleTracks(sources, mergePlan.subtitles, tempDir, jobId);
        subtitleTracks.forEach((track, n) => {
            const index = inputs.add(...track.inputArgs);
            const trackPlan = mergePlan.subtitles[n];
            outputs.push('-map', `${index}:s:0`, `-c:s:${n}`, trackPlan.kind === 'text' ? trackPlan.encoder : 'copy');
            // 言語・タイトルと既定/強制の指定は、その字幕を持つ最初のファイルから引き継ぐ
            const file = trackPlan.parts.findIndex(part => part !== null);
            const stream = subtitlesOf(sources[file])[trackPlan.parts[file] as number];
            if (stream) outputs.push(...streamMetadataArgs(`s:${n}`, stream, extension));
            plan.push(`  s:${n}  ${track.plan}`);
        });

        // 添付ファイル (フォントなど)。同じ名前のものは 1 つにする
        let attachmentCount = 0;
        if (mergePlan.attachments) {
            // 同じ名前・同じ中身のものは 1 つにし、同じ名前で中身が違うものは名前に番号を付けて残す
            const contents = new Map<string, Set<string>>();
            sources.forEach((source, i) => {
                const attachments = source.streams.filter(stream => stream.codec_type === 'attachment');
                const picked: Array<{ order: number; rename: string | null }> = [];
                attachments.forEach((stream, order) => {
                    const name = stream.tags?.filename ?? `attachment-${i + 1}-${order + 1}`;
                    const content = stream.extradata_hash ?? `${i}-${order}`;
                    const known = contents.get(name);
                    if (!known) {
                        contents.set(name, new Set([content]));
                        picked.push({ order, rename: null });
                    } else if (!known.has(content)) {
                        known.add(content);
                        const extension = path.extname(name);
                        picked.push({ order, rename: `${path.basename(name, extension)} (${known.size})${extension}` });
                    }
                });
                if (picked.length === 0) return;
                // ストリームコピーではファイルを入力にしていないため、添付ファイルだけを読む入力として足す
                const index = reencode ? sourceInputs[i] : inputs.add('-t', '0', '-i', source.input);
                for (const { order, rename } of picked) {
                    outputs.push('-map', `${index}:t:${order}`);
                    if (rename) outputs.push(`-metadata:s:t:${attachmentCount}`, `filename=${rename}`);
                    attachmentCount += 1;
                }
            });
            if (attachmentCount > 0) outputs.push('-c:t', 'copy');
            plan.push(`  attachments: ${attachmentCount}`);
        }

        // カバーアート (すべてのファイルのもの。画像のストリームは本編の映像の後ろ、添付ファイルはほかの添付ファイルの後ろに並ぶ)
        for (let order = 0; order < mergePlan.covers.length; order++) {
            const { file, videoIndex } = mergePlan.covers[order];
            const image = await extractCover(sources[file], videoIndex, order, tempDir, jobId);
            if (mergePlan.coverMethod === 'picture') {
                const index = inputs.add('-i', image);
                const spec = `v:${videoCount + order}`;
                outputs.push('-map', `${index}:v`, `-c:${spec}`, 'copy', `-disposition:${spec}`, 'attached_pic');
            } else if (mergePlan.coverMethod === 'attachment') {
                // mkv は添付ファイルとして持たせる (2 つ目からは名前に番号を付ける)
                const png = image.endsWith('.png');
                const name = `cover${order > 0 ? ` (${order + 1})` : ''}.${png ? 'png' : 'jpg'}`;
                const spec = `t:${attachmentCount + order}`;
                outputs.push(
                    '-attach',
                    image,
                    `-metadata:s:${spec}`,
                    `mimetype=${png ? 'image/png' : 'image/jpeg'}`,
                    `-metadata:s:${spec}`,
                    `filename=${name}`
                );
            }
            plan.push(`  cover art: file ${file + 1} (${mergePlan.coverMethod})`);
        }
        // タイムコード (1 つ目のファイルのものを出力の始まりのタイムコードにする)
        if (mergePlan.timecode) outputs.push('-timecode', mergePlan.timecode);

        // 全体のメタ情報 (1 つ目のファイルのもの) と結合後のチャプターは FFMETADATA で渡す。
        // -map_metadata で全体のメタ情報を指定しても、各ストリームのメタ情報とチャプターの名前は別に引き継がれる
        const metaPath = path.join(tempDir, 'metadata.txt');
        fs.writeFileSync(metaPath, buildMetadata(sources[0].formatTags, chapters), 'utf-8');
        const metaIndex = String(inputs.add('-f', 'ffmetadata', '-i', metaPath));
        outputs.push('-map_metadata', metaIndex, '-map_chapters', metaIndex);

        if (plan.length > 0) {
            log('streams       :');
            for (const line of plan) log(line);
        }
        // ストリームコピーでは元の時刻を保つ (ffmpeg は入力ごとに始まりの時刻を 0 へ寄せるが、つなげた映像・音声は
        // AAC の先頭の遅延などで始まりが負になることがあり、寄せると字幕だけが映像・音声からずれるため)
        const timing = reencode ? [] : ['-copyts'];
        const args = [...FFMPEG_QUIET, ...timing, ...inputs.args, ...outputs];
        // 出力は同じフォルダに別の名前で書き、完成してから正式な名前にする
        await produceFile(output, target =>
            runFfmpeg([...args, target], { jobId, totalSec: total, onProgress: options.onProgress })
        );
        log('done');
    } finally {
        discardLater(tempDir);
    }
    return output;
}
