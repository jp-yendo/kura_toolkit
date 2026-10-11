// 動画の結合で、再エンコードせずにつなげられるかの判定と、各ストリームをどう出力へ引き継ぐかの決定 (main / renderer で共用)。
// Node / DOM に依存させない。

import type { MediaStreamInfo } from './types';
import { AUDIO_ONLY_EXTENSIONS } from './video-codecs';

export type MergeSource = {
    // 入力ファイルの拡張子 (小文字、ドット付き)
    extension: string;
    formatName: string;
    streams: MediaStreamInfo[];
    chapterCount: number;
    // ファイル全体のメタ情報 (タイトル・作者など)
    formatTags: Record<string, string>;
};

// 選べる出力形式 (このほかに「元の形式」を選べる)
export const MERGE_OUTPUT_FORMATS = [
    { id: 'mp4', extension: '.mp4', label: 'MP4' },
    { id: 'mkv', extension: '.mkv', label: 'MKV' },
    { id: 'webm', extension: '.webm', label: 'WebM' },
    { id: 'mov', extension: '.mov', label: 'MOV' },
    { id: 'avi', extension: '.avi', label: 'AVI' },
    { id: 'ts', extension: '.ts', label: 'MPEG-TS' },
] as const;

export type MergeOutputFormat = 'source' | (typeof MERGE_OUTPUT_FORMATS)[number]['id'];

// 「元の形式」で書き出す拡張子。すべてのファイルの拡張子が同じ場合だけ決まり、違う場合は null
export function sourceExtension(sources: Array<Pick<MergeSource, 'extension'>>): string | null {
    if (sources.length === 0) return null;
    const first = sources[0].extension;
    return first && sources.every(source => source.extension === first) ? first : null;
}

// mp4 はチャプターを 'text' トラックとして格納する。ffmpeg はこれをチャプターへ変換してパケットを出さないため
// data 扱いで現れる。収録数がチャプター数と一致することで見分ける
export function isChapterTrack(stream: MediaStreamInfo, chapterCount: number): boolean {
    return (
        stream.codecType === 'data' &&
        (stream.codecTag ?? '').toLowerCase() === 'text' &&
        chapterCount > 0 &&
        stream.frameCount === chapterCount
    );
}

// つなげる相手と一致している必要があるストリームの性質。そのままつなげると 2 つ目以降が正しく再生されない・
// 1 つ目の指定で上書きされるもの (コーデックの初期化データ・プロファイル・色の規格・画素の縦横比・インターレース・回転・
// 音声の標本の形式) も比べる。データ (mp4 のチャプター用トラックなど) と添付ファイルは結合に使わないため比べない
function streamSignature(stream: MediaStreamInfo): string | null {
    if (stream.codecType === 'data' || stream.codecType === 'attachment') return null;
    const parts: Array<string | number | boolean | null> = [stream.index, stream.codecType, stream.codec];
    if (stream.kind === 'video') {
        parts.push(stream.width, stream.height, stream.pixelFormat, stream.attachedPic);
        if (!stream.attachedPic) {
            parts.push(
                stream.extradataHash,
                stream.profile,
                stream.colorPrimaries,
                stream.colorTransfer,
                stream.colorSpace,
                stream.colorRange,
                stream.sampleAspectRatio,
                stream.fieldOrder,
                stream.rotation
            );
        }
    } else if (stream.kind === 'audio') {
        parts.push(
            stream.channels,
            stream.sampleRate,
            stream.extradataHash,
            stream.profile,
            stream.sampleFormat,
            stream.bitsPerSample
        );
    }
    return parts.join('|');
}

function sourceSignature(source: MergeSource): string {
    const streams = source.streams.map(streamSignature).filter((value): value is string => value !== null);
    return [source.formatName, ...streams].join('\n');
}

// 出力形式ごとの、再エンコードせずにそのまま入れられる映像・音声のコーデック (表に無い形式 (mkv) は制限しない)
const COPY_CODECS: Record<string, { video: string[]; audio: string[] }> = {
    '.mp4': {
        video: ['h264', 'hevc', 'mpeg4', 'av1', 'vp9', 'mpeg2video', 'mjpeg'],
        audio: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'flac', 'opus', 'mp2'],
    },
    '.mov': {
        video: ['h264', 'hevc', 'mpeg4', 'av1', 'vp9', 'mpeg2video', 'mjpeg', 'prores', 'dnxhd'],
        audio: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'flac', 'opus', 'mp2', 'pcm_s16le', 'pcm_s24le', 'pcm_s16be'],
    },
    '.webm': { video: ['vp8', 'vp9', 'av1'], audio: ['opus', 'vorbis'] },
    '.avi': {
        video: ['h264', 'mpeg4', 'mjpeg', 'msmpeg4v2', 'msmpeg4v3', 'mpeg2video'],
        audio: ['mp3', 'ac3', 'mp2', 'pcm_s16le', 'pcm_u8'],
    },
    '.ts': {
        video: ['h264', 'hevc', 'mpeg2video', 'mpeg1video'],
        audio: ['aac', 'mp3', 'mp2', 'ac3', 'eac3', 'opus'],
    },
};

// 本編の映像と音声のコーデックを、出力形式がそのまま入れられるか (入力と同じ形式へ書き出す場合は入れられる)
function containerAccepts(sources: MergeSource[], extension: string): boolean {
    if (sources.every(source => source.extension === extension)) return true;
    const rule = COPY_CODECS[extension];
    if (!rule) return true;
    return sources.every(source =>
        source.streams.every(stream => {
            if (stream.kind === 'video' && !stream.attachedPic) return rule.video.includes(stream.codec);
            if (stream.kind === 'audio') return rule.audio.includes(stream.codec);
            return true;
        })
    );
}

// 再エンコードせずにそのままつなげられるか。すべてのファイルが同じ形式 (コンテナ・ストリームの並び・コーデック・
// 解像度・音声の形式) で、出力形式 (拡張子) がその映像・音声をそのまま入れられる場合
export function canMergeWithoutReencode(sources: MergeSource[], extension: string): boolean {
    if (sources.length === 0) return true;
    const first = sourceSignature(sources[0]);
    return sources.every(source => sourceSignature(source) === first) && containerAccepts(sources, extension);
}

// 文字として時刻を書き換えられる字幕
const TEXT_SUBTITLES = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const ASS_SUBTITLES = new Set(['ass', 'ssa']);

// 画像の字幕を格納できる出力形式と、その字幕のコーデック
const BITMAP_SUBTITLE_CONTAINERS: Record<string, string[]> = {
    '.mkv': ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'],
    '.ts': ['dvb_subtitle'],
};

// カバーアートを画像のストリーム (attached picture) として持てる出力形式。mkv は添付ファイルとして持つ
const PICTURE_COVER_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.m4a', '.mp3', '.flac']);

// 出力形式ごとのテキスト字幕のエンコーダ (テキスト字幕を格納できない形式は null)
function textSubtitleEncoder(extension: string, style: 'srt' | 'ass'): string | null {
    if (['.mp4', '.m4v', '.mov'].includes(extension)) return 'mov_text';
    if (extension === '.mkv') return style;
    if (extension === '.webm') return 'webvtt';
    return null;
}

// 結合後の字幕 1 本。parts[i] は i 番目のファイルの何番目の字幕 (字幕の中での順番) をつなげるか (無ければ null)。
// テキストは、すべて SRT なら SRT、それ以外は位置・色などの書式を残せる ASS にそろえてつなげる
export type SubtitleTrackPlan =
    | { kind: 'text'; style: 'srt' | 'ass'; encoder: string; parts: Array<number | null> }
    | { kind: 'bitmap'; codec: string; parts: Array<number | null> };

// 1 つ目のファイルと違っても引き継げない、全体のメタ情報の項目のうち、比べないもの
// (ファイルの作り方で決まる技術的な項目と、ファイルごとに必ず違う作成日時)
const IGNORED_FORMAT_TAGS = new Set(['encoder', 'major_brand', 'minor_version', 'compatible_brands', 'creation_time']);

// 出力に含められないもの
export type MergeLoss =
    | { kind: 'video' }
    | { kind: 'subtitle'; codec: string }
    | { kind: 'coverArt' }
    | { kind: 'attachments' }
    // タイムコード。1 つ目のファイルのものを出力の始まりのタイムコードにするため、2 つ目以降のファイルのもの
    | { kind: 'timecode'; files: number[] }
    | { kind: 'data'; codec: string }
    // 字幕の書式 (位置・色・フォントなど)。ASS の字幕を書式を持てない形式で出力する場合
    | { kind: 'subtitleStyle'; encoder: string }
    // 色の規格 (HDR と SDR など) が出力と違うファイル。変換に使うフィルタ (zscale) が無いため、そのファイルの色は
    // 正しく表示されない
    | { kind: 'colorMismatch'; files: number[] }
    // 全体のメタ情報 (タイトル・作者など) が 1 つ目のファイルと違うファイル。結合後は 1 つ目のものになる
    | { kind: 'metadata'; files: number[] }
    // トラックの言語・名前が 1 つ目のファイルと違うファイル。結合後は 1 つ目のものになる
    | { kind: 'trackNames'; files: number[] }
    // 再エンコードで選んだエンコーダが書けない映像の性質 (透過・色差・ビット深度)
    | { kind: 'pixelFormat'; lost: PixelLoss[] }
    // HDR のマスタリングの情報 (選んだエンコーダが書けない場合)
    | { kind: 'hdrMetadata' };

export type PixelLoss = 'alpha' | 'chroma' | 'bitDepth';

export type MergePlan = {
    subtitles: SubtitleTrackPlan[];
    // 引き継ぐカバーアート (ファイルの番号 (0 から) と、そのファイルの映像ストリームの中での順番)。すべてのファイルのものを残す
    covers: Array<{ file: number; videoIndex: number }>;
    // カバーアートの持たせ方 (画像のストリーム・添付ファイル)
    coverMethod: 'picture' | 'attachment' | null;
    // 1 つ目のファイルのタイムコード (出力の始まりのタイムコードにする。無ければ null)
    timecode: string | null;
    // 添付ファイル (フォントなど) を引き継ぐ
    attachments: boolean;
    losses: MergeLoss[];
};

function subtitlesOf(source: MergeSource): MediaStreamInfo[] {
    return source.streams.filter(stream => stream.kind === 'subtitle');
}

// 出力の拡張子 (小文字、ドット付き) に対して、字幕・カバーアート・添付ファイルの引き継ぎ方と、含められないものを決める。
// colorConversion は色の規格を変換できるか (ffmpeg に zscale フィルタがあるか)
export function planMerge(sources: MergeSource[], extension: string, options: { colorConversion: boolean }): MergePlan {
    const losses: MergeLoss[] = [];

    if (AUDIO_ONLY_EXTENSIONS.has(extension)) {
        const hasVideo = sources.some(source =>
            source.streams.some(stream => stream.kind === 'video' && !stream.attachedPic)
        );
        if (hasVideo) losses.push({ kind: 'video' });
    }

    // 字幕は、各ファイルの同じ順番の字幕を 1 本につなげる。テキストの字幕は形式が違っても 1 本にまとめ、
    // 画像の字幕はコーデックごとに 1 本にする (違うコーデックの画像はつなげられないため)
    const subtitles: SubtitleTrackPlan[] = [];
    const trackCount = Math.max(0, ...sources.map(source => subtitlesOf(source).length));
    for (let track = 0; track < trackCount; track++) {
        const members = sources.map(source => subtitlesOf(source)[track]);
        const texts = members.map(stream => (stream && TEXT_SUBTITLES.has(stream.codec) ? stream : undefined));
        const textCodecs = [...new Set(texts.filter(Boolean).map(stream => (stream as MediaStreamInfo).codec))];
        if (textCodecs.length > 0) {
            const style = textCodecs.every(codec => codec === 'subrip' || codec === 'srt') ? 'srt' : 'ass';
            const encoder = textSubtitleEncoder(extension, style);
            if (encoder) {
                subtitles.push({ kind: 'text', style, encoder, parts: texts.map(stream => (stream ? track : null)) });
                // ASS の書式は、ASS で出力できる形式 (mkv) でないと残らない
                if (encoder !== 'ass' && textCodecs.some(codec => ASS_SUBTITLES.has(codec))) {
                    losses.push({ kind: 'subtitleStyle', encoder });
                }
            } else {
                losses.push({ kind: 'subtitle', codec: textCodecs.join('/') });
            }
        }
        // 画像の字幕は、コーデックと初期化データ (VOBSUB のパレット・表示領域の大きさなど) が同じものごとに 1 本にする
        // (違うものをつなげると、1 つ目の初期化データで表示されて色・大きさが崩れるため)
        const bitmapKeys = [
            ...new Set(
                members
                    .filter(stream => stream && !TEXT_SUBTITLES.has(stream.codec))
                    .map(stream => bitmapKey(stream as MediaStreamInfo))
            ),
        ];
        for (const key of bitmapKeys) {
            const codec = key.split('|')[0];
            if (BITMAP_SUBTITLE_CONTAINERS[extension]?.includes(codec)) {
                subtitles.push({
                    kind: 'bitmap',
                    codec,
                    parts: members.map(stream => (stream && bitmapKey(stream) === key ? track : null)),
                });
            } else if (!losses.some(loss => loss.kind === 'subtitle' && loss.codec === codec)) {
                losses.push({ kind: 'subtitle', codec });
            }
        }
    }

    // カバーアートは、すべてのファイルのものを残す (mp4 系・mp3・flac は複数の画像を持てる。mkv は添付ファイルとして持つ)
    const covers = sources.flatMap((source, file) =>
        source.streams
            .filter(stream => stream.kind === 'video')
            .map((stream, videoIndex) => ({ stream, videoIndex }))
            .filter(({ stream }) => stream.attachedPic)
            .map(({ videoIndex }) => ({ file, videoIndex }))
    );
    const coverMethod = PICTURE_COVER_CONTAINERS.has(extension)
        ? 'picture'
        : extension === '.mkv'
          ? 'attachment'
          : null;
    if (covers.length > 0 && !coverMethod) losses.push({ kind: 'coverArt' });

    // タイムコードは 1 つ目のファイルのものを出力の始まりのタイムコードにする (mp4 系・mkv が持てる)。
    // 2 つ目以降のファイルのタイムコードは、出力では 1 つ目から続く値になるため含められない
    const timecodeOf = (source: MergeSource) =>
        source.formatTags.timecode ?? source.streams.find(stream => stream.timecode)?.timecode ?? null;
    const timecodeHolders = new Set(['.mp4', '.m4v', '.mov', '.mkv']);
    const firstTimecode = sources[0] ? timecodeOf(sources[0]) : null;
    const timecode = firstTimecode && timecodeHolders.has(extension) ? firstTimecode : null;
    const timecodeFiles = sources
        .map((source, file) => ((file > 0 || !timecode) && timecodeOf(source) ? file + 1 : 0))
        .filter(file => file > 0);
    if (timecodeFiles.length > 0) losses.push({ kind: 'timecode', files: timecodeFiles });

    const hasAttachments = sources.some(source => source.streams.some(stream => stream.codecType === 'attachment'));
    const attachments = hasAttachments && extension === '.mkv';
    if (hasAttachments && !attachments) losses.push({ kind: 'attachments' });

    // データのストリームは、ファイルごとの値をつなげて 1 本にできないため含められない。
    // mp4 のチャプター用トラックはチャプターとして、タイムコード用のトラックはタイムコードとして扱うため除く
    const dataCodecs = new Set<string>();
    for (const source of sources) {
        for (const stream of source.streams) {
            if (
                stream.codecType === 'data' &&
                !isChapterTrack(stream, source.chapterCount) &&
                (stream.codecTag ?? '').toLowerCase() !== 'tmcd'
            ) {
                dataCodecs.add(stream.codec || stream.codecTag || '?');
            }
        }
    }
    for (const codec of dataCodecs) losses.push({ kind: 'data', codec });

    // 出力の色の規格は、トラックごとに最も広いもの (HDR (PQ > HLG) > SDR、BT.2020 > それ以外) にそろえ、ほかのファイルは
    // 変換する (zscale)。変換できない場合 (zscale が無い) は、規格の違うファイルの色を含められないものとして知らせる。
    // 指定の無いものは SDR・通常の色域として扱う
    const colorFiles = new Set<number>();
    const videoTracks = Math.max(0, ...sources.map(source => mainVideosOf(source).length));
    if (!AUDIO_ONLY_EXTENSIONS.has(extension) && !options.colorConversion) {
        for (let track = 0; track < videoTracks; track++) {
            const members = sources.map(source => mainVideosOf(source)[track]);
            const present = members.filter((stream): stream is MediaStreamInfo => stream !== undefined);
            if (present.length === 0) continue;
            const reference = colorReference(present);
            members.forEach((stream, file) => {
                if (stream && colorCategory(stream) !== colorCategory(reference)) colorFiles.add(file + 1);
            });
        }
    }
    if (colorFiles.size > 0) losses.push({ kind: 'colorMismatch', files: [...colorFiles].sort((a, b) => a - b) });

    // 全体のメタ情報は 1 つ目のファイルのものを使うため、違うファイルを知らせる
    // (1 つ目に無い項目や、1 つ目と違う値を持つファイルだけ。項目を持たないファイルから失われるものは無い)
    const firstTags = sources[0]?.formatTags ?? {};
    const metadataFiles = sources
        .map((source, file) =>
            file > 0 &&
            Object.entries(source.formatTags).some(
                ([key, value]) => !IGNORED_FORMAT_TAGS.has(key.toLowerCase()) && firstTags[key] !== value
            )
                ? file + 1
                : 0
        )
        .filter(file => file > 0);
    if (metadataFiles.length > 0) losses.push({ kind: 'metadata', files: metadataFiles });

    // トラックの言語・名前は、トラックごとにそのトラックを持つ最初のファイルのものを使うため、違うファイルを知らせる
    const nameFiles = new Set<number>();
    const groups: Array<(source: MergeSource) => MediaStreamInfo[]> = [
        mainVideosOf,
        source => source.streams.filter(stream => stream.kind === 'audio'),
        subtitlesOf,
    ];
    for (const group of groups) {
        const count = Math.max(0, ...sources.map(source => group(source).length));
        for (let track = 0; track < count; track++) {
            const members = sources.map(source => group(source)[track]);
            const reference = members.find(Boolean);
            members.forEach((stream, file) => {
                if (!stream || !reference) return;
                // 'und' (言語の指定なし) は指定が無いのと同じに扱う
                // 言語・名前を持たないものから失われるものは無いため、持っていて違うものだけを数える
                const language = (item: MediaStreamInfo) => (item.language === 'und' ? '' : (item.language ?? ''));
                const lostLanguage = language(stream) !== '' && language(stream) !== language(reference);
                const lostTitle = (stream.title ?? '') !== '' && stream.title !== reference.title;
                if (lostLanguage || lostTitle) {
                    nameFiles.add(file + 1);
                }
            });
        }
    }
    if (nameFiles.size > 0) losses.push({ kind: 'trackNames', files: [...nameFiles].sort((a, b) => a - b) });

    return { subtitles, covers, coverMethod, timecode, attachments, losses };
}

// 表示される大きさ (画素の縦横比と回転を反映したもの) の面積
function displayArea(stream: MediaStreamInfo): number {
    const [num, den] = (stream.sampleAspectRatio ?? '').split(':').map(Number);
    const aspect = num > 0 && den > 0 ? num / den : 1;
    return (stream.width ?? 0) * aspect * (stream.height ?? 0);
}

// 色の規格の広さ (PQ > HLG > SDR、同じなら BT.2020 > それ以外)
export function colorRank(stream: Pick<MediaStreamInfo, 'colorTransfer' | 'colorPrimaries'>): number {
    const transfer = stream.colorTransfer === 'smpte2084' ? 3 : stream.colorTransfer === 'arib-std-b67' ? 2 : 1;
    return transfer * 2 + (stream.colorPrimaries === 'bt2020' ? 1 : 0);
}

// 出力の色の規格の基準にする映像 (色の規格が最も広く、同じなら表示される大きさが最大のもの)
export function colorReference<T extends MediaStreamInfo>(streams: T[]): T {
    return streams.reduce((best, stream) => {
        const rank = colorRank(stream) - colorRank(best);
        return rank > 0 || (rank === 0 && displayArea(stream) > displayArea(best)) ? stream : best;
    });
}

// 色の規格の区分 (伝達特性: PQ・HLG・SDR、色域: BT.2020 かそれ以外)
function colorCategory(stream: MediaStreamInfo): string {
    const transfer =
        stream.colorTransfer === 'smpte2084' ? 'pq' : stream.colorTransfer === 'arib-std-b67' ? 'hlg' : 'sdr';
    const primaries = stream.colorPrimaries === 'bt2020' ? 'wide' : 'standard';
    return `${transfer}/${primaries}`;
}

function mainVideosOf(source: MergeSource): MediaStreamInfo[] {
    return source.streams.filter(stream => stream.kind === 'video' && !stream.attachedPic);
}

// 画像の字幕をまとめる単位 (コーデック・初期化データ・表示領域の大きさ)
function bitmapKey(stream: MediaStreamInfo): string {
    return [stream.codec, stream.extradataHash ?? '', stream.width ?? '', stream.height ?? ''].join('|');
}
