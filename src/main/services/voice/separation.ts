import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { resolveFfmpegPath } from '../ffmpeg/ffmpeg';
import { centerCancel, convertChannels, decodeToWav, mixFiles } from './audio-tools';
import { isComponentCurrent, isItemInstalled } from './library';
import { forgetMedia, forgetMediaUnder } from './media-protocol';
import { mediaRef } from './media';
import { modelPaths } from './paths';
import { getWorker } from './python-worker';
import { ensureSeparatorModelList, readSeparatorModelList, separatorModelInstalled } from './separator-models';
import { separatorItemId } from './spec';
import { withGpu } from './gpu-lock';
import { isFileBusyError } from '../../utils/rename-retry';
import { discardLater, isInsideWork, newId, produceShared, removeSession, sessionDir, sessionPath } from '../work-dir';
import type {
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

// 音声分離。結果は作業ディレクトリに候補として残し、プレビューと採用に使う。
// 分離した各出力は、元の音源のチャンネル構成 (モノラルならモノラル) に戻す。

// 入力の音声を内部処理用の WAV にする (作業ごとの置き場所に置く)
export async function prepareInput(jobId: string, workKey: string, sourcePath: string): Promise<PreparedInput> {
    startJob(jobId);
    try {
        const dir = sessionDir(workKey, 'input');
        const output = path.join(dir, `${newId()}.wav`);
        try {
            const info = await decodeToWav(sourcePath, output, { jobId, channels: 'keep' });
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
    const list = readSeparatorModelList();
    if (method.kind === 'model')
        return list?.models.find(model => model.filename === method.filename)?.name ?? method.filename;
    if (method.kind === 'verifiedEnsemble')
        return list?.ensembles.find(ensemble => ensemble.id === method.ensembleId)?.name ?? method.ensembleId;
    if (method.kind === 'ensemble') {
        const names = method.filenames.map(
            filename => list?.models.find(model => model.filename === filename)?.name ?? filename
        );
        return `${names.join(' + ')} (${method.algorithm})`;
    }
    return 'center-cancel';
}

// 使ったアーキテクチャのパラメーターだけを候補に残す (一覧の表示用)
function usedParams(request: SeparationRunRequest): Partial<SeparationParams> {
    const method = request.method;
    if (method.kind === 'centerCancel') return {};
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
            return await separateInto(jobId, request, id, dir);
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
    let stems: { name: string; path: string }[];
    if (request.method.kind === 'centerCancel') {
        const vocals = path.join(dir, 'Vocals.wav');
        const instrumental = path.join(dir, 'Instrumental.wav');
        await centerCancel(request.input, vocals, instrumental, jobId);
        stems = [
            { name: 'Vocals', path: vocals },
            { name: 'Instrumental', path: instrumental },
        ];
    } else {
        if (!resolveFfmpegPath()) throw new Error('FFMPEG_NOT_FOUND');
        // 足りないモデルはダウンロード項目の ID で知らせる (画面はその項目を選んだ状態でダウンロードを開く)
        const missing = requiredModels(request)
            .map(filename => separatorItemId(filename))
            .filter(itemId => !isItemInstalled(itemId));
        if (missing.length > 0) throw new Error(`MODEL_NOT_INSTALLED: ${missing.join(', ')}`);
        const raw = path.join(dir, 'raw');
        const worker = getWorker('separator');
        const result = await withGpu(jobId, 'separator', () =>
            worker.request<{ stems: { name: string; path: string }[] }>(
                'separate',
                {
                    modelDir: modelPaths().group('separator'),
                    outputDir: raw,
                    input: request.input,
                    method: request.method,
                    params: request.params,
                },
                {
                    jobId,
                    onEvent: event => {
                        if (event.kind === 'progress' && typeof event.fraction === 'number') {
                            emitJobEvent({ jobId, kind: 'progress', percent: event.fraction * 95 });
                        }
                    },
                }
            )
        );
        stems = [];
        for (const stem of result.stems) {
            const target = path.join(dir, `${sanitizeStem(stem.name)}.wav`);
            // 分離結果は常にステレオで出力されるため、元の音源がモノラルならモノラルに戻す
            await convertChannels(stem.path, target, request.channels, jobId);
            stems.push({ name: stem.name, path: target });
        }
        discardLater(raw);
    }
    const refs: SeparationStem[] = [];
    for (const stem of stems) refs.push({ name: stem.name, media: await mediaRef(stem.path) });
    emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    return {
        id,
        method: request.method,
        methodLabel: methodLabel(request),
        params: usedParams(request),
        category: request.category,
        stems: refs,
        createdAt: Date.now(),
    };
}

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
        await produceShared(output, target => mixFiles(paths, target, channels, jobId));
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

// 別の機能の作業へ渡す音声を、渡す先の作業の置き場へ移す (渡した元の作業を破棄しても消えないようにするため)。
// 同じ作業ディレクトリの中の移動のため、名前の変更で移す。移した後の音声を、渡したパスの順に返す
export async function transferMedia(fromWorkKey: string, toWorkKey: string, paths: string[]): Promise<MediaRef[]> {
    for (const item of paths) {
        if (!isInsideWork(fromWorkKey, item)) throw new Error('INVALID_PATH');
    }
    // 途中で失敗したら、移したものを元へ戻す (送り元の画面が、移す前の音声をそのまま使い続けられるようにするため)
    const moved = new Map<string, string>();
    try {
        for (const item of new Set(paths.map(entry => path.resolve(entry)))) {
            const dest = path.join(sessionDir(toWorkKey, 'received'), `${newId()}${path.extname(item)}`);
            await fs.promises.rename(item, dest);
            moved.set(item, dest);
        }
        const refs = await Promise.all(paths.map(entry => mediaRef(moved.get(path.resolve(entry)) as string)));
        for (const item of moved.keys()) forgetMedia(item);
        return refs;
    } catch (error) {
        for (const [item, dest] of moved) {
            await fs.promises
                .rename(dest, item)
                .catch(rollbackError => console.warn(`failed to move ${dest} back to ${item}`, rollbackError));
        }
        if (isFileBusyError(error)) throw new Error(`MEDIA_IN_USE: ${(error as NodeJS.ErrnoException).path ?? ''}`);
        throw error;
    }
}

export function discardWork(workKey: string): void {
    forgetMediaUnder(sessionPath(workKey));
    removeSession(workKey);
}
