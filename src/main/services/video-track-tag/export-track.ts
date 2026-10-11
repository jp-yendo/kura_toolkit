import path from 'path';
import { probeJson } from '../ffmpeg/ffprobe';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { produceFile } from '../work-dir';
import { probeStreams, toTrackStream } from './probe';
import { sameFile } from './save';
import { trackExportFormat } from '../../../shared/video-track-tag';
import type { TrackTagExportRequest } from '../../../shared/types';

// 動画トラック・タグ管理: トラックを 1 つ、単体のファイルへ書き出す。形式はトラックのコーデックから決め
// (trackExportFormat)、再エンコードせずに写す (mp4 の字幕だけ SubRip へ形式を変える)

// 拡張子だけでは ffmpeg が出力の形式を決められないもの
const MUXERS: Record<string, string> = { '.mks': 'matroska', '.mka': 'matroska' };

export async function exportTrack(
    jobId: string,
    request: TrackTagExportRequest,
    onProgress: (percent: number) => void
): Promise<void> {
    if (sameFile(request.output, request.input)) throw new Error('OUTPUT_EQUALS_INPUT');
    const stream = (await probeStreams(request.input, jobId)).find(item => item.index === request.streamIndex);
    const kind = stream ? toTrackStream(stream, 0).kind : null;
    if (!stream || !kind) throw new Error('TRACK_NOT_FOUND');
    const format = trackExportFormat(kind, stream.codec_name ?? '');
    const extension = path.extname(request.output).toLowerCase();
    const media = await probeJson<{ format?: { duration?: string } }>(['-show_format', request.input], { jobId });
    const duration = Number.parseFloat(media.format?.duration ?? '');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-i', request.input];
    // チャプターは書かない (mp4 ではチャプター用のトラックが加わり、トラック 1 つのファイルにならないため)
    args.push('-map', `0:${request.streamIndex}`, '-c', format.encoder ?? 'copy', '-map_chapters', '-1');
    if (stream.codec_name === 'hevc' && ['.mp4', '.m4v', '.mov'].includes(extension)) args.push('-tag:0', 'hvc1');
    if (MUXERS[extension]) args.push('-f', MUXERS[extension]);
    await produceFile(request.output, target =>
        runFfmpeg([...args, target], {
            jobId,
            totalSec: Number.isFinite(duration) && duration > 0 ? duration : undefined,
            onProgress,
        })
    );
}
