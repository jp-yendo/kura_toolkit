import type { FfStream } from './probe';

// --accurate 時のコーデック引き継ぎ (元: cut-chapter.py の *_stream_args 群)

// 元コーデックへ対応させるエンコーダの対応表
const VIDEO_ENCODERS: Record<string, string> = {
    h264: 'libx264',
    hevc: 'libx265',
    mpeg2video: 'mpeg2video',
    mpeg4: 'mpeg4',
    vp8: 'libvpx',
    vp9: 'libvpx-vp9',
    av1: 'libsvtav1',
    mjpeg: 'mjpeg',
};

const AUDIO_ENCODERS: Record<string, string> = {
    aac: 'aac',
    ac3: 'ac3',
    eac3: 'eac3',
    mp2: 'mp2',
    mp3: 'libmp3lame',
    opus: 'libopus',
    vorbis: 'libvorbis',
    flac: 'flac',
    alac: 'alac',
};

// ビットレート指定が無意味なロスレス音声
const LOSSLESS_AUDIO = new Set(['flac', 'alac']);

// テキスト字幕の再エンコード用エンコーダの対応表
// ストリームコピーでは切り出し開始前のサンプルが混入し、負のタイムスタンプ
// 回避のため全ストリームが後ろへずれてチャプターと合わなくなる。
// デコード経路を通すと開始前の部分が正しく切り落とされるため、
// テキスト字幕は常に同一コーデックで再エンコードする (内容は変わらない)
export const TEXT_SUBTITLE_ENCODERS: Record<string, string> = {
    mov_text: 'mov_text',
    subrip: 'srt',
    ass: 'ass',
    ssa: 'ass',
    webvtt: 'webvtt',
    text: 'text',
};

export type StreamArgsResult = {
    args: string[];
    plan: string[];
    hasBitmapSubs: boolean;
};

// ストリームのビットレートを返す (mkv では tags の BPS に入ることがある)
export function streamBitrate(stream: FfStream): number | null {
    const value = stream.bit_rate ?? stream.tags?.BPS ?? stream.tags?.['BPS-eng'];
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
}

// ビットレート不明時のエンコーダ別の品質指定
function videoQualityArgs(encoder: string, spec: string): string[] {
    if (encoder === 'libx264') return [`-crf:${spec}`, '18'];
    if (encoder === 'libx265') return [`-crf:${spec}`, '20'];
    if (encoder === 'libvpx' || encoder === 'libvpx-vp9') return [`-crf:${spec}`, '31', `-b:${spec}`, '0'];
    if (encoder === 'libsvtav1') return [`-crf:${spec}`, '30'];
    // mpeg2video / mpeg4 / mjpeg は固定品質係数を使う
    return [`-q:${spec}`, '2'];
}

// 字幕ストリームの引数を構築する (両モード共通)。
// テキスト字幕は同一コーデックで再エンコードし、
// エンコーダのないビットマップ字幕 (PGS 等) はコピーする。
function subtitleStreamArgs(streams: FfStream[]): StreamArgsResult {
    const args: string[] = [];
    const plan: string[] = [];
    let hasBitmapSubs = false;
    let subIndex = 0;
    for (const stream of streams) {
        if (stream.codec_type !== 'subtitle') continue;
        const spec = `s:${subIndex}`;
        subIndex += 1;
        const name = stream.codec_name ?? '';
        const encoder = TEXT_SUBTITLE_ENCODERS[name];
        if (encoder) {
            args.push(`-c:${spec}`, encoder);
            plan.push(`  ${spec}  ${name} -> ${encoder}`);
        } else {
            hasBitmapSubs = true;
            args.push(`-c:${spec}`, 'copy');
            plan.push(`  ${spec}  ${name} -> copy (bitmap subtitle)`);
        }
    }
    return { args, plan, hasBitmapSubs };
}

// ストリームコピー (標準モード) の引数を構築する
export function copyStreamArgs(streams: FfStream[]): StreamArgsResult {
    const subs = subtitleStreamArgs(streams);
    return { args: ['-c', 'copy', ...subs.args], plan: subs.plan, hasBitmapSubs: subs.hasBitmapSubs };
}

// 再エンコード (--accurate) の引数を構築する。
// 各ストリームを元と同じコーデックで再エンコードし、ビットレート等も判明する範囲で引き継ぐ。
export function accurateStreamArgs(streams: FfStream[]): StreamArgsResult {
    const args: string[] = [];
    const plan: string[] = [];
    let videoIndex = 0;
    let audioIndex = 0;
    for (const stream of streams) {
        const ctype = stream.codec_type;
        const name = stream.codec_name ?? '';
        if (ctype === 'video') {
            const spec = `v:${videoIndex}`;
            videoIndex += 1;
            if (stream.disposition?.attached_pic) {
                args.push(`-c:${spec}`, 'copy');
                plan.push(`  ${spec}  ${name} -> copy (attached picture)`);
                continue;
            }
            let encoder = VIDEO_ENCODERS[name];
            let note = '';
            if (!encoder) {
                encoder = 'libx264';
                note = ` (no matching encoder for ${name})`;
            }
            args.push(`-c:${spec}`, encoder);
            if (stream.pix_fmt) {
                args.push(`-pix_fmt:${spec}`, stream.pix_fmt);
            }
            const rate = streamBitrate(stream);
            let detail: string;
            if (rate) {
                // 元のビットレートを踏襲する。max_bit_rate も判明する場合は上限として引き継ぐ
                args.push(`-b:${spec}`, String(rate));
                detail = `${rate} b/s`;
                const maxrate = Number.parseInt(stream.max_bit_rate ?? '', 10);
                if (Number.isFinite(maxrate) && maxrate > 0) {
                    args.push(`-maxrate:${spec}`, String(maxrate), `-bufsize:${spec}`, String(maxrate * 2));
                    detail += `, maxrate ${maxrate} b/s`;
                }
            } else {
                const quality = videoQualityArgs(encoder, spec);
                args.push(...quality);
                detail = `bitrate unknown, ${quality.join(' ')}`;
            }
            plan.push(`  ${spec}  ${name} -> ${encoder}${note} (${detail})`);
        } else if (ctype === 'audio') {
            const spec = `a:${audioIndex}`;
            audioIndex += 1;
            const channels = stream.channels ?? 2;
            const lossless = LOSSLESS_AUDIO.has(name) || name.startsWith('pcm_');
            let encoder: string;
            let note = '';
            if (name.startsWith('pcm_')) {
                encoder = name;
            } else {
                const mapped = AUDIO_ENCODERS[name];
                if (mapped) {
                    encoder = mapped;
                } else {
                    encoder = 'aac';
                    note = ` (no matching encoder for ${name})`;
                }
            }
            args.push(`-c:${spec}`, encoder);
            let detail = `${channels}ch`;
            if (!lossless) {
                // ビットレートは元の値、不明時はチャンネル数から概算する
                let rate = streamBitrate(stream);
                if (rate === null) {
                    rate = 64000 * channels;
                    detail += `, bitrate unknown -> ${rate} b/s`;
                } else {
                    detail += `, ${rate} b/s`;
                }
                args.push(`-b:${spec}`, String(rate));
            }
            plan.push(`  ${spec}  ${name} -> ${encoder}${note} (${detail})`);
        }
    }
    const subs = subtitleStreamArgs(streams);
    return {
        args: [...args, ...subs.args],
        plan: [...plan, ...subs.plan],
        hasBitmapSubs: subs.hasBitmapSubs,
    };
}
