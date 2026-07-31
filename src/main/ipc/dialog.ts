import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { FileFilter } from '../../shared/types';

function getParentWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows()[0];
}

export function registerDialogIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILES, async (_e, options: { filters: FileFilter[]; multi?: boolean }) => {
        const parent = getParentWindow();
        const properties: Array<'openFile' | 'multiSelections'> = ['openFile'];
        if (options.multi) properties.push('multiSelections');
        const result = parent
            ? await dialog.showOpenDialog(parent, { filters: options.filters, properties })
            : await dialog.showOpenDialog({ filters: options.filters, properties });
        return result.canceled ? [] : result.filePaths;
    });

    ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, async (_e, options?: { defaultPath?: string }) => {
        const parent = getParentWindow();
        const dialogOptions = {
            properties: ['openDirectory' as const],
            defaultPath: options?.defaultPath || undefined,
        };
        const result = parent
            ? await dialog.showOpenDialog(parent, dialogOptions)
            : await dialog.showOpenDialog(dialogOptions);
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    });

    ipcMain.handle(
        IPC_CHANNELS.DIALOG_SAVE_FILE,
        async (_e, options: { defaultPath?: string; filters: FileFilter[] }) => {
            const parent = getParentWindow();
            const dialogOptions = {
                defaultPath: options.defaultPath || undefined,
                filters: options.filters,
            };
            const result = parent
                ? await dialog.showSaveDialog(parent, dialogOptions)
                : await dialog.showSaveDialog(dialogOptions);
            return result.canceled || !result.filePath ? null : result.filePath;
        }
    );
}
