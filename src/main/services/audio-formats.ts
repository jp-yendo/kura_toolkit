import { resolveFfmpegPath, runTool } from './ffmpeg/ffmpeg';
import { AUDIO_FORMAT_ENCODERS, AUDIO_FORMATS, type AudioFormat } from '../../shared/audio-format';

// 使っている ffmpeg のエンコーダーの一覧。ffmpeg のパスごとに覚える。調べられない場合 (ffmpeg が無い・一覧を得られない) は
// null を返し、覚えない (ffmpeg を直したり設定し直したりした後に、もう一度調べるため)
const encodersCache = new Map<string, Set<string>>();

export async function availableEncoders(): Promise<Set<string> | null> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) return null;
    const cached = encodersCache.get(ffmpegPath);
    if (cached) return cached;
    let stdout: string;
    try {
        const result = await runTool(ffmpegPath, ['-hide_banner', '-encoders']);
        if (result.code !== 0) return null;
        stdout = result.stdout;
    } catch {
        return null;
    }
    // 一覧の各行は「 A....D libmp3lame  説明」の形
    const encoders = new Set(
        stdout
            .split(/\r?\n/)
            .map(line => /^\s*[A-Z.]{6}\s+(\S+)/.exec(line)?.[1])
            .filter((name): name is string => !!name)
    );
    if (encoders.size === 0) return null;
    encodersCache.set(ffmpegPath, encoders);
    return encoders;
}

// 使っている ffmpeg で書き出せる形式 (要るエンコーダーが ffmpeg のビルドに含まれるもの)。エンコーダーを調べられない場合は
// すべての形式を返す (書き出しの時点で ffmpeg の問題を知らせるため)。known は、エンコーダーを調べられたか
// (画面は調べられた結果だけを覚える)
export async function availableAudioFormats(): Promise<{ formats: AudioFormat[]; known: boolean }> {
    const encoders = await availableEncoders();
    if (!encoders) return { formats: AUDIO_FORMATS, known: false };
    return { formats: AUDIO_FORMATS.filter(format => encoders.has(AUDIO_FORMAT_ENCODERS[format])), known: true };
}
