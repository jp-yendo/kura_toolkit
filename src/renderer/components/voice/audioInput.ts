import type { TFunction } from 'i18next';
import type { FileFilter } from '@shared/types';

// 音声機能で読み込める音声 (動画の音声も ffmpeg で取り出せるため含める)
export const AUDIO_INPUT_EXTENSIONS = [
    'wav',
    'mp3',
    'flac',
    'aac',
    'm4a',
    'ogg',
    'oga',
    'opus',
    'aif',
    'aiff',
    'wma',
    'mp4',
    'mkv',
    'webm',
    'mov',
];

// 音声 (または動画) を選ぶダイアログの種類
export function audioInputFilters(t: TFunction): FileFilter[] {
    return [
        { name: t('voice.fileFilters.audio'), extensions: AUDIO_INPUT_EXTENSIONS },
        { name: t('voice.fileFilters.allFiles'), extensions: ['*'] },
    ];
}
