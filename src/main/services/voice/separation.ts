import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { resolveFfmpegPath } from '../ffmpeg/ffmpeg';
import { convertChannels, decodeToWav, mixFiles, padEnd, probeAudio, SEPARATION_PAD_SECONDS } from './audio-tools';
import { isComponentCurrent, isItemInstalled } from './library';
import { forgetMedia, forgetMediaUnder } from '../media-protocol';
import { mediaRef } from './media';
import { modelPaths } from './paths';
import { getWorker } from './python-worker';
import { ensureSeparatorModelList, readSeparatorModelList, separatorModelInstalled } from './separator-models';
import { separatorItemId } from './spec';
import { withGpu } from './gpu-lock';
import { editSilence, normalizeLoudness, removeNoise, removeReverb } from './audio-filters';
import {
    SEPARATION_LOUDNESS_DEFAULT_LUFS,
    sanitizeDereverbOption,
    sanitizeLoudnessOption,
    sanitizeNoiseRemovalOption,
    sanitizeSilenceOption,
} from '../../../shared/voice/audio-filters';
import { ffmpegPhase, voicePhase, workerEvents } from './job-progress';
import { discardLater, isInsideWork, newId, produceShared, removeSession, sessionDir, sessionPath } from '../work-dir';
import type {
    SeparationMethod,
    VerifiedEnsemble,
    MediaRef,
    PreparedInput,
    SeparationCandidate,
    SeparationModel,
    SeparationModelList,
    SeparationParams,
    SeparationRunRequest,
    SeparationStem,
} from '../../../shared/voice/types';

// 音声分離。結果は作業ディレクトリに候補として残し、プレビュー・続けての分離・書き出し・変換の入力に使う。
// 分離した各出力は、元の音源のチャンネル構成 (モノラルならモノラル) に戻す。

// 入力の音声を内部処理用の WAV にする (作業ごとの置き場所に置く)
export async function prepareInput(jobId: string, workKey: string, sourcePath: string): Promise<PreparedInput> {
    startJob(jobId);
    try {
        const dir = sessionDir(workKey, 'input');
        const output = path.join(dir, `${newId()}.wav`);
        try {
            const info = await decodeToWav(sourcePath, output, {
                jobId,
                channels: 'keep',
                onProgress: ffmpegPhase(jobId, 'decodeInput'),
            });
            return { media: await mediaRef(output), channels: Math.min(2, info.channels), sourcePath };
        } catch (error) {
            // 失敗・キャンセルした場合は書きかけを消す
            discardLater(output);
            throw error;
        }
    } finally {
        finishJob(jobId);
    }
}

export async function listSeparationModels(): Promise<SeparationModelList> {
    // 更新が必要なパッケージ一式 (古い版) では一覧を作らない (古い版の一覧を新しい版のものとして残さないため)
    if (!(await isComponentCurrent('separator'))) throw new Error('SEPARATOR_NOT_INSTALLED');
    const list = await ensureSeparatorModelList();
    const installed = new Set<string>();
    const models: SeparationModel[] = list.models.map(model => {
        const ready = separatorModelInstalled(model);
        if (ready) installed.add(model.filename);
        return {
            itemId: separatorItemId(model.filename),
            filename: model.filename,
            name: model.name,
            arch: model.arch,
            category: model.category,
            stems: model.stems,
            targetStem: model.targetStem,
            sdr: model.sdr,
            installed: ready,
        };
    });
    const known = new Set(list.models.map(model => model.filename));
    const ensembles: VerifiedEnsemble[] = list.ensembles
        // 一覧に無いモデルを使う組み合わせは扱えない
        .filter(ensemble => ensemble.models.every(filename => known.has(filename)))
        .map(ensemble => ({
            itemId: `ensemble:${ensemble.id}`,
            id: ensemble.id,
            name: ensemble.name,
            models: ensemble.models,
            algorithm: ensemble.algorithm,
            category: ensemble.category,
            installed: ensemble.models.every(filename => installed.has(filename)),
        }));
    return { models, ensembles };
}

// 方式に必要なモデル (アンサンブルは構成するモデルすべて)
function requiredModels(request: SeparationRunRequest): string[] {
    const method = request.method;
    if (method.kind === 'model') return [method.filename];
    if (method.kind === 'ensemble') return method.filenames;
    if (method.kind === 'verifiedEnsemble') {
        const ensemble = readSeparatorModelList()?.ensembles.find(item => item.id === method.ensembleId);
        if (!ensemble) throw new Error(`ENSEMBLE_NOT_FOUND: ${method.ensembleId}`);
        return ensemble.models;
    }
    return [];
}

function methodLabel(request: SeparationRunRequest): string {
    const method = request.method;
    // 「その他」の名前は画面で付ける
    if (method.kind === 'process') return '';
    const list = readSeparatorModelList();
    if (method.kind === 'model')
        return list?.models.find(model => model.filename === method.filename)?.name ?? method.filename;
    if (method.kind === 'verifiedEnsemble')
        return list?.ensembles.find(ensemble => ensemble.id === method.ensembleId)?.name ?? method.ensembleId;
    const names = method.filenames.map(
        filename => list?.models.find(model => model.filename === filename)?.name ?? filename
    );
    return `${names.join(' + ')} (${method.algorithm})`;
}

// 使ったアーキテクチャのパラメーターだけを候補に残す (一覧の表示用)
function usedParams(request: SeparationRunRequest): Partial<SeparationParams> {
    const list = readSeparatorModelList();
    const archs = new Set(
        requiredModels(request).map(filename => list?.models.find(model => model.filename === filename)?.arch)
    );
    const result: Partial<SeparationParams> = {};
    if (archs.has('MDX')) result.mdx = request.params.mdx;
    if (archs.has('VR')) result.vr = request.params.vr;
    if (archs.has('Demucs')) result.demucs = request.params.demucs;
    if (archs.has('MDXC')) result.mdxc = request.params.mdxc;
    return result;
}

export async function runSeparation(jobId: string, request: SeparationRunRequest): Promise<SeparationCandidate> {
    startJob(jobId);
    try {
        if (!isInsideWork(request.workKey, request.input)) throw new Error('INVALID_PATH');
        const id = newId();
        const dir = sessionDir(request.workKey, 'candidates', id);
        try {
            return request.method.kind === 'process'
                ? await processInto(
                      jobId,
                      request,
                      {
                          kind: 'process',
                          // 画面から受け取った設定を確かめる
                          dereverb: sanitizeDereverbOption(request.method.dereverb),
                          noiseRemoval: sanitizeNoiseRemovalOption(request.method.noiseRemoval),
                          muteSilence: sanitizeSilenceOption(request.method.muteSilence),
                          loudness: sanitizeLoudnessOption(request.method.loudness, SEPARATION_LOUDNESS_DEFAULT_LUFS),
                      },
                      id,
                      dir
                  )
                : await separateInto(jobId, request, id, dir);
        } catch (error) {
            // 失敗・キャンセルした場合は作りかけの候補を消す
            discardLater(dir);
            throw error;
        }
    } finally {
        finishJob(jobId);
    }
}

async function separateInto(
    jobId: string,
    request: SeparationRunRequest,
    id: string,
    dir: string
): Promise<SeparationCandidate> {
    const stems: { name: string; path: string }[] = [];
    if (!resolveFfmpegPath()) throw new Error('FFMPEG_NOT_FOUND');
    // 足りないモデルはダウンロード項目の ID で知らせる (画面はその項目を選んだ状態でダウンロードを開く)
    const missing = requiredModels(request)
        .map(filename => separatorItemId(filename))
        .filter(itemId => !isItemInstalled(itemId));
    if (missing.length > 0) throw new Error(`MODEL_NOT_INSTALLED: ${missing.join(', ')}`);
    const raw = path.join(dir, 'raw');
    // 末尾に無音を足した入力で分離し、結果を元の長さに切りそろえる (末尾を短く返すモデルがあるため)
    voicePhase(jobId, 'prepare');
    const { durationSec } = await probeAudio(request.input, jobId);
    const padded = path.join(raw, 'input.wav');
    fs.mkdirSync(raw, { recursive: true });
    await padEnd(request.input, padded, SEPARATION_PAD_SECONDS, jobId, {
        totalSec: durationSec,
        onProgress: ffmpegPhase(jobId, 'prepare'),
    });
    const worker = getWorker('separator');
    const result = await withGpu(jobId, 'separator', () =>
        worker.request<{ stems: { name: string; path: string }[] }>(
            'separate',
            {
                modelDir: modelPaths().group('separator'),
                outputDir: path.join(raw, 'stems'),
                input: padded,
                method: request.method,
                params: request.params,
            },
            {
                jobId,
                onEvent: workerEvents(jobId, 0, 95),
            }
        )
    );
    voicePhase(jobId, 'finishStems', { fraction: 0 });
    for (const [index, stem] of result.stems.entries()) {
        const target = path.join(dir, `${sanitizeStem(stem.name)}.wav`);
        // 分離結果は常にステレオで出力されるため、元の音源がモノラルならモノラルに戻す。長さは入力にそろえる
        await convertChannels(stem.path, target, request.channels, jobId, durationSec, percent =>
            voicePhase(jobId, 'finishStems', { fraction: (index + percent / 100) / result.stems.length })
        );
        stems.push({ name: stem.name, path: target });
    }
    discardLater(raw);
    const refs: SeparationStem[] = [];
    for (const stem of stems) refs.push({ name: stem.name, media: await mediaRef(stem.path) });
    emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    return {
        id,
        method: request.method,
        methodLabel: methodLabel(request),
        params: usedParams(request),
        stems: refs,
        createdAt: Date.now(),
    };
}

// 分岐の「その他」: 分離はせず、残響・エコーを除去する・ノイズを除去する・無音部分の雑音を消す・音量をそろえるで加工した
// 1 つの出力を作る
// (長さとチャンネル数は変わらない)
async function processInto(
    jobId: string,
    request: SeparationRunRequest,
    method: Extract<SeparationMethod, { kind: 'process' }>,
    id: string,
    dir: string
): Promise<SeparationCandidate> {
    if (
        !method.dereverb.enabled &&
        !method.noiseRemoval.enabled &&
        !method.muteSilence.enabled &&
        !method.loudness.enabled
    ) {
        throw new Error('NOTHING_TO_PROCESS');
    }
    const work = path.join(dir, 'work');
    fs.mkdirSync(work, { recursive: true });
    // 残響・エコーの除去 → ノイズ除去 → 無音部分の雑音を消す → 音量をそろえるの順に行う (残響の尾や雑音を除いてから
    // 無音を判断すると、無音として消せる部分が増えるため。除去で音量が下がるため、音量は最後にそろえる)
    let current = request.input;
    if (method.dereverb.enabled) {
        const next = path.join(work, 'dereverbed.wav');
        await removeReverb(jobId, current, next, method.dereverb, work);
        current = next;
    }
    if (method.noiseRemoval.enabled) {
        const next = path.join(work, 'denoised.wav');
        await removeNoise(jobId, current, next, method.noiseRemoval, work);
        current = next;
    }
    if (method.muteSilence.enabled) {
        const next = path.join(work, 'muted.wav');
        await editSilence(jobId, 'separator', current, next, method.muteSilence, 'mute');
        current = next;
    }
    if (method.loudness.enabled) {
        const next = path.join(work, 'loudness.wav');
        await normalizeLoudness(jobId, current, next, method.loudness);
        current = next;
    }
    // 出力の名前は、モデルの出力名と同じく言語によらない英語の固定名 (フィルターをかけた音)
    const name = OTHER_OUTPUT_NAME;
    const target = path.join(dir, `${name}.wav`);
    fs.renameSync(current, target);
    discardLater(work);
    emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    return {
        id,
        method: request.method,
        methodLabel: methodLabel(request),
        params: {},
        stems: [{ name, media: await mediaRef(target) }],
        createdAt: Date.now(),
    };
}

// 分岐の「その他」の出力の名前
const OTHER_OUTPUT_NAME = 'Filtered';

function sanitizeStem(name: string): string {
    return name.replace(/[^A-Za-z0-9 _-]/g, '_').trim() || 'stem';
}

// 複数の出力を重ねた音 (重ねた再生・伴奏の合成など)。同じ組み合わせは作り直さない
export async function mixStems(jobId: string, workKey: string, paths: string[], channels: number): Promise<MediaRef> {
    startJob(jobId);
    try {
        for (const item of paths) {
            if (!isInsideWork(workKey, item)) throw new Error('INVALID_PATH');
        }
        const key = crypto
            .createHash('sha1')
            .update(`${channels}|${paths.join('|')}`)
            .digest('hex')
            .slice(0, 16);
        const output = path.join(sessionDir(workKey, 'mixes'), `${key}.wav`);
        await produceShared(output, target => mixFiles(paths, target, { channels }, jobId));
        return await mediaRef(output);
    } finally {
        finishJob(jobId);
    }
}

// 候補などを破棄する。消せるのはその作業の置き場の中のものだけで、外のパスが含まれていれば何も消さない
export function discardPaths(workKey: string, paths: string[]): void {
    for (const item of paths) {
        if (!isInsideWork(workKey, item)) throw new Error('INVALID_PATH');
    }
    for (const item of paths) {
        forgetMedia(item);
        discardLater(item);
    }
}

export function discardWork(workKey: string): void {
    forgetMediaUnder(sessionPath(workKey));
    removeSession(workKey);
}
