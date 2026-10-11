import fs from 'fs';
import path from 'path';
import { probeJson } from '../ffmpeg/ffprobe';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { discardLater, newTempDir, produceFile } from '../work-dir';
import { dispositionFlags, isTechnicalStreamTag, streamTagArgs } from '../video-split-merge/stream-metadata';
import { probeStreams, type FfprobeStream } from './probe';
import { extensionOf, isTechnicalFormatTag, trackOutputPlan } from '../../../shared/video-track-tag';
import type { TrackTagChapter, TrackTagSaveCheck, TrackTagSaveRequest } from '../../../shared/types';

// 動画トラック・タグ管理: 編集した内容 (トラックの並び・言語・既定、ファイル全体のタグ、チャプター) で新しいファイルへ
// 書き出す。映像・音声・字幕は再エンコードせずに写す (出力形式に入らない文字の字幕だけ、文字の字幕の形式を変える)

const MP4_FAMILY = new Set(['.mp4', '.m4v', '.mov']);

// 同じファイルか (Windows はパスの大文字・小文字を区別しない)
export function sameFile(a: string, b: string): boolean {
    const resolve = (value: string) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return resolve(a) === resolve(b);
}

// FFMETADATA の値の書き方 (特別な文字と改行の前に \ を付ける)
function escapeMeta(value: string): string {
    return value.replace(/[\\=;#\n]/g, char => `\\${char}`);
}

// ファイル全体のタグとチャプターの FFMETADATA
function buildMetadata(tags: Array<{ key: string; value: string }>, chapters: TrackTagChapter[]): string {
    const lines = [';FFMETADATA1'];
    for (const { key, value } of tags) lines.push(`${escapeMeta(key)}=${escapeMeta(value)}`);
    for (const chapter of chapters) {
        lines.push('[CHAPTER]', 'TIMEBASE=1/1000');
        lines.push(`START=${Math.round(chapter.start * 1000)}`, `END=${Math.round(chapter.end * 1000)}`);
        lines.push(`title=${escapeMeta(chapter.title)}`);
        for (const [key, value] of Object.entries(chapter.tags)) lines.push(`${escapeMeta(key)}=${escapeMeta(value)}`);
    }
    return lines.join('\n') + '\n';
}

// 書き出すタグ (書き出すときに出力形式が書き直すものと、名前の無いものを除く)
function writableTags(request: TrackTagSaveRequest): Array<{ key: string; value: string }> {
    return request.formatTags.filter(tag => tag.key.trim() !== '' && !isTechnicalFormatTag(tag.key));
}

type Extras = {
    // そのまま写すもの (添付ファイル・mp4 系のカバーアート)
    mapped: FfprobeStream[];
    // 画像として取り出して添付ファイルとして付け直すカバーアート (mkv)
    attached: FfprobeStream[];
    dropped: Array<'attachment' | 'coverArt' | 'data'>;
    timecode: string | null;
};

// 元のファイルの、トラック以外に引き継ぐもの (添付ファイル・カバーアート・タイムコード) と、出力形式に入れられないもの。
// 添付ファイルは mkv だけが持てる。カバーアート (画像の映像ストリーム) は mp4 系はそのまま、mkv は添付ファイルとして持つ
// (mkv の画像の添付ファイルは ffmpeg では画像の映像ストリームとして読まれ、そのまま写すと映像のトラックになるため)。
// タイムコードは mp4 系へ -timecode で書き直す。チャプター用のトラック (mp4) はチャプターを書き直すため引き継がない
function extrasOf(streams: FfprobeStream[], chapterCount: number, extension: string): Extras {
    const extras: Extras = { mapped: [], attached: [], dropped: [], timecode: null };
    const dropped = new Set<'attachment' | 'coverArt' | 'data'>();
    for (const stream of streams) {
        if (stream.codec_type === 'attachment') {
            if (extension === '.mkv') extras.mapped.push(stream);
            else dropped.add('attachment');
        } else if (stream.codec_type === 'video' && stream.disposition?.attached_pic) {
            if (MP4_FAMILY.has(extension)) extras.mapped.push(stream);
            else if (extension === '.mkv') extras.attached.push(stream);
            else dropped.add('coverArt');
        } else if (stream.codec_type === 'data') {
            const tag = (stream.codec_tag_string ?? '').toLowerCase();
            if (tag === 'text' && Number(stream.nb_frames) === chapterCount) continue;
            if (tag === 'tmcd' && stream.tags?.timecode && MP4_FAMILY.has(extension)) {
                extras.timecode = stream.tags.timecode;
            } else {
                dropped.add('data');
            }
        }
    }
    extras.dropped = [...dropped];
    return extras;
}

type ContainerLosses = Pick<
    TrackTagSaveCheck,
    'lostTags' | 'lostTrackTags' | 'chaptersLost' | 'lostChapterTags' | 'lostFlags' | 'defaultForced' | 'probeFailed'
>;

// 出力形式に書けないもの (ファイル全体のタグ・トラックのタグ・チャプターとそのタグ・既定の指定)。その形式で小さなファイル
// (無音の音声 2 本) にタグ・チャプター・指定を実際に書き、読み直して残らなかったものを返す (形式ごとに書けるものが違い、
// ffmpeg は書けないものを黙って捨てるため)
async function containerLosses(
    request: TrackTagSaveRequest,
    trackTags: Record<string, string>,
    extension: string
): Promise<ContainerLosses> {
    const tags = writableTags(request);
    const chapterTagKeys = [...new Set(request.chapters.flatMap(chapter => Object.keys(chapter.tags)))];
    const kinds = new Set(request.tracks.map(track => track.kind));
    const withoutDefault = [...kinds].some(
        kind => !request.tracks.some(track => track.kind === kind && track.isDefault)
    );
    // 書き出すトラックに立てるフラグ (既定を除く)
    const flags = flagNames([...new Set(request.tracks.flatMap(track => track.flags))]);
    const audioCodec: Record<string, string> = {
        '.webm': 'libopus',
        '.ts': 'mp2',
        '.m2ts': 'mp2',
        '.mts': 'mp2',
        '.mkv': 'pcm_s16le',
        '.avi': 'pcm_s16le',
    };
    const dir = newTempDir();
    try {
        const metaPath = path.join(dir, 'tags.txt');
        const chapters =
            request.chapters.length > 0
                ? [
                      {
                          title: 'chapter',
                          start: 0,
                          end: 0.05,
                          tags: Object.fromEntries(chapterTagKeys.map(key => [key, 'x'])),
                      },
                  ]
                : [];
        fs.writeFileSync(metaPath, buildMetadata(tags, chapters), 'utf-8');
        const output = path.join(dir, `test${extension}`);
        const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];
        args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono');
        args.push('-f', 'ffmetadata', '-i', metaPath, '-t', '0.1', '-map', '0:a', '-map', '1:a');
        args.push('-map_metadata', '2', '-map_chapters', chapters.length > 0 ? '2' : '-1');
        args.push('-c:a', audioCodec[extension] ?? 'aac');
        for (const [key, value] of Object.entries(trackTags)) args.push('-metadata:s:0', `${key}=${value}`);
        args.push('-disposition:0', flags.length > 0 ? flags.join('+') : '0', '-disposition:1', '0', output);
        await runFfmpeg(args);
        const data = await probeJson<{
            format?: { tags?: Record<string, string> };
            streams?: Array<{ tags?: Record<string, string>; disposition?: Record<string, number> }>;
            chapters?: Array<{ tags?: Record<string, string> }>;
        }>(['-show_format', '-show_streams', '-show_chapters', output]);
        const missing = (keys: string[], written: Record<string, string> | undefined) => {
            const present = new Set(Object.keys(written ?? {}).map(key => key.toLowerCase()));
            return keys.filter(key => !present.has(key.toLowerCase()));
        };
        const chaptersLost = chapters.length > 0 && (data.chapters?.length ?? 0) === 0;
        return {
            lostTags: missing(
                tags.map(tag => tag.key),
                data.format?.tags
            ),
            // mp4 系はトラックの名前を handler_name として持つため、handler_name が残れば名前 (title) は書けたものとする
            lostTrackTags: missing(Object.keys(trackTags), data.streams?.[0]?.tags).filter(
                key => !(key.toLowerCase() === 'title' && data.streams?.[0]?.tags?.handler_name)
            ),
            chaptersLost,
            lostChapterTags: chaptersLost ? [] : missing(chapterTagKeys, data.chapters?.[0]?.tags),
            lostFlags: flags.filter(flag => data.streams?.[0]?.disposition?.[flag] !== 1),
            defaultForced: withoutDefault && (data.streams ?? []).some(stream => stream.disposition?.default === 1),
            probeFailed: false,
        };
    } catch {
        return {
            lostTags: [],
            lostTrackTags: [],
            chaptersLost: false,
            lostChapterTags: [],
            lostFlags: [],
            defaultForced: false,
            probeFailed: true,
        };
    } finally {
        discardLater(dir);
    }
}

// フラグのうち ffmpeg の -disposition で書けるもの (既定・カバーアートの印を除く)
function flagNames(flags: string[]): string[] {
    return dispositionFlags({ index: 0, disposition: Object.fromEntries(flags.map(flag => [flag, 1])) }).filter(
        flag => flag !== 'default'
    );
}

// 書き出すトラックのタグ: 元のトラックのタグに、選んだ言語と名前を入れる。名前は title に書き、mp4 系へは再生ソフトが
// 読む handler_name にも書く。名前が空なら title と handler_name を消す (mp4 系は ffmpeg が既定の handler_name を書く)
function trackTagsFor(
    sourceTags: Record<string, string>,
    track: TrackTagSaveRequest['tracks'][number],
    extension: string
): Record<string, string> {
    const replaced = new Set(['language', 'title', 'handler_name']);
    const tags = Object.fromEntries(Object.entries(sourceTags).filter(([key]) => !replaced.has(key.toLowerCase())));
    tags.language = track.language || 'und';
    if (track.title) {
        tags.title = track.title;
        if (MP4_FAMILY.has(extension)) tags.handler_name = track.title;
    }
    return tags;
}

// 書き出すトラックが持つタグ (統計などの項目を除いたすべての名前と、その値の 1 つ)
function trackTagsOf(
    request: TrackTagSaveRequest,
    streamsOf: Map<string, FfprobeStream[]>,
    extension: string
): Record<string, string> {
    const tags: Record<string, string> = {};
    for (const track of request.tracks) {
        const stream = streamsOf.get(track.source)?.find(item => item.index === track.streamIndex);
        for (const [key, value] of Object.entries(trackTagsFor(stream?.tags ?? {}, track, extension))) {
            if (isTechnicalStreamTag(key) || (key === 'language' && !track.language)) continue;
            tags[key] = value;
        }
    }
    return tags;
}

async function streamsOfSources(request: TrackTagSaveRequest, jobId?: string): Promise<Map<string, FfprobeStream[]>> {
    const streamsOf = new Map<string, FfprobeStream[]>();
    for (const source of new Set([request.input, ...request.tracks.map(track => track.source)])) {
        streamsOf.set(source, await probeStreams(source, jobId));
    }
    return streamsOf;
}

// 書き出す前に調べる: 出力形式へ入れられないトラック、形式を変える字幕、書けないもの、入れられないそのほかのもの
export async function checkSave(request: TrackTagSaveRequest): Promise<TrackTagSaveCheck> {
    if (sameFile(request.output, request.input)) throw new Error('OUTPUT_EQUALS_INPUT');
    const extension = path.extname(request.output).toLowerCase();
    const unsupported: TrackTagSaveCheck['unsupported'] = [];
    const converted: TrackTagSaveCheck['converted'] = [];
    request.tracks.forEach((track, i) => {
        const plan = trackOutputPlan(track.kind, track.codec, extension, extensionOf(track.source));
        if (plan.mode === 'unsupported') unsupported.push({ trackNumber: i + 1, kind: track.kind, codec: track.codec });
        if (plan.mode === 'convert') converted.push({ trackNumber: i + 1, codec: track.codec, to: plan.encoder });
    });
    const streamsOf = await streamsOfSources(request);
    const chapterCount =
        (await probeJson<{ chapters?: unknown[] }>(['-show_chapters', request.input])).chapters?.length ?? 0;
    return {
        unsupported,
        converted,
        ...(await containerLosses(request, trackTagsOf(request, streamsOf, extension), extension)),
        droppedExtras: extrasOf(streamsOf.get(request.input) ?? [], chapterCount, extension).dropped,
    };
}

// カバーアートを画像として取り出す (jpeg・png はそのまま、それ以外の形式は png に変換する)
async function extractCover(input: string, stream: FfprobeStream, target: string, jobId: string): Promise<void> {
    const copy = stream.codec_name === 'mjpeg' || stream.codec_name === 'png';
    await runFfmpeg(
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostats',
            '-y',
            '-i',
            input,
            '-map',
            `0:${stream.index}`,
            '-frames:v',
            '1',
            '-c:v',
            copy ? 'copy' : 'png',
            target,
        ],
        { jobId }
    );
}

// 編集した内容で書き出す
export async function saveEdited(
    jobId: string,
    request: TrackTagSaveRequest,
    onProgress: (percent: number) => void
): Promise<void> {
    const { input, output } = request;
    if (sameFile(output, input)) throw new Error('OUTPUT_EQUALS_INPUT');
    const extension = path.extname(output).toLowerCase();
    if (
        request.tracks.some(
            track =>
                trackOutputPlan(track.kind, track.codec, extension, extensionOf(track.source)).mode === 'unsupported'
        )
    ) {
        throw new Error('UNSUPPORTED_TRACKS');
    }
    // 入力: 0 = 元の動画、続いてトラックを追加したファイル、最後に FFMETADATA
    const sources = [input, ...new Set(request.tracks.map(track => track.source).filter(source => source !== input))];
    const streamsOf = await streamsOfSources(request, jobId);
    const media = await probeJson<{ format?: { duration?: string }; chapters?: unknown[] }>(
        ['-show_format', '-show_chapters', input],
        { jobId }
    );
    const duration = Number.parseFloat(media.format?.duration ?? '');
    const extras = extrasOf(streamsOf.get(input) ?? [], media.chapters?.length ?? 0, extension);

    const dir = newTempDir();
    try {
        const metaPath = path.join(dir, 'metadata.txt');
        fs.writeFileSync(metaPath, buildMetadata(writableTags(request), request.chapters), 'utf-8');
        const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];
        for (const source of sources) args.push('-i', source);
        args.push('-f', 'ffmetadata', '-i', metaPath);
        const metaIndex = sources.length;

        // 出力のストリームごとの引数 (写し方の指定は -c copy の後に置く)
        const perStream: string[] = [];
        let out = 0;
        for (const track of request.tracks) {
            const inputIndex = sources.indexOf(track.source);
            const stream = streamsOf.get(track.source)?.find(item => item.index === track.streamIndex);
            if (!stream) throw new Error('TRACK_NOT_FOUND');
            args.push('-map', `${inputIndex}:${track.streamIndex}`);
            const plan = trackOutputPlan(track.kind, track.codec, extension, extensionOf(track.source));
            if (plan.mode === 'convert') perStream.push(`-c:${out}`, plan.encoder);
            // mp4 系の HEVC は、Apple の再生ソフトでも再生できるよう hvc1 として書く (ffmpeg の既定は hev1)
            if (track.codec === 'hevc' && MP4_FAMILY.has(extension)) perStream.push(`-tag:${out}`, 'hvc1');
            // タグは元のトラックから引き継ぎ (自動で写す分は止める)、言語と名前を選んだものにする
            const tags = trackTagsFor(stream.tags ?? {}, track, extension);
            perStream.push(`-map_metadata:s:${out}`, '-1');
            perStream.push(...streamTagArgs(String(out), { index: stream.index, tags }, extension));
            // 指定は選んだフラグと既定にする
            const flags = flagNames(track.flags);
            if (track.isDefault) flags.unshift('default');
            perStream.push(`-disposition:${out}`, flags.length > 0 ? flags.join('+') : '0');
            out += 1;
        }
        for (const stream of extras.mapped) {
            args.push('-map', `0:${stream.index}`);
            perStream.push(`-map_metadata:s:${out}`, '-1');
            perStream.push(...streamTagArgs(String(out), { index: stream.index, tags: stream.tags }, extension));
            if (stream.codec_type !== 'attachment') {
                const flags = dispositionFlags({ index: stream.index, disposition: stream.disposition });
                perStream.push(`-disposition:${out}`, [...flags, 'attached_pic'].join('+'));
            }
            out += 1;
        }
        // mkv のカバーアートは、元のファイル名と種類の添付ファイルとして付け直す (ほかの添付ファイルの後ろに並ぶ)
        const attachmentCount = extras.mapped.filter(stream => stream.codec_type === 'attachment').length;
        for (let j = 0; j < extras.attached.length; j++) {
            const stream = extras.attached[j];
            const png = stream.codec_name !== 'mjpeg';
            const imagePath = path.join(dir, `cover${j}.${png ? 'png' : 'jpg'}`);
            await extractCover(input, stream, imagePath, jobId);
            const spec = `t:${attachmentCount + j}`;
            perStream.push(
                '-attach',
                imagePath,
                `-metadata:s:${spec}`,
                `mimetype=${stream.tags?.mimetype ?? (png ? 'image/png' : 'image/jpeg')}`,
                `-metadata:s:${spec}`,
                `filename=${stream.tags?.filename ?? `cover${j > 0 ? ` (${j + 1})` : ''}.${png ? 'png' : 'jpg'}`}`
            );
        }
        args.push('-c', 'copy', ...perStream);
        if (extras.timecode) args.push('-timecode', extras.timecode);
        args.push(
            '-map_metadata',
            String(metaIndex),
            '-map_chapters',
            request.chapters.length > 0 ? String(metaIndex) : '-1'
        );
        await produceFile(output, target =>
            runFfmpeg([...args, target], {
                jobId,
                totalSec: Number.isFinite(duration) && duration > 0 ? duration : undefined,
                onProgress,
            })
        );
    } finally {
        discardLater(dir);
    }
}
