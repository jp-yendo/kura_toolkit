import crypto from 'crypto';
import fs from 'fs/promises';
import { DEFAULT_SVG_AUTO_TRIALS, SVG_AUTO_STEPS, SVG_AUTO_TRIALS_RANGE } from '../../../shared/svg-auto';
import { DEFAULT_VECTORIZE_PARAMS, INITIAL_VECTORIZE_PRESET_ID } from '../../../shared/vectorizer';
import type {
    ImagePreview,
    SvgAutoJobResult,
    SvgAutoProgressPayload,
    SvgAutoRequest,
    SvgAutoVersion,
} from '../../../shared/types';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { forgetMediaUnder, mediaUrl } from '../media-protocol';
import { imagePreview, normalizeVectorizeOutput, normalizeVectorizePreprocess, numberIn } from '../vectorizer';
import { builtinVectorizerPresets } from '../vectorizer-presets';
import { newId, removeSession, sessionDir } from '../work-dir';
import { runWorkerJob } from '../worker-job';
import type { SvgAutoProgress, SvgAutoWorkerInit } from './auto-convert';
import { readVersionIndex, type VersionIndex } from './version-index';

// SVG 自動変換の作業 (main 側。ジョブ・ワーカーの起動・版のファイルの管理)。
// 版のファイルは作業ディレクトリの作業ごとの置き場に置き、表示用の URL (kura-media://) で見せ、保存はそのファイルを写す。
// 結果は最後の 1 つだけを持ち、新しく始めたとき・画面の結果を破棄したときに片付ける

type Session = {
    workKey: string;
    dir: string;
    // 版の識別子とファイル
    files: Map<string, string>;
};

let session: Session | null = null;
// 実行中の自動変換のジョブ (同時には 1 つだけ動かす)
let activeJobId: string | null = null;

function discardSession(target: Session): void {
    forgetMediaUnder(target.dir);
    removeSession(target.workKey);
}

// 結果 (版のファイル) を片付ける
export function discardSvgAutoResult(): void {
    if (!session) return;
    discardSession(session);
    session = null;
}

// 元画像を表示用に公開する
export function loadSvgAutoImage(filePath: string): ImagePreview {
    return imagePreview(filePath);
}

// renderer から受け取った要求を、範囲に収めた値にする (欠けた値・型の違う値は既定値)
function normalizeRequest(request: SvgAutoRequest): SvgAutoRequest {
    return {
        preprocess: normalizeVectorizePreprocess(request?.preprocess),
        output: normalizeVectorizeOutput(request?.output),
        trials: numberIn(request?.trials, SVG_AUTO_TRIALS_RANGE, DEFAULT_SVG_AUTO_TRIALS),
    };
}

// 手順と進み具合を知らせる (手順の文言は jobPhases.svgAuto.<手順>。進み具合が分からない手順は進捗バーを不定にする)
function emitProgress(jobId: string, progress: SvgAutoProgress): void {
    emitJobEvent({
        jobId,
        kind: 'progress',
        percent: progress.fraction === undefined ? null : progress.fraction * 100,
        payload: { bestFidelity: progress.bestFidelity } satisfies SvgAutoProgressPayload,
        phase: {
            id: `svgAuto.${progress.step}`,
            fraction: progress.fraction,
            current: progress.current,
            total: progress.total,
            step: SVG_AUTO_STEPS.indexOf(progress.step) + 1,
            steps: SVG_AUTO_STEPS.length,
        },
    });
}

// 版の一覧を、画面に渡す版にする (識別子を付け、ファイルを表示用に公開する)
function publish(index: VersionIndex, incomplete: boolean, dir: string, workKey: string) {
    const files = new Map<string, string>();
    const versions: SvgAutoVersion[] = index.versions.map(version => {
        const id = crypto.randomUUID();
        files.set(id, version.file);
        return {
            id,
            url: mediaUrl(version.file),
            source: version.source,
            fidelity: version.fidelity,
            pathCount: version.pathCount,
            bytes: version.bytes,
            presetNameKey: version.trial.presetNameKey,
        };
    });
    const best = versions.reduce((a, b) =>
        b.fidelity > a.fidelity || (b.fidelity === a.fidelity && b.bytes < a.bytes) ? b : a
    );
    session = { workKey, dir, files };
    return {
        result: { versions, bestId: best.id, trials: index.trials, failures: index.failures, incomplete },
        cancelled: false,
    };
}

// 変換の設定を探して変換し (ジョブ。進み具合を知らせ、取り消せる)、版の一覧を返す。前の結果は始める前に片付ける。
// 実行中に始めようとしたときは SVG_AUTO_BUSY。取り消したときは、作ったファイルを片付ける。
// 途中で失敗したとき (ワーカーのメモリ不足など) は、それまでに得た版があればそれを返し (incomplete)、無ければ失敗する
export async function runSvgAuto(jobId: string, filePath: string, request: SvgAutoRequest): Promise<SvgAutoJobResult> {
    if (activeJobId !== null) throw new Error('SVG_AUTO_BUSY');
    activeJobId = jobId;
    const normalized = normalizeRequest(request);
    discardSvgAutoResult();
    startJob(jobId);
    const workKey = newId();
    let dir: string | null = null;
    try {
        dir = sessionDir(workKey);
        const presets = builtinVectorizerPresets();
        const general = presets.find(preset => preset.id === INITIAL_VECTORIZE_PRESET_ID) ?? null;
        const init: SvgAutoWorkerInit = {
            filePath,
            dir,
            request: normalized,
            presets: presets.map(preset => ({ nameKey: preset.nameKey ?? null, params: preset.params })),
            grayStart: {
                nameKey: general?.nameKey ?? null,
                params: general?.params ?? DEFAULT_VECTORIZE_PARAMS,
            },
        };
        let result: VersionIndex | null;
        try {
            result = await runWorkerJob<SvgAutoProgress, VersionIndex>(jobId, {
                script: 'svg-auto-worker.js',
                workerData: init,
                onProgress: progress => emitProgress(jobId, progress),
                runInProcess: async hooks => {
                    const { autoConvert } = await import('./auto-convert');
                    return autoConvert(init, hooks);
                },
            });
        } catch (error) {
            if (isCancelled(jobId)) throw error;
            const saved = await readVersionIndex(dir);
            if (!saved || saved.versions.length === 0) throw error;
            console.warn('svg-auto: stopped early, returning the versions found so far', error);
            return publish(saved, true, dir, workKey);
        }
        if (result === null || isCancelled(jobId)) {
            removeSession(workKey);
            return { result: null, cancelled: true };
        }
        return publish(result, false, dir, workKey);
    } catch (error) {
        if (dir) forgetMediaUnder(dir);
        removeSession(workKey);
        if (isCancelled(jobId)) return { result: null, cancelled: true };
        throw error;
    } finally {
        finishJob(jobId);
        activeJobId = null;
    }
}

// 版 (versionId) のファイルを保存先へ写す
export async function saveSvgAutoVersion(versionId: string, filePath: string): Promise<void> {
    const file = session?.files.get(versionId);
    if (!file) throw new Error('SVG_RESULT_GONE');
    await fs.copyFile(file, filePath);
}
