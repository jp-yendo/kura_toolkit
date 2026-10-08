import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { decodeToWav, measureLoudness, pitchShift, probeAudio } from './audio-tools';
import { isItemInstalled } from './library';
import { mediaRef } from './media';
import { getWorker } from './python-worker';
import { RVC_EMBEDDER_ITEMS } from './spec';
import { withGpu } from './gpu-lock';
import { ffmpegPhase, nextStep, voicePhase, withSteps, workerEvents } from './job-progress';
import { editSilence, normalizeLoudness, removeNoise, removeReverb } from './audio-filters';
import { applyEffects, effectStageCount } from './audio-effects';
import {
    sanitizeDereverbOption,
    sanitizeLoudnessOption,
    sanitizeNoiseRemovalOption,
    sanitizeSilenceOption,
} from '../../../shared/voice/audio-filters';
import { hasEffect, hasTailEffect, sanitizeEffectsOptions } from '../../../shared/voice/audio-effects';
import { rvcModelFiles } from './voice-models';
import { discardLater, isInsideWork, newId, produceShared, sessionDir, withJobTemp } from '../work-dir';
import type {
    CandidateFilters,
    ConversionCandidate,
    ConversionFilterRequest,
    ConversionRunRequest,
    MediaRef,
    MixParams,
    MixRenderRequest,
} from '../../../shared/voice/types';

// 音声変換 (RVC)。変換対象のボーカルは左右を平均したモノラルで変換し、変換結果は左右に同じ音を置いた
// 中央定位のステレオとして伴奏と合成する (元の音源がモノラルならモノラルのまま)。

const F0_ITEMS: Record<string, string | null> = {
    rmvpe: 'model:converter:rmvpe',
    fcpe: 'model:converter:fcpe',
    crepe: null,
    'crepe-tiny': null,
};

// 伴奏をキーの変更量に合わせたものの置き場所。オクターブ単位 (±12 の倍数) なら移調しなくても音程が合うため、
// 元の伴奏をそのまま使う (null を返す)。同じ作業の中で採用する伴奏が変わることがあるため、
// 移調した結果は元の伴奏ごとに分けて置く
function accompanimentShift(workKey: string, accompaniment: string, pitch: number): string | null {
    if (pitch % 12 === 0) return null;
    const sourceKey = crypto.createHash('sha1').update(path.resolve(accompaniment)).digest('hex').slice(0, 12);
    return path.join(sessionDir(workKey, 'accompaniment'), `shift_${sourceKey}_${pitch}.wav`);
}

// 伴奏をキーの変更量に合わせる。同じ伴奏を別のキーに移調したときは、それまでのキーのものを消す
// (伴奏と重ねた試聴用の音や合成結果は、移調した伴奏とは別のファイルのため影響しない)
async function shiftedAccompaniment(workKey: string, accompaniment: string, pitch: number, jobId: string) {
    const output = accompanimentShift(workKey, accompaniment, pitch);
    if (!output) return accompaniment;
    await produceShared(output, target =>
        pitchShift(accompaniment, target, pitch, jobId, ffmpegPhase(jobId, 'pitchShift'))
    );
    await removeOtherShifts(output);
    return output;
}

// 同じ伴奏を別のキーに移調したもの (名前のキーの部分だけが違うもの) を消す。作成中のもの
// (produceFile の一時的な名前) は、キーの部分が数値にならないため対象にしない
async function removeOtherShifts(keep: string): Promise<void> {
    const dir = path.dirname(keep);
    const keepName = path.basename(keep);
    const prefix = keepName.slice(0, keepName.lastIndexOf('_') + 1);
    for (const name of fs.readdirSync(dir)) {
        if (name === keepName || !name.startsWith(prefix) || !name.endsWith('.wav')) continue;
        if (!Number.isFinite(Number(name.slice(prefix.length, -'.wav'.length)))) continue;
        discardLater(path.join(dir, name));
    }
}

export async function runConversion(jobId: string, request: ConversionRunRequest): Promise<ConversionCandidate> {
    startJob(jobId);
    try {
        if (!isInsideWork(request.workKey, request.vocals)) throw new Error('INVALID_PATH');
        if (request.accompaniment && !isInsideWork(request.workKey, request.accompaniment)) {
            throw new Error('INVALID_PATH');
        }
        const model = rvcModelFiles(request.voiceId);
        const embedder = model.rvc.embedder;
        const embedderItem = RVC_EMBEDDER_ITEMS[embedder];
        if (!embedderItem) throw new Error(`EMBEDDER_UNSUPPORTED: ${embedder}`);
        if (!isItemInstalled(embedderItem)) throw new Error(`MODEL_REQUIRED: ${embedderItem}`);
        const f0Item = F0_ITEMS[request.params.f0Method];
        if (f0Item && !isItemInstalled(f0Item)) throw new Error(`MODEL_REQUIRED: ${f0Item}`);

        const vocalsInfo = await probeAudio(request.vocals, jobId);
        const accompanimentInfo = request.accompaniment ? await probeAudio(request.accompaniment, jobId) : null;
        const channels = vocalsInfo.channels >= 2 || (accompanimentInfo?.channels ?? 1) >= 2 ? 2 : 1;
        const id = newId();
        const dir = sessionDir(request.workKey, 'conversions', id);
        try {
            // 読み込み・変換・音量をそろえるの 3 手順
            return await withSteps(jobId, 3, () => convertInto(jobId, request, model, id, dir, channels));
        } catch (error) {
            // 失敗・キャンセルした場合は作りかけの候補を消す
            discardLater(dir);
            throw error;
        }
    } finally {
        finishJob(jobId);
    }
}

type ConversionModel = ReturnType<typeof rvcModelFiles>;

async function convertInto(
    jobId: string,
    request: ConversionRunRequest,
    { weights, index, info, rvc }: ConversionModel,
    id: string,
    dir: string,
    channels: number
): Promise<ConversionCandidate> {
    const vocalsOut = path.join(dir, 'vocals.wav');

    await withJobTemp(async temp => {
        // 左右を平均したモノラルで変換する (左右を個別に変換すると推定のずれで音が揺れるため)
        const monoInput = path.join(temp, 'input.wav');
        nextStep(jobId);
        await decodeToWav(request.vocals, monoInput, {
            jobId,
            channels: 'mono',
            onProgress: ffmpegPhase(jobId, 'decodeInput'),
        });
        nextStep(jobId);
        voicePhase(jobId, 'prepare');
        const converted = path.join(temp, 'converted.wav');
        const worker = getWorker('converter');
        await withGpu(jobId, 'converter', () =>
            worker.request(
                'convert',
                {
                    input: monoInput,
                    output: converted,
                    model: weights,
                    index: index ?? '',
                    pitch: request.params.pitch,
                    f0Method: request.params.f0Method,
                    indexRate: request.params.indexRate,
                    volumeEnvelope: request.params.volumeEnvelope,
                    protect: request.params.protect,
                    embedder: rvc.embedder,
                },
                { jobId, onEvent: workerEvents(jobId, 0, 80) }
            )
        );
        const cleaned = converted;
        // 変換後の声を、元の声と同じ大きさ (統合ラウドネス) にそろえる。どちらかが無音で測れない場合はそろえない
        // 段階の進み具合: 変換前の測定 0-0.4、変換後の測定 0.4-0.8、音量の調整 0.8-1
        nextStep(jobId);
        const loudness = (from: number, span: number) => (percent: number) =>
            voicePhase(jobId, 'loudness', { fraction: from + (span * percent) / 100 });
        voicePhase(jobId, 'loudness', { fraction: 0 });
        const originalLoudness = await measureLoudness(monoInput, jobId, loudness(0, 0.4));
        const convertedLoudness = await measureLoudness(cleaned, jobId, loudness(0.4, 0.4));
        const gainDb =
            originalLoudness !== null && convertedLoudness !== null ? originalLoudness - convertedLoudness : 0;
        // 変換結果はモデルのサンプリング周波数のモノラルのまま残す (伴奏の周波数やチャンネル数には、重ねる処理で合わせる。
        // ここで合わせると、書き出しのときにもう一度周波数を変えることになるため)
        if (gainDb === 0) {
            fs.renameSync(cleaned, vocalsOut);
        } else {
            await runFfmpeg(
                [
                    '-hide_banner',
                    '-nostdin',
                    '-y',
                    '-i',
                    cleaned,
                    '-af',
                    `volume=${gainDb.toFixed(2)}dB`,
                    '-c:a',
                    'pcm_f32le',
                    vocalsOut,
                ],
                { jobId, totalSec: (await probeAudio(cleaned, jobId)).durationSec, onProgress: loudness(0.8, 0.2) }
            );
        }
    });

    emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    return {
        id,
        voiceId: request.voiceId,
        voiceName: info.name,
        params: request.params,
        vocals: await mediaRef(vocalsOut),
        channels,
        // 伴奏と重ねた試聴用の音は、変換の段階で求められたときに作る (renderMix の params: null)
        withAccompaniment: null,
        createdAt: Date.now(),
    };
}

// 変換の段階の試聴用に、変換後のボーカルと伴奏をそのまま重ねるときのパラメーター (音量は変えない)
const PLAIN_MIX_PARAMS: MixParams = {
    vocalGainDb: 0,
    accompanimentGainDb: 0,
    masterGainDb: 0,
};

// 候補にフィルターをかけて、新しい候補を作る。除去・調整は分岐の「除去・調整」と、エフェクトは分岐の「エフェクト」と同じ
// 処理で、残響・エコーの除去 → ノイズ除去 → 無音部分の雑音を消す → エフェクト → 音量をそろえるの順に行う (無音の処理を
// エフェクトの前に行うのは、リバーブなどの余韻を無音として消さないため)。リバーブ・コーラス・ディレイをかけるときは、
// 元の音源がステレオならステレオで作る (広がりを出すため)。音量は「音量をそろえる」をチェックしたときだけ変える
export async function filterCandidate(jobId: string, received: ConversionFilterRequest): Promise<ConversionCandidate> {
    startJob(jobId);
    try {
        // 画面から受け取った設定を確かめる
        const filters: CandidateFilters = {
            process: {
                dereverb: sanitizeDereverbOption(received.filters.process.dereverb),
                noiseRemoval: sanitizeNoiseRemovalOption(received.filters.process.noiseRemoval),
                muteSilence: sanitizeSilenceOption(received.filters.process.muteSilence),
                loudness: sanitizeLoudnessOption(received.filters.process.loudness),
            },
            effects: sanitizeEffectsOptions(received.filters.effects),
        };
        const { process, effects } = filters;
        const source = received.source;
        if (!isInsideWork(received.workKey, source.vocals.path)) throw new Error('INVALID_PATH');
        if (
            !process.dereverb.enabled &&
            !process.noiseRemoval.enabled &&
            !process.muteSilence.enabled &&
            !process.loudness.enabled &&
            !hasEffect(effects)
        ) {
            throw new Error('NOTHING_TO_PROCESS');
        }
        const id = newId();
        const dir = sessionDir(received.workKey, 'conversions', id);
        const vocalsOut = path.join(dir, 'vocals.wav');
        // チェックした加工ごと・エフェクトの処理の段ごとに 1 手順 (エフェクトは applyEffects が段ごとに次の手順に入る)
        const steps =
            [process.dereverb, process.noiseRemoval, process.muteSilence, process.loudness].filter(
                option => option.enabled
            ).length + effectStageCount(effects);
        try {
            await withSteps(jobId, steps, () =>
                withJobTemp(async temp => {
                    let current = source.vocals.path;
                    const step = async (name: string, run: (input: string, output: string) => Promise<unknown>) => {
                        if (name !== 'effects') nextStep(jobId);
                        const next = path.join(temp, name + '.wav');
                        await run(current, next);
                        current = next;
                    };
                    if (process.dereverb.enabled) {
                        await step('dereverbed', (input, output) =>
                            removeReverb(jobId, input, output, process.dereverb, temp)
                        );
                    }
                    if (process.noiseRemoval.enabled) {
                        await step('denoised', (input, output) =>
                            removeNoise(jobId, input, output, process.noiseRemoval, temp)
                        );
                    }
                    if (process.muteSilence.enabled) {
                        await step('muted', (input, output) =>
                            editSilence(jobId, 'converter', input, output, process.muteSilence, 'mute')
                        );
                    }
                    if (hasEffect(effects)) {
                        const channels = hasTailEffect(effects) && source.channels === 2 ? 2 : undefined;
                        await step('effects', (input, output) =>
                            applyEffects(jobId, 'converter', input, output, effects, temp, channels)
                        );
                    }
                    if (process.loudness.enabled) {
                        await step('loudness', (input, output) =>
                            normalizeLoudness(jobId, input, output, process.loudness)
                        );
                    }
                    fs.mkdirSync(dir, { recursive: true });
                    fs.renameSync(current, vocalsOut);
                })
            );
        } catch (error) {
            // 失敗・キャンセルした場合は作りかけの候補を消す
            discardLater(dir);
            throw error;
        }
        emitJobEvent({ jobId, kind: 'progress', percent: 100 });
        return {
            id,
            voiceId: source.voiceId,
            voiceName: source.voiceName,
            params: source.params,
            vocals: await mediaRef(vocalsOut),
            channels: source.channels,
            withAccompaniment: null,
            createdAt: Date.now(),
            parentId: source.id,
            filters: [...(source.filters ?? []), filters],
        };
    } finally {
        finishJob(jobId);
    }
}

// 合成 (音量バランス・全体の音量)。合成の段階の確認と書き出しの両方でこの結果を使う。
// params が null の場合は、変換の段階の試聴用にそのまま重ねたものを作る (合成結果とは置き場所を分ける)。
// どちらも、重ねた結果のピークが上限を超える場合は全体を一律に下げる (converter_service.rpc_mix)
export async function renderMix(jobId: string, request: MixRenderRequest): Promise<MediaRef> {
    startJob(jobId);
    try {
        voicePhase(jobId, 'prepare');
        if (!isInsideWork(request.workKey, request.vocals)) throw new Error('INVALID_PATH');
        if (request.accompaniment && !isInsideWork(request.workKey, request.accompaniment)) {
            throw new Error('INVALID_PATH');
        }
        // 同じ組み合わせの試聴用の音が既にあれば、移調も合成もせずにそれを使う
        const accompaniment = request.accompaniment
            ? (accompanimentShift(request.workKey, request.accompaniment, request.pitch) ?? request.accompaniment)
            : null;
        const params = request.params ?? PLAIN_MIX_PARAMS;
        const key = crypto
            .createHash('sha1')
            .update(
                JSON.stringify({
                    vocals: request.vocals,
                    accompaniment,
                    channels: request.channels,
                    params,
                })
            )
            .digest('hex')
            .slice(0, 16);
        const output = path.join(sessionDir(request.workKey, request.params ? 'mix' : 'previews'), `${key}.wav`);
        // 伴奏の移調が要るときは移調と合成の 2 手順
        const shifting = !!request.accompaniment && request.pitch % 12 !== 0;
        await withSteps(jobId, shifting ? 2 : 1, () =>
            produceShared(output, async target => {
                // 変換結果 (モデルの周波数のモノラル) を、元の音源のチャンネル数と伴奏の周波数に合わせて重ねる
                const vocalsInfo = await probeAudio(request.vocals, jobId);
                let sampleRate = vocalsInfo.sampleRate;
                let channels = request.channels === 2 ? 2 : 1;
                if (request.accompaniment) {
                    if (shifting) nextStep(jobId);
                    const shifted = await shiftedAccompaniment(
                        request.workKey,
                        request.accompaniment,
                        request.pitch,
                        jobId
                    );
                    const info = await probeAudio(shifted, jobId);
                    sampleRate = info.sampleRate;
                    channels = Math.max(channels, info.channels);
                }
                nextStep(jobId);
                await getWorker('converter').request(
                    'mix',
                    {
                        vocals: request.vocals,
                        accompaniment,
                        output: target,
                        sampleRate,
                        channels,
                        params,
                    },
                    { jobId, onEvent: workerEvents(jobId) }
                );
            })
        );
        return await mediaRef(output);
    } finally {
        finishJob(jobId);
    }
}
