import { hasAlphaLayer, type FfStream } from './probe';
import { AUDIO_ENCODERS, VIDEO_ENCODERS } from '../../../shared/video-codecs';

// 再エンコード時のコーデック引き継ぎ

// ビットレート指定が無意味なロスレス音声
export const LOSSLESS_AUDIO = new Set(['flac', 'alac']);

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
export function videoQualityArgs(encoder: string, spec: string): string[] {
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

// 再エンコードで音声を書くエンコーダ。元と同じコーデックのエンコーダがあればそれを使い、無い場合 (DTS・TrueHD など) は
// 出力形式に入る可逆の形式 (FLAC、avi・wav は PCM) で書く (元の音を損なわないため)。可逆の形式も入らない形式 (ts など) は
// E-AC-3、webm は Opus で書く。converted は元と違う形式で書くか (実行前に知らせる)
export type AccurateAudio = { encoder: string; converted: boolean; sampleFormat: string | null };

const FLAC_CONTAINERS = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.m4a', '.ogg', '.flac']);
const PCM_CONTAINERS = new Set(['.avi', '.wav']);

export function accurateAudioEncoder(
    stream: FfStream,
    extension: string,
    available: Set<string> | null
): AccurateAudio {
    const name = stream.codec_name ?? '';
    const has = (encoder: string) => available === null || available.has(encoder);
    const same = name.startsWith('pcm_') ? name : AUDIO_ENCODERS[name];
    if (same && has(same)) return { encoder: same, converted: false, sampleFormat: null };
    // 16bit を超える音声と、浮動小数の音声 (非可逆の形式をデコードしたもの) は 24bit で書く
    const deep =
        Number.parseInt(stream.bits_per_raw_sample ?? '', 10) > 16 || !/^(s16|u8)/.test(stream.sample_fmt ?? 's16');
    if (FLAC_CONTAINERS.has(extension) && has('flac')) {
        return { encoder: 'flac', converted: true, sampleFormat: deep ? 's32' : 's16' };
    }
    if (PCM_CONTAINERS.has(extension)) {
        return { encoder: deep ? 'pcm_s24le' : 'pcm_s16le', converted: true, sampleFormat: null };
    }
    if (extension === '.webm') return { encoder: 'libopus', converted: true, sampleFormat: null };
    return { encoder: 'eac3', converted: true, sampleFormat: null };
}

// 再エンコード (フレーム精度) の引数を構築する。
// 映像は元と同じコーデックで再エンコードし、画素形式・ビットレート等も判明する範囲で引き継ぐ。
// 音声も、切り出しの始まりと終わりを映像と同じ位置にそろえるため再エンコードする (そのまま写すと音声のフレーム単位でしか
// 切れない)。書き方は accurateAudioEncoder で決めたもの (audio はストリームの順)
export function accurateStreamArgs(streams: FfStream[], audio: AccurateAudio[]): StreamArgsResult {
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
            // 元のフレームの時刻をそのまま保つ (既定ではエンコーダの時刻の単位が 1 / フレームレートになり、切る位置が
            // フレームの途中にあると、映像の時刻がフレームの格子へ丸められて音声とずれる)
            args.push(`-c:${spec}`, encoder, `-fps_mode:${spec}`, 'passthrough', `-enc_time_base:${spec}`, 'demux');
            // VP8・VP9 の透過の層は ffprobe の画素形式に現れないため、透過付きの形式を指定する
            const pixelFormat = hasAlphaLayer(stream) && stream.pix_fmt === 'yuv420p' ? 'yuva420p' : stream.pix_fmt;
            if (pixelFormat) {
                args.push(`-pix_fmt:${spec}`, pixelFormat);
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
            const { encoder, converted, sampleFormat } = audio[audioIndex];
            audioIndex += 1;
            args.push(`-c:${spec}`, encoder);
            if (sampleFormat) args.push(`-sample_fmt:${spec}`, sampleFormat);
            const channels = stream.channels ?? 2;
            const lossless = LOSSLESS_AUDIO.has(encoder) || encoder.startsWith('pcm_');
            let detail = `${channels}ch`;
            if (!lossless) {
                // ビットレートは元の値、不明時はチャンネル数から概算する (形式を変える E-AC-3 は最も高い値で書く)
                let rate = encoder === 'eac3' && converted ? 1536000 : streamBitrate(stream);
                if (rate === null) {
                    rate = 64000 * channels;
                    detail += `, bitrate unknown -> ${rate} b/s`;
                } else {
                    detail += `, ${rate} b/s`;
                }
                args.push(`-b:${spec}`, String(rate));
            }
            plan.push(
                `  ${spec}  ${name} -> ${encoder}${converted ? ' (no encoder for the same format)' : ''} (${detail})`
            );
        }
    }
    const subs = subtitleStreamArgs(streams);
    return {
        args: [...args, ...subs.args],
        plan: [...plan, ...subs.plan],
        hasBitmapSubs: subs.hasBitmapSubs,
    };
}
