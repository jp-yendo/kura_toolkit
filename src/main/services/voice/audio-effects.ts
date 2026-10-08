import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { probeAudio } from './audio-tools';
import { getWorker } from './python-worker';
import { ffmpegPhase, nextStep, workerEvents } from './job-progress';
import { hasTailEffect, type EffectsOptions } from '../../../shared/voice/audio-effects';
import type { VoiceComponentId } from '../../../shared/voice/types';

// 効果を付けるエフェクト。EQ → コンプレッサー → ディエッサー → コーラス → ディレイ → リバーブの順にかける。
// ディエッサーは ffmpeg (deesser)、ほかは Python の処理役の pedalboard (kura_voice/effects.py) で行うため、
// ディエッサーを使うときは前後の 2 回に分けて処理役に頼む。長さは変えず、余韻を作るエフェクトがあるときは最後を短く
// フェードアウトする (元の長さで切った余韻がプツッと鳴らないように)

// 最後のフェードアウトの長さ (秒)
const TAIL_FADE_SECONDS = 0.05;

type PythonEffect = { kind: string } & Record<string, unknown>;

// EQ とコンプレッサー (ディエッサーの前)
function frontEffects(effects: EffectsOptions): PythonEffect[] {
    const list: PythonEffect[] = [];
    if (effects.eq.enabled) list.push({ kind: 'eq', lowCutHz: effects.eq.lowCutHz, gainsDb: effects.eq.gainsDb });
    if (effects.compressor.enabled) list.push({ kind: 'compressor', ...withoutEnabled(effects.compressor) });
    return list;
}

// コーラス・ディレイ・リバーブ (ディエッサーの後)
function backEffects(effects: EffectsOptions): PythonEffect[] {
    const list: PythonEffect[] = [];
    if (effects.chorus.enabled) list.push({ kind: 'chorus', ...withoutEnabled(effects.chorus) });
    if (effects.delay.enabled) list.push({ kind: 'delay', ...withoutEnabled(effects.delay) });
    if (effects.reverb.enabled) list.push({ kind: 'reverb', ...withoutEnabled(effects.reverb) });
    return list;
}

// 処理役に渡す値 (有効かどうかは渡さない)
function withoutEnabled<T extends { enabled: boolean }>(option: T): Omit<T, 'enabled'> {
    return Object.fromEntries(Object.entries(option).filter(([key]) => key !== 'enabled')) as Omit<T, 'enabled'>;
}

// エフェクトの処理の段の数 (手順で進むジョブの手順の数に使う。段ごとに 1 手順)
export function effectStageCount(effects: EffectsOptions): number {
    return (
        (frontEffects(effects).length > 0 ? 1 : 0) +
        (effects.deesser.enabled ? 1 : 0) +
        (backEffects(effects).length > 0 ? 1 : 0)
    );
}

// エフェクトをかけて output に書く (32bit 浮動小数の WAV)。component は、その機能で使っている pedalboard のある処理役
// (分離・変換)。channels を指定した場合は、その数で出力する (モノラルの声をステレオにして、リバーブなどに広がりを
// 出すため)。途中のファイルは tempDir に作る。エフェクトが 1 つも無い場合は呼ばない
export async function applyEffects(
    jobId: string,
    component: Extract<VoiceComponentId, 'separator' | 'converter'>,
    input: string,
    output: string,
    effects: EffectsOptions,
    tempDir: string,
    channels?: 1 | 2
): Promise<void> {
    const front = frontEffects(effects);
    const back = backEffects(effects);
    const fadeSeconds = hasTailEffect(effects) ? TAIL_FADE_SECONDS : 0;
    // 処理の段の並び (最後の段が output に書き、チャンネル数とフェードアウトも最後の段で行う)
    const stages: ('front' | 'deesser' | 'back')[] = [];
    if (front.length > 0) stages.push('front');
    if (effects.deesser.enabled) stages.push('deesser');
    if (back.length > 0) stages.push('back');
    if (stages.length === 0) throw new Error('NOTHING_TO_PROCESS');

    let current = input;
    for (let index = 0; index < stages.length; index++) {
        const stage = stages[index];
        const last = index === stages.length - 1;
        const next = last ? output : path.join(tempDir, `effects-${index}.wav`);
        nextStep(jobId);
        if (stage === 'deesser') {
            const { intensity, max, frequency } = effects.deesser;
            const { durationSec } = await probeAudio(current, jobId);
            await runFfmpeg(
                [
                    '-hide_banner',
                    '-nostdin',
                    '-y',
                    '-i',
                    current,
                    '-af',
                    `deesser=i=${intensity}:m=${max}:f=${frequency}`,
                    ...(last && channels ? ['-ac', String(channels)] : []),
                    '-c:a',
                    'pcm_f32le',
                    next,
                ],
                { jobId, totalSec: durationSec, onProgress: ffmpegPhase(jobId, 'effects') }
            );
        } else {
            await getWorker(component).request(
                'apply_effects',
                {
                    input: current,
                    output: next,
                    effects: stage === 'front' ? front : back,
                    ...(last ? { fadeSeconds, ...(channels ? { channels } : {}) } : {}),
                },
                { jobId, onEvent: workerEvents(jobId) }
            );
        }
        current = next;
    }
}
