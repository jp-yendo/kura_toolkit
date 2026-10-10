import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { discardSvgAutoResult, loadSvgAutoImage, runSvgAuto, saveSvgAutoVersion } from '../services/svg-auto/session';
import type { SvgAutoRequest } from '../../shared/types';

export function registerSvgAutoIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.SVG_AUTO_LOAD_IMAGE, (_e, path: string) => loadSvgAutoImage(path));

    ipcMain.handle(IPC_CHANNELS.SVG_AUTO_START, (_e, jobId: string, path: string, request: SvgAutoRequest) =>
        runSvgAuto(jobId, path, request)
    );

    ipcMain.handle(IPC_CHANNELS.SVG_AUTO_SAVE, (_e, versionId: string, path: string) =>
        saveSvgAutoVersion(versionId, path)
    );

    ipcMain.handle(IPC_CHANNELS.SVG_AUTO_DISCARD, () => discardSvgAutoResult());
}
