import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { collectFiles } from '../services/file-collector';

export function registerFileIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.FILES_COLLECT, (_e, paths: string[], extensions: string[]) => {
        return collectFiles(paths, extensions);
    });
}
