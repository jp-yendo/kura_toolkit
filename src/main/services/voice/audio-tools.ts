import fs from 'fs';
import path from 'path';
import { probeJson } from '../ffmpeg/ffprobe';
import { resolveFfmpegPath, runFfmpeg, runTool } from '../ffmpeg/ffmpeg';
import { produceFile } from '../work-dir';
import type { AudioExportSettings } from '../../../shared/voice/types';

// 音声機能で使う ffmpeg の処理。中間ファイルは 32bit 浮動小数の WAV とする
// (段階を重ねる処理で音が割れたり精度が落ちたりしないようにするため)。

type AudioInfo = {
    durationSec: number;
    channels: number;
    sampleRate: number;
};

type ProbeResult = {
    streams?: { codec_type?: string; channels?: number; sample_rate?: string; duration?: string }[];
    format?: { duration?: string };
};

// 音声の長さ・チャンネル数・サンプリング周波数を調べる。いずれかが分からない音声は扱えない
export async function probeAudio(filePath: string, jobId?: string): Promise<AudioInfo> {
    const result = await probeJson<ProbeResult>(['-show_streams', '-show_format', '-select_streams', 'a:0', filePath], {
        jobId,
    });
    const stream = result.streams?.find(item => item.codec_type === 'audio');
    if (!stream) throw new Error('NO_AUDIO_STREAM');
    // ストリーム単位の長さを持たない形式 (mkv など) は、コンテナ全体の長さを使う
    const durationSec = Number(stream.duration ?? result.format?.duration);
    const sampleRate = Number(stream.sample_rate);
    const channels = stream.channels;
    if (!Number.isFinite(durationSec) || !(sampleRate > 0) || !channels || channels < 1) {
        throw new Error(`AUDIO_INFO_UNKNOWN: ${filePath}`);
    }
    return { durationSec, channels, sampleRate };
}

type DecodeOptions = {
    jobId?: string;
    // keep: 元のまま (3ch 以上はステレオへ縮約) / mono: 左右の平均
    channels: 'keep' | 'mono';
};

// 任意の音声 (動画の音声も含む) を内部処理用の WAV にする
export async function decodeToWav(input: string, output: string, options: DecodeOptions): Promise<AudioInfo> {
    const info = await probeAudio(input, options.jobId);
    const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn'];
    const channels = options.channels === 'mono' ? 1 : Math.min(info.channels, 2);
    if (channels !== info.channels) args.push('-ac', String(channels));
    args.push('-c:a', 'pcm_f32le', '-f', 'wav', output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await runFfmpeg(args, { jobId: options.jobId });
    return { ...info, channels };
}

// チャンネル数をそろえる (分離結果を元の音源のチャンネル構成に戻すときなど)
export async function convertChannels(input: string, output: string, channels: number, jobId?: string): Promise<void> {
    await runFfmpeg(
        ['-hide_banner', '-nostdin', '-y', '-i', input, '-ac', String(channels), '-c:a', 'pcm_f32le', output],
        { jobId }
    );
}

// ffmpeg のビルドに rubberband フィルタが含まれているか (ffmpeg のパスごとに結果を覚える)
const rubberbandCache = new Map<string, boolean>();

export async function hasRubberband(): Promise<boolean> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) throw new Error('FFMPEG_NOT_FOUND');
    const cached = rubberbandCache.get(ffmpegPath);
    if (cached !== undefined) return cached;
    const result = await runTool(ffmpegPath, ['-hide_banner', '-filters']);
    const available = /^\s*[.A-Z|]+\s+rubberband\s/m.test(result.stdout);
    rubberbandCache.set(ffmpegPath, available);
    return available;
}

export async function requireRubberband(): Promise<void> {
    if (!(await hasRubberband())) throw new Error('RUBBERBAND_UNAVAILABLE');
}

// 統合ラウドネス (ITU-R BS.1770。無音の部分を除いて測る) を LUFS で返す。無音で測れない場合は null
// (ffmpeg の ebur128 は、ゲートを通る区間が無い音を -70 LUFS と報告する)
export async function measureLoudness(input: string, jobId?: string): Promise<number | null> {
    const result = await runFfmpeg(
        ['-hide_banner', '-nostdin', '-i', input, '-map', '0:a:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
        { jobId }
    );
    const matches = [...result.stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)];
    const loudness = matches.length > 0 ? Number(matches[matches.length - 1][1]) : NaN;
    return Number.isFinite(loudness) && loudness > -70 ? loudness : null;
}

// 音程を半音単位で変える (伴奏の移調)。長さは変えない
export async function pitchShift(input: string, output: string, semitones: number, jobId?: string): Promise<void> {
    await requireRubberband();
    const ratio = Math.pow(2, semitones / 12);
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            input,
            '-af',
            `rubberband=pitch=${ratio.toFixed(6)}:pitchq=quality`,
            '-c:a',
            'pcm_f32le',
            output,
        ],
        { jobId }
    );
}

// 音程を変えずに長さを変える (読み上げの話速の微調整)。tempo > 1 で短くなる
export async function timeStretch(input: string, output: string, tempo: number, jobId?: string): Promise<void> {
    await requireRubberband();
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-i',
            input,
            '-af',
            `rubberband=tempo=${tempo.toFixed(6)}`,
            '-c:a',
            'pcm_f32le',
            output,
        ],
        { jobId }
    );
}

// 複数の音声を重ねる (分離結果の重ね合わせ再生や、変換結果と伴奏の簡易合成のプレビュー)。
// 音量の自動調整は行わず、そのままの大きさで足し合わせる
export async function mixFiles(inputs: string[], output: string, channels: number, jobId?: string): Promise<void> {
    if (inputs.length === 0) throw new Error('NO_INPUT');
    const args = ['-hide_banner', '-nostdin', '-y'];
    for (const input of inputs) args.push('-i', input);
    const layout = channels === 1 ? 'mono' : 'stereo';
    const filters: string[] = [];
    const labels: string[] = [];
    for (let index = 0; index < inputs.length; index++) {
        filters.push(`[${index}:a]aformat=channel_layouts=${layout}[a${index}]`);
        labels.push(`[a${index}]`);
    }
    if (inputs.length === 1) {
        filters.push(`${labels[0]}anull[out]`);
    } else {
        filters.push(`${labels.join('')}amix=inputs=${inputs.length}:duration=longest:normalize=0[out]`);
    }
    args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'pcm_f32le', output);
    await runFfmpeg(args, { jobId });
}

// ステレオの左右差を使って中央に定位した音を打ち消す従来手法 (機械学習を使わない比較用の分離)。
// 伴奏側は左右の差、ボーカル側は左右の平均 (中央に定位した成分) を出力する
export async function centerCancel(
    input: string,
    vocalsOutput: string,
    instrumentalOutput: string,
    jobId?: string
): Promise<void> {
    const info = await probeAudio(input, jobId);
    if (info.channels < 2) throw new Error('CENTER_CANCEL_MONO');
    await runFfmpeg(
        [
            '-hide_banner',
            '-nostdin',
            '-nostats',
            '-y',
            '-i',
            input,
            '-filter_complex',
            '[0:a]asplit=2[v][i];[v]pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1[vo];[i]pan=stereo|c0=c0-c1|c1=c1-c0[io]',
            '-map',
            '[vo]',
            '-c:a',
            'pcm_f32le',
            vocalsOutput,
            '-map',
            '[io]',
            '-c:a',
            'pcm_f32le',
            instrumentalOutput,
        ],
        { jobId }
    );
}

// MP3 の可変ビットレートの品質 (LAME の -V)。目安のビットレートに平均が近くなる値を選ぶ
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

// 書き出し (MP3 / FLAC)
export async function encodeExport(
    input: string,
    output: string,
    settings: AudioExportSettings,
    jobId?: string
): Promise<void> {
    const args = ['-hide_banner', '-nostdin', '-nostats', '-y', '-i', input, '-map', '0:a:0'];
    if (settings.format === 'mp3') {
        args.push('-ar', String(settings.sampleRate), '-c:a', 'libmp3lame');
        if (settings.bitrateMode === 'vbr') args.push('-q:a', mp3VbrQuality(settings.bitrate));
        else args.push('-b:a', `${settings.bitrate}k`);
    } else {
        // FLAC は 24bit で書き出す (浮動小数の中間ファイルから精度を落としすぎないため)
        args.push('-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24');
    }
    // 別の名前に書いてから、名前の変更で既存のファイルを置き換える (失敗しても既存のファイルは残る)
    await produceFile(output, target => runFfmpeg([...args, target], { jobId }));
}
