import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import {
    getAvailableCleanupTargets,
    getCleanupRoots,
    getFullDiskAccessStatus,
    removeCleanupItems,
    scanCleanupTargets,
    type CleanupScanOptions,
} from '../services/cleanup';
import type { CleanupCapabilities, CleanupItem } from '../../shared/types';

// macOS のフルディスクアクセス設定を開く URL スキーム
const MAC_FULL_DISK_ACCESS_URL =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

export function registerCleanupIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.CLEANUP_GET_CAPABILITIES, (): CleanupCapabilities => {
        return {
            availableTargets: getAvailableCleanupTargets(),
            requiresFullDiskAccess: process.platform === 'darwin',
            hasFullDiskAccess: getFullDiskAccessStatus(),
        };
    });

    ipcMain.handle(IPC_CHANNELS.CLEANUP_OPEN_PERMISSION_SETTINGS, async () => {
        if (process.platform !== 'darwin') return;
        await shell.openExternal(MAC_FULL_DISK_ACCESS_URL);
    });

    ipcMain.handle(IPC_CHANNELS.CLEANUP_GET_ROOTS, () => {
        return getCleanupRoots();
    });

    ipcMain.handle(IPC_CHANNELS.CLEANUP_SCAN, (_e, jobId: string, options: CleanupScanOptions) => {
        return scanCleanupTargets(jobId, options);
    });

    ipcMain.handle(IPC_CHANNELS.CLEANUP_REMOVE, (_e, jobId: string, items: CleanupItem[]) => {
        return removeCleanupItems(jobId, items);
    });
}
