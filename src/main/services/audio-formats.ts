import { resolveFfmpegPath, runTool } from './ffmpeg/ffmpeg';
import { AUDIO_FORMAT_ENCODERS, AUDIO_FORMATS, type AudioFormat } from '../../shared/audio-format';

// 使っている ffmpeg で書き出せる形式 (要るエンコーダーが ffmpeg のビルドに含まれるもの)。ffmpeg のパスごとに覚える。
// ffmpeg が見つからない場合はすべての形式を返す (書き出しの時点で ffmpeg が無いことを知らせるため)
const formatsCache = new Map<string, AudioFormat[]>();

export async function availableAudioFormats(): Promise<AudioFormat[]> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) return AUDIO_FORMATS;
    const cached = formatsCache.get(ffmpegPath);
    if (cached) return cached;
    const result = await runTool(ffmpegPath, ['-hide_banner', '-encoders']);
    // 一覧の各行は「 A....D libmp3lame  説明」の形
    const encoders = new Set(
        result.stdout
            .split(/\r?\n/)
            .map(line => /^\s*[A-Z.]{6}\s+(\S+)/.exec(line)?.[1])
            .filter((name): name is string => !!name)
    );
    const formats = AUDIO_FORMATS.filter(format => encoders.has(AUDIO_FORMAT_ENCODERS[format]));
    formatsCache.set(ffmpegPath, formats);
    return formats;
}
