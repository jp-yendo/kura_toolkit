// 音声の書き出しの形式と、形式ごとの設定 (オーディオ正規化と音声機能の書き出しで共用する)。
// AUDIO_ENCODE_DEFAULTS はこのアプリの初期値。画面の選択肢で「(既定)」と示すのは、エンコーダーの既定値をそのまま初期値にした
// FLAC の圧縮レベル (5) だけ (ほかはアプリが決めた値で、エンコーダーの既定値ではないため示さない)。非可逆の形式は、
// 品質とファイルの大きさのつり合いで決めた MP3 の 160 kbps にそろえる (Vorbis の品質 5 は 44.1kHz ステレオで 160 kbps 相当)。
// ロスレスの形式 (FLAC・ALAC・WAV) は 24bit

export type AudioFormat = 'mp3' | 'flac' | 'vorbis' | 'opus' | 'aac' | 'wav' | 'alac';

export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'flac', 'vorbis', 'opus', 'aac', 'wav', 'alac'];

// 画面に示す名前 (形式の名前のため訳さない)
export const AUDIO_FORMAT_LABELS: Record<AudioFormat, string> = {
    mp3: 'MP3',
    flac: 'FLAC',
    vorbis: 'Ogg Vorbis',
    opus: 'Opus',
    aac: 'AAC (M4A)',
    wav: 'WAV',
    alac: 'ALAC (M4A)',
};

// 拡張子
export const AUDIO_FORMAT_EXTENSIONS: Record<AudioFormat, string> = {
    mp3: 'mp3',
    flac: 'flac',
    vorbis: 'ogg',
    opus: 'opus',
    aac: 'm4a',
    wav: 'wav',
    alac: 'm4a',
};

// 書き出しに要る ffmpeg のエンコーダー (使っている ffmpeg に無い形式は選ばせない)。WAV はビット数ごとに PCM の
// エンコーダーを使う (どれも ffmpeg に必ずある)
export const AUDIO_FORMAT_ENCODERS: Record<AudioFormat, string> = {
    mp3: 'libmp3lame',
    flac: 'flac',
    vorbis: 'libvorbis',
    opus: 'libopus',
    aac: 'aac',
    wav: 'pcm_s16le',
    alac: 'alac',
};

export type BitrateMode = 'cbr' | 'vbr';
// ロスレス (FLAC・ALAC) のビット数
export type LosslessBits = 16 | 24;
// WAV のサンプルの形式 (16bit・24bit の整数、32bit 浮動小数)
export type WavSampleFormat = 's16' | 's24' | 'f32';

// 形式ごとの設定 (選んでいない形式の設定も覚えておく)
export type AudioEncodeSettings = {
    // サンプリング周波数 (Opus は 48000 Hz に固定のため使わない)
    sampleRate: number;
    // MP3: ビットレートモードとビットレート (CBR は固定の値、VBR は目安。kbps)
    bitrateMode: BitrateMode;
    bitrate: number;
    // FLAC: 圧縮レベルとビット数
    flacCompression: number;
    flacBits: LosslessBits;
    // Ogg Vorbis: 品質 (0-10)
    vorbisQuality: number;
    // Opus: ビットレート (kbps。可変ビットレートの目安)
    opusBitrate: number;
    // AAC: ビットレート (kbps)
    aacBitrate: number;
    // WAV: サンプルの形式
    wavFormat: WavSampleFormat;
    // ALAC: ビット数
    alacBits: LosslessBits;
};

export const SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
export const MP3_BITRATES = [320, 256, 224, 192, 160, 144, 128, 112, 96, 80, 64, 56, 48, 40, 32, 24, 16, 8];
// FLAC の圧縮レベル (ffmpeg の compression_level)。11・12 は予測の次数が FLAC の subset (どの再生機器でも再生できる範囲。
// 48kHz 以下では次数 12 まで) を超えるため選ばせない。どのレベルでも音は変わらない (ロスレス)
export const FLAC_COMPRESSION_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const LOSSLESS_BITS: LosslessBits[] = [16, 24];
export const VORBIS_QUALITIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Opus のビットレート (libopus の範囲 6-510 kbps から)
export const OPUS_BITRATES = [510, 448, 384, 320, 256, 192, 160, 128, 112, 96, 80, 64, 48, 32, 24, 16, 12, 8, 6];
export const AAC_BITRATES = [320, 256, 224, 192, 160, 128, 112, 96, 80, 64, 48, 32];
export const WAV_SAMPLE_FORMATS: WavSampleFormat[] = ['s16', 's24', 'f32'];

export const AUDIO_ENCODE_DEFAULTS: AudioEncodeSettings = {
    sampleRate: 44100,
    bitrateMode: 'cbr',
    bitrate: 160,
    flacCompression: 5,
    flacBits: 24,
    vorbisQuality: 5,
    opusBitrate: 160,
    aacBitrate: 160,
    wavFormat: 's24',
    alacBits: 24,
};

export function isAudioFormat(value: unknown): value is AudioFormat {
    return typeof value === 'string' && (AUDIO_FORMATS as string[]).includes(value);
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

// 画面から受け取った設定を確かめる (main で使う。値は ffmpeg の引数にも入るため、選択肢に無い値は初期値にする)
export function sanitizeAudioEncodeSettings(value: unknown): AudioEncodeSettings {
    const item = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const d = AUDIO_ENCODE_DEFAULTS;
    return {
        sampleRate: pick(item.sampleRate, SAMPLE_RATES, d.sampleRate),
        bitrateMode: pick<BitrateMode>(item.bitrateMode, ['cbr', 'vbr'], d.bitrateMode),
        bitrate: pick(item.bitrate, MP3_BITRATES, d.bitrate),
        flacCompression: pick(item.flacCompression, FLAC_COMPRESSION_LEVELS, d.flacCompression),
        flacBits: pick(item.flacBits, LOSSLESS_BITS, d.flacBits),
        vorbisQuality: pick(item.vorbisQuality, VORBIS_QUALITIES, d.vorbisQuality),
        opusBitrate: pick(item.opusBitrate, OPUS_BITRATES, d.opusBitrate),
        aacBitrate: pick(item.aacBitrate, AAC_BITRATES, d.aacBitrate),
        wavFormat: pick(item.wavFormat, WAV_SAMPLE_FORMATS, d.wavFormat),
        alacBits: pick(item.alacBits, LOSSLESS_BITS, d.alacBits),
    };
}

// LAME の VBR の品質 (-q:a) を、ビットレートの目安から決める (各 V 設定の実効ビットレートに基づく)
function mp3VbrQuality(bitrate: number): string {
    if (bitrate >= 245) return '0';
    if (bitrate >= 225) return '1';
    if (bitrate >= 190) return '2';
    if (bitrate >= 175) return '3';
    if (bitrate >= 165) return '4';
    if (bitrate >= 130) return '5';
    if (bitrate >= 115) return '6';
    if (bitrate >= 100) return '7';
    if (bitrate >= 85) return '8';
    return '9';
}

// ロスレスのビット数の指定 (24bit は 32bit の入れ物に 24bit の値として書く)
function losslessBitsArgs(bits: LosslessBits, planar: boolean): string[] {
    const suffix = planar ? 'p' : '';
    return bits === 16
        ? ['-sample_fmt', `s16${suffix}`]
        : ['-sample_fmt', `s32${suffix}`, '-bits_per_raw_sample', '24'];
}

const WAV_ENCODERS: Record<WavSampleFormat, string> = { s16: 'pcm_s16le', s24: 'pcm_s24le', f32: 'pcm_f32le' };

// 出力の形式 (ffmpeg の -f。拡張子に頼らず、形式どおりの中身にするため)
export const AUDIO_FORMAT_MUXERS: Record<AudioFormat, string> = {
    mp3: 'mp3',
    flac: 'flac',
    vorbis: 'ogg',
    opus: 'opus',
    aac: 'ipod',
    wav: 'wav',
    alac: 'ipod',
};

// Opus のビットレートの上限 (1 チャンネルあたり。libopus がこれより大きい値を受け付けないため)
const OPUS_MAX_KBPS_PER_CHANNEL = 256;

// 書き出しの ffmpeg の引数 (サンプリング周波数とエンコーダーとその指定)。設定は確かめた (sanitize した) ものを渡す。
// channels は出力のチャンネル数 (Opus のビットレートを上限に収めるのに使う。分からなければ 1 として扱う)
export function audioEncodeArgs(format: AudioFormat, settings: AudioEncodeSettings, channels?: number): string[] {
    const rate = ['-ar', String(settings.sampleRate)];
    switch (format) {
        case 'mp3':
            return [
                ...rate,
                '-c:a',
                'libmp3lame',
                ...(settings.bitrateMode === 'vbr'
                    ? ['-q:a', mp3VbrQuality(settings.bitrate)]
                    : ['-b:a', `${settings.bitrate}k`]),
            ];
        case 'flac':
            return [
                ...rate,
                '-c:a',
                'flac',
                ...losslessBitsArgs(settings.flacBits, false),
                '-compression_level',
                String(settings.flacCompression),
            ];
        case 'vorbis':
            return [...rate, '-c:a', 'libvorbis', '-q:a', String(settings.vorbisQuality)];
        case 'opus':
            // Opus は 48000 Hz で符号化する (仕様上の内部の周波数。ほかの周波数を渡すと libopus が受け付けないことがある)
            // ビットレートは、チャンネル数に応じた上限に収める (上限を超える指定は上限で書く)
            return [
                '-ar',
                '48000',
                '-c:a',
                'libopus',
                '-b:a',
                `${Math.min(settings.opusBitrate, OPUS_MAX_KBPS_PER_CHANNEL * Math.max(1, channels ?? 1))}k`,
            ];
        case 'aac':
            return [...rate, '-c:a', 'aac', '-b:a', `${settings.aacBitrate}k`];
        case 'wav':
            return [...rate, '-c:a', WAV_ENCODERS[settings.wavFormat]];
        case 'alac':
            return [...rate, '-c:a', 'alac', ...losslessBitsArgs(settings.alacBits, true)];
    }
}

// アルバムアート (画像) を入れられる形式 (MP3 の ID3・FLAC・M4A)。Ogg と WAV には入れない
export const AUDIO_FORMATS_WITH_PICTURES: AudioFormat[] = ['mp3', 'flac', 'aac', 'alac'];
