import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { cancelJob } from '../services/job-manager';

export function registerJobIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.JOB_CANCEL, (_e, jobId: string) => {
        cancelJob(jobId);
    });
}
