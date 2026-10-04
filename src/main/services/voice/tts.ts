import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { requireRubberband, timeStretch } from './audio-tools';
import { isItemInstalled } from './library';
import { mediaRef } from './media';
import { modelPaths } from './paths';
import { getWorker } from './python-worker';
import { withGpu } from './gpu-lock';
import { TTS_BERT_DIRS, TTS_ENGINE_ITEMS } from './spec';
import { getVoice, ttsModelFiles } from './voice-models';
import { newId, removeTemp, sessionDir } from '../work-dir';
import { parseControlTags, type SpeechRun, type TagFix, type TagIssue } from '../../../shared/voice/control-tags';
import { applySymbolReadings, type VoiceLanguage } from '../../../shared/voice/languages';
import { parseSubtitles, type SubtitleCue } from '../../../shared/voice/subtitles';
import type {
    SpeedupConfirmation,
    TimelineOverflowMode,
    TtsRunRequest,
    TtsRunResult,
} from '../../../shared/voice/types';

// 読み上げ。制御タグを解析して合成の単位 (話速・音高・音量ごとの区切りと間) に分け、Python で合成する。
// タイムライン (SRT / WebVTT) では区間ごとに合成して開始時刻に配置し、1 本の音声にまとめる。

// 区間に収めるための話速の倍率の閾値。超える区間がある場合は一覧を示して 1 回だけ確認する
const SPEEDUP_CONFIRM_THRESHOLD = 1.3;

type SpeechPart =
    | { text: string }
    | { surface: string; kataTone: [string, number][]; reading: string }
    | { surface: string; words: string[][] };

type Piece =
    | { kind: 'speech'; parts: SpeechPart[]; rate: number; pitch: number; volume: number }
    | { kind: 'silence'; ms: number };

type Segment = { id: string; pieces: Piece[] };

type SegmentResult = { id: string; path: string; duration: number };

// 合成の単位から、話速・音高・音量が同じ並びをまとめた区切り (piece) を作る。
// paragraphs = true のときは改行で段落 (別の segment) に分ける
function buildSegments(
    runs: SpeechRun[],
    language: VoiceLanguage,
    readSymbols: boolean,
    request: TtsRunRequest,
    paragraphs: boolean
): Piece[][] {
    const groups: Piece[][] = [[]];
    const current = () => groups[groups.length - 1];
    const addPart = (part: SpeechPart, prosody: { rate: number; pitch: number; volume: number }) => {
        const pieces = current();
        const last = pieces[pieces.length - 1];
        if (
            last &&
            last.kind === 'speech' &&
            last.rate === prosody.rate &&
            last.pitch === prosody.pitch &&
            last.volume === prosody.volume
        ) {
            last.parts.push(part);
        } else {
            pieces.push({ kind: 'speech', parts: [part], ...prosody });
        }
    };
    const joiner = language === 'en' ? ' ' : '';
    for (const run of runs) {
        if (run.kind === 'break') {
            current().push({ kind: 'silence', ms: run.ms });
            continue;
        }
        if (run.kind === 'text') {
            const text = readSymbols ? applySymbolReadings(run.text, language, request.symbolReadings) : run.text;
            const lines = text.split('\n');
            lines.forEach((line, index) => {
                if (index > 0) {
                    if (paragraphs) groups.push([]);
                    else if (joiner) addPart({ text: joiner }, run.prosody);
                }
                if (line.length > 0) addPart({ text: line }, run.prosody);
            });
            continue;
        }
        if (run.kind === 'sub') {
            addPart({ text: run.alias }, run.prosody);
            continue;
        }
        if (run.alphabet === 'x-kana') {
            addPart({ surface: run.surface, kataTone: run.kataTone, reading: run.reading }, run.prosody);
        } else {
            addPart({ surface: run.surface, words: run.words }, run.prosody);
        }
    }
    return groups;
}

// 再実行 (話速の確認後) のために残しておく 1 回目の合成結果
type PendingTimeline = {
    // 確認を求めた依頼の鍵 (requestKey)
    key: string;
    results: SegmentResult[];
    dir: string;
};

const pendingTimelines = new Map<string, PendingTimeline>();

// 確認の前後で同じ依頼かを判定する鍵 (確認 ID 自体は含めない)
function requestKey(request: TtsRunRequest): string {
    const rest: Partial<TtsRunRequest> = { ...request };
    delete rest.confirmationToken;
    return crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex');
}

export function cancelTtsConfirmation(token: string): void {
    const pending = pendingTimelines.get(token);
    if (!pending) return;
    pendingTimelines.delete(token);
    void removeTemp(pending.dir);
}

// 確認を済ませた再実行で、確認を求めたときの合成結果を受け取る。確認 ID に対応する結果が無い場合と、
// 依頼が確認を求めたときから変わっている場合は続きから処理できない (変わっていた場合は残っている結果を消す)
async function takePendingTimeline(token: string, key: string): Promise<PendingTimeline> {
    const pending = pendingTimelines.get(token);
    if (!pending) throw new Error('TTS_CONFIRMATION_EXPIRED');
    pendingTimelines.delete(token);
    if (pending.key !== key) {
        await removeTemp(pending.dir);
        throw new Error('TTS_CONFIRMATION_EXPIRED');
    }
    return pending;
}

type ResolvedModel = {
    weights: string;
    config: string;
    style: string;
    sampleRate: number;
    voiceName: string;
};

function resolveModel(request: TtsRunRequest): ResolvedModel {
    if (!isItemInstalled('component:tts')) throw new Error('TTS_NOT_INSTALLED');
    const voice = getVoice('tts', request.voiceId);
    const meta = voice.info.tts;
    if (!meta) throw new Error('VOICE_NOT_FOUND');
    if (meta.engine !== request.engine) throw new Error('TTS_ENGINE_MISMATCH');
    if (!meta.languages.includes(request.language)) throw new Error('TTS_LANGUAGE_UNSUPPORTED');
    if (request.engine === 'jp-extra' && request.language !== 'ja') throw new Error('TTS_LANGUAGE_UNSUPPORTED');
    const requiredItem = request.language === 'ja' ? TTS_ENGINE_ITEMS['jp-extra'] : TTS_ENGINE_ITEMS.multilingual;
    if (!isItemInstalled(requiredItem)) throw new Error(`TTS_ENGINE_NOT_INSTALLED: ${request.engine}`);
    const files = ttsModelFiles(voice);
    return {
        ...files,
        sampleRate: readSampleRate(files.config),
        voiceName: voice.info.name || voice.info.presetName || '',
    };
}

// モデルが出力する音声のサンプリング周波数 (config.json の data.sampling_rate)
function readSampleRate(configPath: string): number {
    let config: { data?: { sampling_rate?: unknown } } | null;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { data?: { sampling_rate?: unknown } } | null;
    } catch (error) {
        throw new Error(`INVALID_TTS_MODEL: ${configPath}`, { cause: error });
    }
    const sampleRate = config?.data?.sampling_rate;
    if (typeof sampleRate !== 'number' || !(sampleRate > 0)) throw new Error(`INVALID_TTS_MODEL: ${configPath}`);
    return sampleRate;
}

async function synthesize(
    jobId: string,
    request: TtsRunRequest,
    model: ResolvedModel,
    segments: Segment[],
    outputDir: string,
    progress: (fraction: number) => void
): Promise<SegmentResult[]> {
    fs.mkdirSync(outputDir, { recursive: true });
    const models = modelPaths();
    const worker = getWorker('tts');
    const result = await withGpu(jobId, 'tts', () =>
        worker.request<{ segments: SegmentResult[] }>(
            'synthesize',
            {
                language: request.language,
                engine: request.engine,
                berts: {
                    ja: models.file(TTS_BERT_DIRS.ja),
                    en: models.file(TTS_BERT_DIRS.en),
                },
                model: { weights: model.weights, config: model.config, style: model.style },
                params: request.params,
                segments,
                outputDir,
            },
            {
                jobId,
                onEvent: event => {
                    if (event.kind === 'progress' && typeof event.fraction === 'number') progress(event.fraction);
                },
            }
        )
    );
    return result.segments;
}

async function assemble(
    jobId: string,
    model: ResolvedModel,
    placements: { path: string; start: number }[],
    output: string,
    minDuration: number
): Promise<void> {
    const worker = getWorker('tts');
    await worker.request('assemble', { sampleRate: model.sampleRate, placements, output, minDuration }, { jobId });
}

// 話速を上げた合成の設定 (制御タグで話速を指定している区間は、その指定に倍率を掛ける)
function speedUp(segment: Segment, factor: number): Segment {
    return {
        id: `${segment.id}-fast`,
        pieces: segment.pieces.map(piece =>
            piece.kind === 'speech' ? { ...piece, rate: piece.rate * factor } : piece
        ),
    };
}

function invalid(errors: TagIssue[], fixes: TagFix[]): TtsRunResult {
    return { status: 'invalid', errors, fixes };
}

export async function runTts(jobId: string, request: TtsRunRequest): Promise<TtsRunResult> {
    startJob(jobId);
    try {
        const model = resolveModel(request);
        const id = newId();
        const dir = sessionDir(request.workKey, 'tts', id);
        // 候補を返す (確認待ちを含む) とき以外 (入力の誤り・失敗・キャンセル) は、作りかけの結果をその場で消す
        let keep = false;
        try {
            const result = await synthesizeInto(jobId, request, model, id, dir);
            keep = result.status !== 'invalid';
            return result;
        } finally {
            if (!keep) await removeTemp(dir);
        }
    } finally {
        finishJob(jobId);
    }
}

async function synthesizeInto(
    jobId: string,
    request: TtsRunRequest,
    model: ResolvedModel,
    id: string,
    dir: string
): Promise<TtsRunResult> {
    const output = path.join(dir, 'output.wav');
    const progress = (percent: number) => emitJobEvent({ jobId, kind: 'progress', percent });

    if (request.inputKind === 'text') {
        const parsed = parseControlTags(request.text, { language: request.language });
        if (parsed.errors.length > 0 || parsed.fixes.length > 0) return invalid(parsed.errors, parsed.fixes);
        const groups = buildSegments(parsed.runs, request.language, request.readSymbols, request, true);
        const segments = groups.map((pieces, index) => ({ id: `p${String(index + 1).padStart(4, '0')}`, pieces }));
        const results = await synthesize(jobId, request, model, segments, path.join(dir, 'parts'), fraction =>
            progress(fraction * 90)
        );
        const placements: { path: string; start: number }[] = [];
        let cursor = 0;
        results.forEach((result, index) => {
            if (result.duration > 0) {
                placements.push({ path: result.path, start: cursor });
                cursor += result.duration;
            }
            if (index < results.length - 1) cursor += request.params.paragraphPause;
        });
        await assemble(jobId, model, placements, output, cursor);
        await removeTemp(path.join(dir, 'parts'));
        progress(100);
        return {
            status: 'done',
            candidate: {
                id,
                voiceId: request.voiceId,
                voiceName: model.voiceName,
                engine: request.engine,
                language: request.language,
                params: request.params,
                media: await mediaRef(output),
                adjusted: [],
                overflows: [],
                createdAt: Date.now(),
            },
        };
    }
    return await runTimeline(jobId, request, model, id, dir, output, progress);
}

async function runTimeline(
    jobId: string,
    request: TtsRunRequest,
    model: ResolvedModel,
    id: string,
    dir: string,
    output: string,
    progress: (percent: number) => void
): Promise<TtsRunResult> {
    const key = requestKey(request);
    // 確認を済ませた再実行では、確認を求めたときの合成結果 (1 回目の合成) を使う
    const pending = request.confirmationToken ? await takePendingTimeline(request.confirmationToken, key) : undefined;
    try {
        const subtitles = parseSubtitles(request.text, request.inputKind === 'vtt' ? 'vtt' : 'srt');
        if (subtitles.errors.length > 0) return invalid(subtitles.errors, []);
        const cues = subtitles.cues;
        const errors: TagIssue[] = [];
        const fixes: TagFix[] = [];
        const segments: Segment[] = [];
        for (const cue of cues) {
            const parsed = parseControlTags(cue.text, {
                language: request.language,
                baseOffset: cue.textOffset,
                documentText: request.text,
            });
            errors.push(...parsed.errors);
            fixes.push(...parsed.fixes);
            const pieces = buildSegments(parsed.runs, request.language, request.readSymbols, request, false)[0];
            segments.push({ id: `c${String(cue.index).padStart(4, '0')}`, pieces });
        }
        if (errors.length > 0 || fixes.length > 0) return invalid(errors, fixes);
        return await placeTimeline(jobId, request, key, model, id, dir, output, progress, cues, segments, pending);
    } finally {
        // 確認を求めたときの合成結果は、続きの処理が終われば成否を問わず不要になる
        if (pending) await removeTemp(pending.dir);
    }
}

async function placeTimeline(
    jobId: string,
    request: TtsRunRequest,
    key: string,
    model: ResolvedModel,
    id: string,
    dir: string,
    output: string,
    progress: (percent: number) => void,
    cues: SubtitleCue[],
    segments: Segment[],
    pending: PendingTimeline | undefined
): Promise<TtsRunResult> {
    // 1 回目: すべての区間を指定どおりの話速で合成する (確認を済ませた再実行では、確認を求めたときの結果を使う)
    let first: SegmentResult[];
    if (pending) {
        first = pending.results;
    } else {
        first = await synthesize(jobId, request, model, segments, path.join(dir, 'first'), fraction =>
            progress(fraction * 60)
        );
    }

    const modeOf = (cue: SubtitleCue): TimelineOverflowMode =>
        request.cueOverflowModes[cue.index] ?? request.overflowMode;
    const speedups = cues
        .map((cue, index) => ({ cue, index, result: first[index], slot: Math.max(0.05, cue.end - cue.start) }))
        .filter(item => modeOf(item.cue) === 'speedup' && item.result.duration > item.slot + 0.005);

    const needsConfirm = speedups.filter(item => item.result.duration / item.slot > SPEEDUP_CONFIRM_THRESHOLD);
    if (needsConfirm.length > 0 && !pending) {
        // 閾値を超える区間の一覧を示して確認する。承諾されたら、この結果を使って続きから処理する
        const token = crypto.randomUUID();
        pendingTimelines.set(token, { key, results: first, dir });
        const confirmation: SpeedupConfirmation = {
            token,
            items: needsConfirm.map(item => ({
                index: item.cue.index,
                start: item.cue.start,
                end: item.cue.end,
                text: item.cue.text,
                factor: item.result.duration / item.slot,
            })),
        };
        return { status: 'needsConfirmation', confirmation };
    }

    // 2 回目: 収まらない区間を話速を上げて合成し直し、残ったわずかな差を時間伸縮で詰める
    const finalResults = [...first];
    const adjusted: { index: number; factor: number }[] = [];
    if (speedups.length > 0) {
        await requireRubberband();
        const faster = await synthesize(
            jobId,
            request,
            model,
            speedups.map(item => speedUp(segments[item.index], item.result.duration / item.slot)),
            path.join(dir, 'fast'),
            fraction => progress(60 + fraction * 30)
        );
        for (let i = 0; i < speedups.length; i++) {
            const item = speedups[i];
            let result = faster[i];
            if (result.duration > item.slot + 0.005) {
                const stretched = path.join(dir, 'fast', `${result.id}-fit.wav`);
                await timeStretch(result.path, stretched, result.duration / item.slot, jobId);
                result = { ...result, path: stretched, duration: item.slot };
            }
            finalResults[item.index] = result;
            adjusted.push({ index: item.cue.index, factor: item.result.duration / item.slot });
        }
    }

    // 配置: 「後ろにずらす」区間があふれた分だけ、後続の区間をすべて後ろへずらす
    const placements: { path: string; start: number }[] = [];
    const overflows: { index: number; overflowSec: number }[] = [];
    let offset = 0;
    let end = 0;
    cues.forEach((cue, index) => {
        const result = finalResults[index];
        const slot = cue.end - cue.start;
        const start = cue.start + offset;
        if (result.duration > 0) placements.push({ path: result.path, start });
        const overflow = result.duration - slot;
        const mode = modeOf(cue);
        if (overflow > 0.005) {
            if (mode === 'shift') offset += overflow;
            // 「警告のみ」の区間は調整せずに配置し、実行後に一覧で知らせる
            if (mode === 'warn') overflows.push({ index: cue.index, overflowSec: overflow });
        }
        end = Math.max(end, cue.end + offset, start + result.duration);
    });
    await assemble(jobId, model, placements, output, end);
    for (const sub of ['first', 'fast']) await removeTemp(path.join(dir, sub));
    progress(100);
    return {
        status: 'done',
        candidate: {
            id,
            voiceId: request.voiceId,
            voiceName: model.voiceName,
            engine: request.engine,
            language: request.language,
            params: request.params,
            media: await mediaRef(output),
            adjusted,
            overflows,
            createdAt: Date.now(),
        },
    };
}
