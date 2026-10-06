import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { analyzeFiles, checkOutputs, normalizeFiles, probeFiles } from '../services/audio-normalizer';
import type { AudioNormalizeInput, AudioNormalizerSettings } from '../../shared/types';

export function registerAudioIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.AUDIO_PROBE, (_e, files: string[]) => {
        return probeFiles(files);
    });

    ipcMain.handle(IPC_CHANNELS.AUDIO_ANALYZE, (_e, jobId: string, files: string[], durations: (number | null)[]) => {
        return analyzeFiles(jobId, files, durations);
    });

    ipcMain.handle(
        IPC_CHANNELS.AUDIO_NORMALIZE,
        (_e, jobId: string, inputs: AudioNormalizeInput[], options: AudioNormalizerSettings) => {
            return normalizeFiles(jobId, inputs, options);
        }
    );

    ipcMain.handle(IPC_CHANNELS.AUDIO_CHECK_OUTPUTS, (_e, files: string[], outputDir: string) => {
        return checkOutputs(files, outputDir);
    });
}
