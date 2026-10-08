import type { SeparationParams } from './types';

// 分離のパラメーターの既定値 (画面の初期値と、main がモデルでノイズを除去するときに使う)
export const DEFAULT_SEPARATION_PARAMS: SeparationParams = {
    mdx: { segmentSize: 256, overlap: 0.25, batchSize: 1, hopLength: 1024, enableDenoise: false },
    vr: {
        windowSize: 512,
        aggression: 5,
        enableTta: false,
        enablePostProcess: false,
        postProcessThreshold: 0.2,
        highEndProcess: false,
        batchSize: 1,
    },
    demucs: { segmentSize: null, shifts: 2, overlap: 0.25 },
    mdxc: { segmentSize: 256, overrideModelSegmentSize: false, batchSize: null, overlap: null, pitchShift: 0 },
};
