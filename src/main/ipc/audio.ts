import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { analyzeFiles, normalizeFiles } from '../services/audio-normalizer';
import type { AudioNormalizerSettings } from '../../shared/types';

export function registerAudioIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.AUDIO_ANALYZE, (_e, jobId: string, files: string[]) => {
        return analyzeFiles(jobId, files);
    });

    ipcMain.handle(
        IPC_CHANNELS.AUDIO_NORMALIZE,
        (_e, jobId: string, files: string[], options: AudioNormalizerSettings) => {
            return normalizeFiles(jobId, files, options);
        }
    );
}
