import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import {
    videoCheckCut,
    videoCheckSplit,
    videoCut,
    videoCheckMergeOutput,
    videoCapabilities,
    videoMerge,
    videoProbe,
    videoSplit,
} from '../services/video-split-merge/index';
import type { VideoCutRequest, VideoMergeRequest, VideoSplitRequest } from '../../shared/types';

export function registerVideoSplitMergeIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_PROBE, (_e, input: string) => {
        return videoProbe(input);
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_CUT, (_e, jobId: string, request: VideoCutRequest) => {
        return videoCut(jobId, request);
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_SPLIT, (_e, jobId: string, request: VideoSplitRequest) => {
        return videoSplit(jobId, request);
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_CHECK_CUT, (_e, request: VideoCutRequest) => {
        return videoCheckCut(request);
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_CHECK_SPLIT, (_e, request: VideoSplitRequest) => {
        return videoCheckSplit(request);
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_MERGE, (_e, jobId: string, request: VideoMergeRequest) => {
        return videoMerge(jobId, request);
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_CAPABILITIES, () => {
        return videoCapabilities();
    });

    ipcMain.handle(IPC_CHANNELS.VIDEO_SPLIT_MERGE_CHECK_OUTPUT, (_e, output: string) => {
        return videoCheckMergeOutput(output);
    });
}
