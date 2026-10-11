import type { TFunction } from 'i18next';
import { errorMessage } from '../common/errorMessage';
import type { VideoProbeResult } from '@shared/types';

// 動画分割・結合で受け付ける拡張子
export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'ts', 'avi', 'mp3', 'm4a', 'flac', 'ogg'];

// ファイル選択のダイアログの絞り込み
export function videoFilters(t: TFunction) {
    return [
        { name: t('common.fileTypes.media'), extensions: VIDEO_EXTENSIONS },
        { name: t('common.fileTypes.all'), extensions: ['*'] },
    ];
}

// 秒数を HH:MM:SS.mmm 形式に整形する
export function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${s.toFixed(3).padStart(6, '0')}`;
}

// 処理から返ったエラーの表示文言
export function videoErrorMessage(t: TFunction, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('NO_CHAPTERS')) return t('videoSplitMergePage.noChapters');
    if (message.includes('INVALID_RANGE')) return t('videoSplitMergePage.invalidRange');
    if (message.includes('NO_SPLIT_POINT')) return t('videoSplitMergePage.noSplitPoint');
    if (message.includes('DUPLICATE_OUTPUTS')) return t('videoSplitMergePage.duplicateOutputs');
    if (message.includes('OUTPUT_EQUALS_INPUT')) return t('videoSplitMergePage.outputEqualsInput');
    if (message.includes('NEED_TWO_FILES')) return t('videoSplitMergePage.needTwoFiles');
    if (message.includes('NO_MEDIA_STREAMS')) return t('videoSplitMergePage.noMediaStreams');
    if (message.includes('UNKNOWN_DURATION')) return t('videoSplitMergePage.unknownDuration');
    if (message.includes('NO_ENCODER')) return t('videoSplitMergePage.noEncoder');
    if (message.includes('SMART_CUT_FAILED')) return t('videoSplitMergePage.smartCutFailed');
    return errorMessage(t, error);
}

// 一覧に添える、ファイルの中身の要約 (例: 00:12:34.000 / h264 1920x1080 / aac 2ch 48000 Hz)
export function summarizeMedia(probe: VideoProbeResult): string {
    const parts: string[] = [probe.durationSec !== null ? formatTime(probe.durationSec) : '?'];
    const video = probe.streams.find(stream => stream.kind === 'video' && !stream.attachedPic);
    if (video) {
        parts.push([video.codec, video.width && video.height ? `${video.width}x${video.height}` : ''].join(' ').trim());
    }
    const audio = probe.streams.find(stream => stream.kind === 'audio');
    if (audio) {
        parts.push(
            [audio.codec, audio.channels ? `${audio.channels}ch` : '', audio.sampleRate ? `${audio.sampleRate} Hz` : '']
                .filter(Boolean)
                .join(' ')
        );
    }
    return parts.join(' / ');
}
