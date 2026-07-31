import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { checkForUpdates, downloadUpdate, getUpdateState, quitAndInstall } from '../services/updater';

export function registerUpdaterIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.UPDATER_GET_STATE, () => getUpdateState());
    ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, () => checkForUpdates());
    ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, () => downloadUpdate());
    ipcMain.handle(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL, () => {
        quitAndInstall();
    });
}
