import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import {
    chapterCheckCut,
    chapterCheckSplit,
    chapterCut,
    chapterProbe,
    chapterSplit,
} from '../services/chapter/index';
import type { ChapterCutRequest, ChapterSplitRequest } from '../../shared/types';

export function registerChapterIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.CHAPTER_PROBE, (_e, input: string) => {
        return chapterProbe(input);
    });

    ipcMain.handle(IPC_CHANNELS.CHAPTER_CUT, (_e, jobId: string, request: ChapterCutRequest) => {
        return chapterCut(jobId, request);
    });

    ipcMain.handle(IPC_CHANNELS.CHAPTER_SPLIT, (_e, jobId: string, request: ChapterSplitRequest) => {
        return chapterSplit(jobId, request);
    });

    ipcMain.handle(IPC_CHANNELS.CHAPTER_CHECK_CUT, (_e, request: ChapterCutRequest) => {
        return chapterCheckCut(request);
    });

    ipcMain.handle(IPC_CHANNELS.CHAPTER_CHECK_SPLIT, (_e, request: ChapterSplitRequest) => {
        return chapterCheckSplit(request);
    });
}
