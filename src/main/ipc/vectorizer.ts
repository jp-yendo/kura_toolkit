import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { convertImage, loadImagePreview, saveSvgFile } from '../services/vectorizer';
import type { VectorizeParams } from '../../shared/types';

export function registerVectorizerIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.VECTORIZER_LOAD_IMAGE, (_e, path: string) => {
        return loadImagePreview(path);
    });

    ipcMain.handle(IPC_CHANNELS.VECTORIZER_CONVERT, async (_e, path: string, params: VectorizeParams) => {
        const svg = await convertImage(path, params);
        return { svg };
    });

    ipcMain.handle(IPC_CHANNELS.VECTORIZER_SAVE_SVG, (_e, path: string, svg: string) => {
        return saveSvgFile(path, svg);
    });
}
