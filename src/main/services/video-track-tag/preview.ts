import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { forgetMediaUnder, mediaUrl } from '../media-protocol';
import { discardLater, newTempDir, produceFile } from '../work-dir';
import { probeStreams } from './probe';
import type { TrackTagPreview } from '../../../shared/types';

// 動画トラック・タグ管理: プレビューで再生する動画。元の動画をそのまま再生し、再生できない形式 (コーデック) の場合だけ
// プレビュー用の動画 (H.264・AAC、高さ 720 以下) を作業ディレクトリに作って再生する

// 作ったプレビュー用の動画を置いたフォルダ (discardPreview で片付ける)
let proxyDir: string | null = null;

// 元の動画を再生する URL
export function previewSource(input: string): TrackTagPreview {
    return { url: mediaUrl(input), proxy: false };
}

// プレビュー用の動画を作り、その URL を返す。フレームの時刻は元の動画と同じ間隔のまま (フレームを足し引きしない)
export async function makePreview(
    jobId: string,
    input: string,
    durationSec: number | null,
    onProgress: (percent: number) => void
): Promise<TrackTagPreview> {
    discardPreview();
    const streams = await probeStreams(input, jobId);
    const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    const audio =
        streams.find(stream => stream.codec_type === 'audio' && stream.disposition?.default) ??
        streams.find(stream => stream.codec_type === 'audio');
    proxyDir = newTempDir();
    const output = path.join(proxyDir, 'preview.mp4');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-i', input];
    if (video) {
        args.push(
            '-map',
            `0:${video.index}`,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '26',
            // 位置を合わせやすいよう、キーフレームを 1 秒程度ごとに置く
            '-g',
            '24',
            '-pix_fmt',
            'yuv420p',
            '-vf',
            "scale=-2:'min(720,ih)'",
            '-fps_mode',
            'passthrough'
        );
    }
    if (audio) args.push('-map', `0:${audio.index}`, '-c:a', 'aac', '-b:a', '160k');
    args.push('-movflags', '+faststart');
    await produceFile(output, target =>
        runFfmpeg([...args, target], { jobId, totalSec: durationSec ?? undefined, onProgress })
    );
    return { url: mediaUrl(output), proxy: true };
}

// 作ったプレビュー用の動画を片付ける
export function discardPreview(): void {
    if (!proxyDir) return;
    forgetMediaUnder(proxyDir);
    discardLater(proxyDir);
    proxyDir = null;
}
