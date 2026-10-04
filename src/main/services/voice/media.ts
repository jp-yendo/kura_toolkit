import { probeAudio } from './audio-tools';
import { mediaUrl } from './media-protocol';
import type { MediaRef } from '../../../shared/voice/types';

// 再生できる音声ファイルの情報 (長さ・チャンネル数と、renderer で再生するための URL)
export async function mediaRef(filePath: string): Promise<MediaRef> {
    const info = await probeAudio(filePath);
    return {
        path: filePath,
        url: mediaUrl(filePath),
        durationSec: info.durationSec,
        channels: info.channels,
        sampleRate: info.sampleRate,
    };
}
