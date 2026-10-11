// 再エンコードで使うエンコーダの決定 (main / renderer で共用)。
// Node / DOM に依存させない。

import type { MediaStreamInfo } from './types';
import type { MergeLoss, PixelLoss } from './video-merge';

// 元のコーデックに対応させるエンコーダ
export const VIDEO_ENCODERS: Record<string, string> = {
    h264: 'libx264',
    hevc: 'libx265',
    mpeg2video: 'mpeg2video',
    mpeg4: 'mpeg4',
    vp8: 'libvpx',
    vp9: 'libvpx-vp9',
    av1: 'libsvtav1',
    mjpeg: 'mjpeg',
    prores: 'prores_ks',
    dnxhd: 'dnxhd',
    ffv1: 'ffv1',
    huffyuv: 'huffyuv',
    utvideo: 'utvideo',
};

export const AUDIO_ENCODERS: Record<string, string> = {
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

// 結合の再エンコードで選べる映像のエンコーダと、書ける画素形式 (ffmpeg のエンコーダが受け付ける YUV の形式)
export const VIDEO_CODEC_CHOICES = [
    {
        encoder: 'libx264',
        label: 'H.264',
        pixelFormats: ['yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le', 'yuv422p10le', 'yuv444p10le'],
    },
    {
        encoder: 'libx265',
        label: 'H.265 (HEVC)',
        pixelFormats: [
            'yuv420p',
            'yuv422p',
            'yuv444p',
            'yuv420p10le',
            'yuv422p10le',
            'yuv444p10le',
            'yuv420p12le',
            'yuv422p12le',
            'yuv444p12le',
        ],
    },
    {
        encoder: 'libvpx-vp9',
        label: 'VP9',
        pixelFormats: [
            'yuv420p',
            'yuva420p',
            'yuv422p',
            'yuv444p',
            'yuv420p10le',
            'yuv422p10le',
            'yuv444p10le',
            'yuv420p12le',
            'yuv422p12le',
            'yuv444p12le',
        ],
    },
    { encoder: 'libsvtav1', label: 'AV1', pixelFormats: ['yuv420p', 'yuv420p10le'] },
    { encoder: 'libvpx', label: 'VP8', pixelFormats: ['yuv420p', 'yuva420p'] },
    { encoder: 'mpeg4', label: 'MPEG-4 Part 2', pixelFormats: ['yuv420p'] },
    { encoder: 'mpeg2video', label: 'MPEG-2', pixelFormats: ['yuv420p', 'yuv422p'] },
] as const;

// 結合の再エンコードで選べる音声のエンコーダ。maxChannels・maxSampleRate はそのエンコーダで書ける最大のチャンネル数と
// サンプリング周波数。maxBits は可逆のエンコーダで書ける最大のビット深度 (非可逆のものは持たない)
export const AUDIO_CODEC_CHOICES: ReadonlyArray<{
    encoder: string;
    label: string;
    maxChannels: number;
    maxSampleRate: number;
    maxBits?: number;
}> = [
    { encoder: 'aac', label: 'AAC', maxChannels: 8, maxSampleRate: 96000 },
    { encoder: 'libopus', label: 'Opus', maxChannels: 8, maxSampleRate: 48000 },
    { encoder: 'libmp3lame', label: 'MP3', maxChannels: 2, maxSampleRate: 48000 },
    { encoder: 'ac3', label: 'AC-3', maxChannels: 6, maxSampleRate: 48000 },
    { encoder: 'eac3', label: 'E-AC-3', maxChannels: 6, maxSampleRate: 48000 },
    { encoder: 'libvorbis', label: 'Vorbis', maxChannels: 8, maxSampleRate: 192000 },
    { encoder: 'flac', label: 'FLAC', maxChannels: 8, maxSampleRate: 655350, maxBits: 24 },
    { encoder: 'alac', label: 'ALAC', maxChannels: 8, maxSampleRate: 384000, maxBits: 24 },
    { encoder: 'mp2', label: 'MP2', maxChannels: 2, maxSampleRate: 48000 },
    { encoder: 'pcm_s16le', label: 'PCM 16bit', maxChannels: 8, maxSampleRate: 384000, maxBits: 16 },
    { encoder: 'pcm_s24le', label: 'PCM 24bit', maxChannels: 8, maxSampleRate: 384000, maxBits: 24 },
];

// 可逆の音声のコーデック (ビット深度に意味があるもの)
const LOSSLESS_AUDIO_CODECS = new Set(['flac', 'alac', 'truehd', 'mlp', 'wavpack', 'tta', 'ape']);

// 音声のトラックで保つべきビット深度 (可逆のものの最大。非可逆だけなら 16)
export function requiredAudioBits(streams: MediaStreamInfo[]): number {
    const bits = streams
        .filter(stream => LOSSLESS_AUDIO_CODECS.has(stream.codec) || stream.codec.startsWith('pcm_'))
        .map(stream => stream.bitsPerSample ?? 16);
    return Math.max(16, ...bits);
}

// 画素形式の性質 (色差の細かさ・ビット深度・透過)
type PixelSpec = { chroma: number; depth: number; alpha: boolean };

function pixelSpec(pixelFormat: string | null | undefined): PixelSpec {
    const name = pixelFormat ?? 'yuv420p';
    const rgb = /^(gbr|rgb|bgr|argb|abgr|rgba|bgra)/.test(name);
    const chroma = rgb || name.includes('444') ? 444 : name.includes('422') || name.includes('440') ? 422 : 420;
    const alpha = name.startsWith('yuva') || /^(argb|abgr|rgba|bgra|gbrap|ya)/.test(name);
    return { chroma, depth: bitDepth(name), alpha };
}

// 映像のトラックで保つべき性質 (各ファイルの最大)
export function requiredPixel(streams: MediaStreamInfo[]): PixelSpec {
    const specs = streams.map(stream => pixelSpec(stream.pixelFormat));
    return {
        chroma: Math.max(420, ...specs.map(spec => spec.chroma)),
        depth: Math.max(8, ...specs.map(spec => spec.depth)),
        alpha: specs.some(spec => spec.alpha),
    };
}

const PIXEL_LOSS_WEIGHTS: Record<PixelLoss, number> = { bitDepth: 4, chroma: 2, alpha: 1 };

function lostWeight(lost: PixelLoss[]): number {
    return lost.reduce((sum, item) => sum + PIXEL_LOSS_WEIGHTS[item], 0);
}

// エンコーダで書く画素形式。保つべき性質をすべて満たす中で最も小さいものを選び、満たせない場合は満たせるものが
// 最も多いもの (同じならビット深度・色差の細かさを優先) を選んで、失われるものを返す
export function choosePixelFormat(
    required: PixelSpec,
    encoder: string,
    extension: string
): { pixelFormat: string; lost: PixelLoss[] } {
    const choice = VIDEO_CODEC_CHOICES.find(item => item.encoder === encoder);
    // VP8・VP9 の透過は webm・mkv にしか格納できない
    const candidates = (choice?.pixelFormats ?? ['yuv420p']).filter(
        pixelFormat => !pixelFormat.startsWith('yuva') || ALPHA_CONTAINERS.has(extension)
    );
    const lostOf = (spec: PixelSpec): PixelLoss[] => {
        const lost: PixelLoss[] = [];
        if (required.alpha && !spec.alpha) lost.push('alpha');
        if (spec.chroma < required.chroma) lost.push('chroma');
        if (spec.depth < required.depth) lost.push('bitDepth');
        return lost;
    };
    const ranked = candidates
        .map(pixelFormat => ({ pixelFormat, spec: pixelSpec(pixelFormat) }))
        .map(item => ({ ...item, lost: lostOf(item.spec) }))
        // 失うものが少ないもの (ビット深度・色差・透過の順に重く数える) を選び、同じなら余分の少ないもの
        // (透過なし・色差の粗いもの・ビット深度の低いもの) を選ぶ
        .sort(
            (a, b) =>
                lostWeight(a.lost) - lostWeight(b.lost) ||
                Number(a.spec.alpha) - Number(b.spec.alpha) ||
                a.spec.chroma - b.spec.chroma ||
                a.spec.depth - b.spec.depth
        );
    return { pixelFormat: ranked[0].pixelFormat, lost: ranked[0].lost };
}

// 出力形式ごとに格納できるエンコーダ (表に無い形式 (mkv) は制限しない)
const MP4_VIDEO = ['libx264', 'libx265', 'libvpx-vp9', 'libsvtav1', 'mpeg4', 'mpeg2video'];
const VIDEO_CONTAINERS: Record<string, string[]> = {
    '.mp4': MP4_VIDEO,
    '.m4v': MP4_VIDEO,
    '.mov': MP4_VIDEO,
    '.webm': ['libvpx', 'libvpx-vp9', 'libsvtav1'],
    '.ts': ['libx264', 'libx265', 'mpeg2video'],
    '.avi': ['libx264', 'mpeg4'],
};

const MP4_AUDIO = ['aac', 'ac3', 'eac3', 'libmp3lame', 'alac', 'flac', 'libopus', 'mp2'];
const AUDIO_CONTAINERS: Record<string, string[]> = {
    '.mp4': MP4_AUDIO,
    '.m4v': MP4_AUDIO,
    '.mov': [...MP4_AUDIO, 'pcm_s16le', 'pcm_s24le'],
    '.webm': ['libopus', 'libvorbis'],
    '.ts': ['aac', 'ac3', 'eac3', 'mp2', 'libmp3lame', 'libopus'],
    '.avi': ['libmp3lame', 'ac3', 'mp2', 'pcm_s16le', 'pcm_s24le'],
    '.m4a': ['aac', 'alac'],
    '.aac': ['aac'],
    '.mp3': ['libmp3lame'],
    '.flac': ['flac'],
    '.ogg': ['libvorbis', 'libopus', 'flac'],
    '.opus': ['libopus'],
    '.wav': ['pcm_s16le', 'pcm_s24le'],
};

// 透過のある映像 (VP8・VP9) を格納できる出力形式
const ALPHA_CONTAINERS = new Set(['.webm', '.mkv']);

// HDR (PQ) のマスタリングの情報 (表示装置の色域・明るさと、コンテンツの明るさ) を書けるエンコーダ
export const HDR_METADATA_ENCODERS = new Set(['libx265', 'libx264', 'libsvtav1']);

// 映像を持てない (音声だけの) 出力形式
export const AUDIO_ONLY_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav']);

// 画素形式のビット深度 (yuv420p10le -> 10。数字が無いものは 8)
export function bitDepth(pixelFormat: string | null | undefined): number {
    const match = /p(\d{2})(le|be)?$/.exec(pixelFormat ?? '');
    return match ? Number(match[1]) : 8;
}

// 元のコーデックに対応するエンコーダ (mjpeg は色の範囲の指定が違い、そろえた映像をそのまま渡せないため H.264 にする)
function videoEncoderFor(codec: string): string {
    return codec === 'mjpeg' ? 'libx264' : (VIDEO_ENCODERS[codec] ?? 'libx264');
}
function audioEncoderFor(codec: string): string {
    return codec.startsWith('pcm_') ? codec : (AUDIO_ENCODERS[codec] ?? 'aac');
}

// 再エンコードのエンコーダの決め方。options は選べるもの (出力形式に入り、元の最大のチャンネル数・サンプリング周波数・
// ビット深度を書けて、使っている ffmpeg にあるもの)。uniform は、元のコーデックがそろっていて、それに対応するエンコーダを
// そのまま使えるか (使えない場合は選んでもらう)。auto は選ばない場合に使うもの (無ければ null)
export type CodecPlan = {
    options: string[];
    uniform: boolean;
    auto: string | null;
};

export type CodecPlans = {
    // 映像・音声が無い (または出力しない) 場合は null
    video: CodecPlan | null;
    audio: CodecPlan | null;
};

type CodecSource = { streams: MediaStreamInfo[] };

function decide(
    codecs: string[],
    preferred: string,
    options: string[],
    encoderFor: (codec: string) => string
): CodecPlan {
    const encoders = [...new Set(codecs.map(encoderFor))];
    const uniform = new Set(codecs).size === 1 && options.includes(encoders[0]);
    const auto = uniform ? encoders[0] : options.includes(preferred) ? preferred : (options[0] ?? null);
    return { options, uniform, auto };
}

// available は使っている ffmpeg にあるエンコーダ (調べられない場合は null で、絞り込まない)
export function planCodecs(sources: CodecSource[], extension: string, available: string[] | null): CodecPlans {
    const has = (encoder: string) => available === null || available.includes(encoder);

    const videos = AUDIO_ONLY_EXTENSIONS.has(extension)
        ? []
        : sources.flatMap(source => source.streams.filter(stream => stream.kind === 'video' && !stream.attachedPic));
    let video: CodecPlan | null = null;
    if (videos.length > 0) {
        const required = requiredPixel(videos);
        const allowed = VIDEO_CONTAINERS[extension];
        const usable: string[] = VIDEO_CODEC_CHOICES.filter(
            choice => (!allowed || allowed.includes(choice.encoder)) && has(choice.encoder)
        ).map(choice => choice.encoder);
        // 透過・色差・ビット深度をすべて保てるものだけを選択肢にする (どれも保てない場合は、使えるものをすべて出し、
        // 失われるものは結合の前に知らせる)
        const lossless = usable.filter(encoder => choosePixelFormat(required, encoder, extension).lost.length === 0);
        const options = lossless.length > 0 ? lossless : usable;
        // そろっていない場合は、画素数が最大の映像のコーデックを初めに選ぶ
        const largest = videos.reduce((best, stream) =>
            (stream.width ?? 0) * (stream.height ?? 0) > (best.width ?? 0) * (best.height ?? 0) ? stream : best
        );
        video = decide(
            videos.map(stream => stream.codec),
            videoEncoderFor(largest.codec),
            options,
            videoEncoderFor
        );
    }

    const audios = sources.flatMap(source => source.streams.filter(stream => stream.kind === 'audio'));
    let audio: CodecPlan | null = null;
    if (audios.length > 0) {
        const channels = Math.max(...audios.map(stream => stream.channels ?? 2));
        const sampleRate = Math.max(...audios.map(stream => stream.sampleRate ?? 48000));
        const bits = requiredAudioBits(audios);
        const allowed = AUDIO_CONTAINERS[extension];
        const options: string[] = AUDIO_CODEC_CHOICES.filter(
            choice =>
                (!allowed || allowed.includes(choice.encoder)) &&
                choice.maxChannels >= channels &&
                choice.maxSampleRate >= sampleRate &&
                (choice.maxBits === undefined || choice.maxBits >= bits) &&
                has(choice.encoder)
        ).map(choice => choice.encoder);
        // 元が PCM の場合は、選べる PCM の中から同じものを使えるように候補に含める
        const pcm = [...new Set(audios.map(stream => stream.codec).filter(codec => codec.startsWith('pcm_')))];
        for (const codec of pcm) {
            const pcmAllowed = !allowed || allowed.includes('pcm_s16le');
            if (pcmAllowed && has(codec) && !options.includes(codec)) options.push(codec);
        }
        const widest = audios.reduce((best, stream) => ((stream.channels ?? 0) > (best.channels ?? 0) ? stream : best));
        audio = decide(
            audios.map(stream => stream.codec),
            audioEncoderFor(widest.codec),
            options,
            audioEncoderFor
        );
    }

    return { video, audio };
}

// 選んだ映像のエンコーダで書けないもの (透過・色差・ビット深度、HDR のマスタリングの情報)
export function encoderLosses(sources: CodecSource[], encoder: string, extension: string): MergeLoss[] {
    if (AUDIO_ONLY_EXTENSIONS.has(extension)) return [];
    const videos = sources.flatMap(source =>
        source.streams.filter(stream => stream.kind === 'video' && !stream.attachedPic)
    );
    if (videos.length === 0) return [];
    const losses: MergeLoss[] = [];
    const { lost } = choosePixelFormat(requiredPixel(videos), encoder, extension);
    if (lost.length > 0) losses.push({ kind: 'pixelFormat', lost });
    if (videos.some(stream => stream.colorTransfer === 'smpte2084') && !HDR_METADATA_ENCODERS.has(encoder)) {
        losses.push({ kind: 'hdrMetadata' });
    }
    return losses;
}

// エンコーダの表示名
export function codecLabel(encoder: string): string {
    const choice = [...VIDEO_CODEC_CHOICES, ...AUDIO_CODEC_CHOICES].find(item => item.encoder === encoder);
    return choice?.label ?? encoder;
}
