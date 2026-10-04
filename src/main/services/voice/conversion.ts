import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { decodeToWav, measureLoudness, mixFiles, pitchShift, probeAudio } from './audio-tools';
import { isItemInstalled } from './library';
import { mediaRef } from './media';
import { getWorker } from './python-worker';
import { withGpu } from './gpu-lock';
import { rvcModelFiles } from './voice-models';
import { isInsideWorkRoot, newId, produceFile, removeTemp, sessionDir, withJobTemp } from '../work-dir';
import type {
    ConversionCandidate,
    ConversionRunRequest,
    MediaRef,
    MixRenderRequest,
} from '../../../shared/voice/types';

// 音声変換 (RVC)。変換対象のボーカルは左右を平均したモノラルで変換し、変換結果は左右に同じ音を置いた
// 中央定位のステレオとして伴奏と合成する (元の音源がモノラルならモノラルのまま)。

// 埋め込みモデル名 -> ダウンロード項目
const EMBEDDER_ITEMS: Record<string, string> = {
    contentvec: 'model:converter:contentvec',
    spin: 'model:converter:embedder-spin',
    'spin-v2': 'model:converter:embedder-spin-v2',
    'japanese-hubert-base': 'model:converter:embedder-japanese-hubert-base',
    'chinese-hubert-base': 'model:converter:embedder-chinese-hubert-base',
    'korean-hubert-base': 'model:converter:embedder-korean-hubert-base',
};

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
// (伴奏と重ねた試聴用の音は、候補ごとに自分の分を持っている)
async function shiftedAccompaniment(workKey: string, accompaniment: string, pitch: number, jobId: string) {
    const output = accompanimentShift(workKey, accompaniment, pitch);
    if (!output) return accompaniment;
    if (fs.existsSync(output)) return output;
    await produceFile(output, target => pitchShift(accompaniment, target, pitch, jobId));
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
        await removeTemp(path.join(dir, name));
    }
}

export async function runConversion(jobId: string, request: ConversionRunRequest): Promise<ConversionCandidate> {
    startJob(jobId);
    try {
        if (!isInsideWorkRoot(request.vocals)) throw new Error('INVALID_PATH');
        const model = rvcModelFiles(request.voiceId);
        const embedder = model.rvc.embedder;
        const embedderItem = EMBEDDER_ITEMS[embedder];
        if (!embedderItem) throw new Error(`EMBEDDER_UNSUPPORTED: ${embedder}`);
        if (!isItemInstalled(embedderItem)) throw new Error(`MODEL_REQUIRED: ${embedderItem}`);
        const f0Item = F0_ITEMS[request.params.f0Method];
        if (f0Item && !isItemInstalled(f0Item)) throw new Error(`MODEL_REQUIRED: ${f0Item}`);

        const vocalsInfo = await probeAudio(request.vocals, jobId);
        const accompanimentInfo = request.accompaniment ? await probeAudio(request.accompaniment, jobId) : null;
        const sampleRate = accompanimentInfo?.sampleRate ?? vocalsInfo.sampleRate;
        const channels = vocalsInfo.channels >= 2 || (accompanimentInfo?.channels ?? 1) >= 2 ? 2 : 1;
        const id = newId();
        const dir = sessionDir(request.workKey, 'conversions', id);
        try {
            return await convertInto(jobId, request, model, id, dir, sampleRate, channels);
        } catch (error) {
            // 失敗・キャンセルした場合は作りかけの候補を消す
            await removeTemp(dir);
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
    sampleRate: number,
    channels: number
): Promise<ConversionCandidate> {
    const vocalsOut = path.join(dir, 'vocals.wav');

    await withJobTemp(async temp => {
        // 左右を平均したモノラルで変換する (左右を個別に変換すると推定のずれで音が揺れるため)
        const monoInput = path.join(temp, 'input.wav');
        await decodeToWav(request.vocals, monoInput, { jobId, channels: 'mono' });
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
                    tempDir: temp,
                    pitch: request.params.pitch,
                    f0Method: request.params.f0Method,
                    indexRate: request.params.indexRate,
                    volumeEnvelope: request.params.volumeEnvelope,
                    protect: request.params.protect,
                    embedder: rvc.embedder,
                },
                {
                    jobId,
                    onEvent: event => {
                        if (event.kind === 'progress' && typeof event.fraction === 'number') {
                            emitJobEvent({ jobId, kind: 'progress', percent: event.fraction * 80 });
                        }
                    },
                }
            )
        );
        // 変換後の声を、元の声と同じ大きさ (統合ラウドネス) にそろえる。どちらかが無音で測れない場合はそろえない
        const originalLoudness = await measureLoudness(monoInput, jobId);
        const convertedLoudness = await measureLoudness(converted, jobId);
        const gainDb =
            originalLoudness !== null && convertedLoudness !== null ? originalLoudness - convertedLoudness : 0;
        // 変換結果 (モデルのサンプリング周波数のモノラル) を、伴奏と同じ周波数の中央定位ステレオにする
        await runFfmpeg(
            [
                '-hide_banner',
                '-nostdin',
                '-y',
                '-i',
                converted,
                '-af',
                `volume=${gainDb.toFixed(2)}dB`,
                '-ac',
                String(channels),
                '-ar',
                String(sampleRate),
                '-c:a',
                'pcm_f32le',
                vocalsOut,
            ],
            { jobId }
        );
    });

    let withAccompaniment: MediaRef | null = null;
    if (request.accompaniment) {
        const accompaniment = await shiftedAccompaniment(
            request.workKey,
            request.accompaniment,
            request.params.pitch,
            jobId
        );
        const output = path.join(dir, 'with-accompaniment.wav');
        await mixFiles([vocalsOut, accompaniment], output, channels, jobId);
        withAccompaniment = await mediaRef(output);
    }
    emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    return {
        id,
        voiceId: request.voiceId,
        voiceName: info.name,
        params: request.params,
        vocals: await mediaRef(vocalsOut),
        withAccompaniment,
        createdAt: Date.now(),
    };
}

// 合成 (音量バランス・リバーブ・全体の音量)。プレビューと書き出しの両方でこの結果を使う
export async function renderMix(jobId: string, request: MixRenderRequest): Promise<MediaRef> {
    startJob(jobId);
    try {
        if (!isInsideWorkRoot(request.vocals)) throw new Error('INVALID_PATH');
        // 同じ組み合わせの試聴用の音が既にあれば、移調も合成もせずにそれを使う
        const accompaniment = request.accompaniment
            ? (accompanimentShift(request.workKey, request.accompaniment, request.pitch) ?? request.accompaniment)
            : null;
        const key = crypto
            .createHash('sha1')
            .update(JSON.stringify({ vocals: request.vocals, accompaniment, params: request.params }))
            .digest('hex')
            .slice(0, 16);
        const output = path.join(sessionDir(request.workKey, 'mix'), `${key}.wav`);
        if (!fs.existsSync(output)) {
            const vocalsInfo = await probeAudio(request.vocals, jobId);
            let sampleRate = vocalsInfo.sampleRate;
            let channels = vocalsInfo.channels;
            if (request.accompaniment) {
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
            await produceFile(output, target =>
                getWorker('converter').request(
                    'mix',
                    {
                        vocals: request.vocals,
                        accompaniment,
                        output: target,
                        sampleRate,
                        channels,
                        params: request.params,
                    },
                    {
                        jobId,
                        onEvent: event => {
                            if (event.kind === 'progress' && typeof event.fraction === 'number') {
                                emitJobEvent({ jobId, kind: 'progress', percent: event.fraction * 100 });
                            }
                        },
                    }
                )
            );
        }
        return await mediaRef(output);
    } finally {
        finishJob(jobId);
    }
}
