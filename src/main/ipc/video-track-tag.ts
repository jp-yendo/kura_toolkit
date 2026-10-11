import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import {
    trackTagCheckSave,
    trackTagDiscard,
    trackTagExport,
    trackTagFrames,
    trackTagMakePreview,
    trackTagPreview,
    trackTagProbe,
    trackTagSave,
    trackTagWaveform,
} from '../services/video-track-tag/index';
import type { TrackTagExportRequest, TrackTagSaveRequest } from '../../shared/types';

export function registerVideoTrackTagIpcHandlers() {
    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_PROBE, (_e, input: string) => trackTagProbe(input));

    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_FRAMES, (_e, input: string) => trackTagFrames(input));

    ipcMain.handle(
        IPC_CHANNELS.VIDEO_TRACK_TAG_WAVEFORM,
        (_e, source: string, streamIndex: number, durationSec: number | null) =>
            trackTagWaveform(source, streamIndex, durationSec)
    );

    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_PREVIEW, (_e, input: string) => trackTagPreview(input));

    ipcMain.handle(
        IPC_CHANNELS.VIDEO_TRACK_TAG_MAKE_PREVIEW,
        (_e, jobId: string, input: string, durationSec: number | null) => trackTagMakePreview(jobId, input, durationSec)
    );

    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_DISCARD, () => trackTagDiscard());

    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_CHECK_SAVE, (_e, request: TrackTagSaveRequest) =>
        trackTagCheckSave(request)
    );

    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_SAVE, (_e, jobId: string, request: TrackTagSaveRequest) =>
        trackTagSave(jobId, request)
    );

    ipcMain.handle(IPC_CHANNELS.VIDEO_TRACK_TAG_EXPORT, (_e, jobId: string, request: TrackTagExportRequest) =>
        trackTagExport(jobId, request)
    );
}
