import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { convertImage, discardVectorizeResult, loadImagePreview, saveSvgFile } from '../services/vectorizer';
import {
    listVectorizerPresets,
    removeVectorizerPreset,
    renameVectorizerPreset,
    saveVectorizerPreset,
} from '../services/vectorizer-presets';
import type { PresetSaveRequest, VectorizeParams, VectorizeRequest } from '../../shared/types';

export function registerVectorizerIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.VECTORIZER_LOAD_IMAGE, (_e, path: string) => {
        return loadImagePreview(path);
    });

    ipcMain.handle(
        IPC_CHANNELS.VECTORIZER_CONVERT,
        async (_e, jobId: string, path: string, request: VectorizeRequest) => {
            return convertImage(jobId, path, request);
        }
    );

    ipcMain.handle(IPC_CHANNELS.VECTORIZER_SAVE_SVG, (_e, resultId: string, path: string) => {
        return saveSvgFile(resultId, path);
    });

    ipcMain.handle(IPC_CHANNELS.VECTORIZER_DISCARD, () => discardVectorizeResult());

    // --- パラメータのプリセット ---
    ipcMain.handle(IPC_CHANNELS.VECTORIZER_PRESETS_LIST, () => listVectorizerPresets());
    ipcMain.handle(IPC_CHANNELS.VECTORIZER_PRESETS_SAVE, (_e, preset: PresetSaveRequest<VectorizeParams>) =>
        saveVectorizerPreset(preset)
    );
    ipcMain.handle(IPC_CHANNELS.VECTORIZER_PRESETS_RENAME, (_e, id: string, name: string) =>
        renameVectorizerPreset(id, name)
    );
    ipcMain.handle(IPC_CHANNELS.VECTORIZER_PRESETS_REMOVE, (_e, id: string) => removeVectorizerPreset(id));
}
