import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, startJob } from '../job-manager';
import { extractSamples, requireRubberband, timeStretch } from './audio-tools';
import { isItemInstalled } from './library';
import { mediaRef } from './media';
import { modelPaths } from './paths';
import { getWorker } from './python-worker';
import { withGpu } from './gpu-lock';
import { forwardPhase, voicePhase } from './job-progress';
import { TTS_BERT_DIRS } from './spec';
import { getVoice, ttsModelFiles } from './voice-models';
import { newId, discardLater, sessionDir } from '../work-dir';
import { parseControlTags, type SpeechRun, type TagFix, type TagIssue } from '../../../shared/voice/control-tags';
import {
    applySymbolReadings,
    LANGUAGE_DEFINITIONS,
    TTS_LANGUAGE_MODEL_ITEMS,
    type VoiceLanguage,
} from '../../../shared/voice/languages';
import { validateTimedLines } from '../../../shared/voice/timed-text';
import { voiceDisplayName } from '../../../shared/voice/voice-name';
import type {
    SpeedupConfirmation,
    TimelineOverflowMode,
    TtsParams,
    TtsRunRequest,
    TtsRunResult,
} from '../../../shared/voice/types';

// 読み上げ。制御タグを解析して合成の単位 (話速・音の高さ・音量ごとの区切りと間) に分け、Python で合成する。
// タイミング指定では行ごとに合成して開始時間に配置し、1 本の音声にまとめる。

// タイミング指定の 1 行 (index は 1 始まりの行の番号。fit はその行の fit タグで指定した、収まらない場合の扱い)
type TimelineCue = { index: number; start: number; end: number; text: string; fit?: TimelineOverflowMode };

// 行の時間内に収めるための話速の倍率の閾値。超える行がある場合は一覧を示して 1 回だけ確認する
const SPEEDUP_CONFIRM_THRESHOLD = 1.3;

type SpeechPart =
    | { text: string }
    | { surface: string; kataTone: [string, number][]; reading: string }
    | { surface: string; words: string[][] }
    | { surface: string; pinyin: [string, number][] };

type Piece =
    | { kind: 'speech'; parts: SpeechPart[]; rate: number; pitch: number; volume: number }
    | { kind: 'silence'; ms: number };

type Segment = { id: string; pieces: Piece[] };

// 合成した区間。parts は声と無音 (間) の位置 (サンプル単位)
type SegmentPart = { kind: 'speech' | 'silence'; start: number; frames: number };
type SegmentResult = { id: string; path: string; duration: number; sampleRate: number; parts: SegmentPart[] };

// 合成の単位から、話速・音の高さ・音量が同じ並びをまとめた区切り (piece) を作る。
// paragraphs = true のときは改行で段落 (別の segment) に分ける
// 文章の改行 (改行の文字と、改行を表す置き換え表記)
const LINE_BREAK_SOURCE = /\n|&#0*10;|&#[xX]0*[aA];/g;

function buildSegments(
    runs: SpeechRun[],
    language: VoiceLanguage,
    readSymbols: boolean,
    request: TtsRunRequest,
    paragraphs: boolean,
    // 段落ごとの、元の文章での開始位置 (段落に分ける場合に、誤りの位置を示すために使う)
    starts?: number[]
): Piece[][] {
    const groups: Piece[][] = [[]];
    starts?.push(0);
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
    // 改行をまたいだ単語がつながらないよう、単語を空白で区切る言語では改行を空白にする
    const joiner = LANGUAGE_DEFINITIONS[language].spaceAroundReading ? ' ' : '';
    for (const run of runs) {
        if (run.kind === 'break') {
            current().push({ kind: 'silence', ms: run.ms });
            continue;
        }
        if (run.kind === 'text') {
            const text = readSymbols ? applySymbolReadings(run.text, language, request.symbolReadings) : run.text;
            const lines = text.split('\n');
            // 改行の元の文章での位置 (改行は置き換え表記 &#10; などで書かれていることもある)
            const breaks = [...request.text.slice(run.start, run.end).matchAll(LINE_BREAK_SOURCE)];
            lines.forEach((line, index) => {
                if (index > 0) {
                    if (paragraphs) {
                        groups.push([]);
                        const source = breaks[index - 1];
                        starts?.push(source ? run.start + source.index + source[0].length : run.end);
                    } else if (joiner) addPart({ text: joiner }, run.prosody);
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
            addPart({ surface: run.surface.trim(), kataTone: run.kataTone, reading: run.reading }, run.prosody);
        } else if (run.alphabet === 'x-pinyin') {
            addPart({ surface: run.surface.trim(), pinyin: run.pinyin }, run.prosody);
        } else {
            addPart({ surface: run.surface.trim(), words: run.words }, run.prosody);
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
    discardLater(pending.dir);
}

// 確認を済ませた再実行で、確認を求めたときの合成結果を受け取る。確認 ID に対応する結果が無い場合と、
// 依頼が確認を求めたときから変わっている場合は続きから処理できない (変わっていた場合は残っている結果を消す)
async function takePendingTimeline(token: string, key: string): Promise<PendingTimeline> {
    const pending = pendingTimelines.get(token);
    if (!pending) throw new Error('TTS_CONFIRMATION_EXPIRED');
    pendingTimelines.delete(token);
    if (pending.key !== key) {
        discardLater(pending.dir);
        throw new Error('TTS_CONFIRMATION_EXPIRED');
    }
    return pending;
}

type ResolvedModel = {
    weights: string;
    config: string;
    style: string;
    sampleRate: number;
    // 話者の番号 (画面で選ぶ話者の順。モデルの番号は連続していないことがある)
    speakerIds: number[];
    voiceName: string;
};

// 設定値の範囲 (画面の入力欄と同じ範囲。範囲外の値では作成を始めない)
const PARAM_RANGES: Record<Exclude<keyof TtsParams, 'style' | 'speakerId'>, [number, number]> = {
    styleWeight: [0, 10],
    speed: [0.5, 2],
    pitchScale: [0.7, 1.3],
    intonationScale: [0, 2],
    sdpRatio: [0, 1],
    noise: [0, 2],
    noiseW: [0, 2],
    paragraphPause: [0, 3],
};

function checkParams(params: TtsParams): void {
    for (const [key, [min, max]] of Object.entries(PARAM_RANGES)) {
        const value = params[key as keyof typeof PARAM_RANGES];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
            throw new Error(`TTS_PARAMS_INVALID: ${key}`);
        }
    }
    if (!Number.isInteger(params.speakerId) || params.speakerId < 0) throw new Error('TTS_PARAMS_INVALID: speakerId');
    if (typeof params.style !== 'string') throw new Error('TTS_PARAMS_INVALID: style');
}

function resolveModel(request: TtsRunRequest): ResolvedModel {
    if (!isItemInstalled('component:tts')) throw new Error('TTS_NOT_INSTALLED');
    const voice = getVoice('tts', request.voiceId);
    const meta = voice.info.tts;
    if (!meta) throw new Error('VOICE_NOT_FOUND');
    if (meta.modelType !== request.modelType) throw new Error('TTS_MODEL_TYPE_MISMATCH');
    if (!meta.languages.includes(request.language)) throw new Error('TTS_LANGUAGE_UNSUPPORTED');
    if (request.modelType === 'jp-extra' && request.language !== 'ja') throw new Error('TTS_LANGUAGE_UNSUPPORTED');
    // 読み上げには、読み上げる言語の BERT モデルだけを使う (声の形式によらない)
    const requiredItem = TTS_LANGUAGE_MODEL_ITEMS[request.language];
    if (!isItemInstalled(requiredItem)) throw new Error(`MODEL_REQUIRED: ${requiredItem}`);
    const files = ttsModelFiles(voice);
    const config = readModelConfig(files.config);
    if (request.params.speakerId >= Math.max(config.speakerIds.length, 1)) {
        throw new Error('TTS_PARAMS_INVALID: speakerId');
    }
    return {
        ...files,
        ...config,
        voiceName: voiceDisplayName(voice.info),
    };
}

type ModelConfigJson = { data?: { sampling_rate?: unknown; spk2id?: unknown } } | null;

// モデルの設定 (config.json) から、出力する音声のサンプリング周波数 (data.sampling_rate) と、
// 話者の番号 (data.spk2id の番号を小さい順に。画面の話者の一覧と同じ順) を読む
function readModelConfig(configPath: string): { sampleRate: number; speakerIds: number[] } {
    let config: ModelConfigJson;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ModelConfigJson;
    } catch (error) {
        throw new Error(`INVALID_TTS_MODEL: ${configPath}`, { cause: error });
    }
    const sampleRate = config?.data?.sampling_rate;
    if (typeof sampleRate !== 'number' || !(sampleRate > 0)) throw new Error(`INVALID_TTS_MODEL: ${configPath}`);
    const spk2id = config?.data?.spk2id;
    const speakerIds =
        spk2id && typeof spk2id === 'object'
            ? Object.values(spk2id)
                  .filter((value): value is number => typeof value === 'number')
                  .sort((a, b) => a - b)
            : [];
    return { sampleRate, speakerIds };
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
                modelType: request.modelType,
                berts: {
                    ja: models.file(TTS_BERT_DIRS.ja),
                    en: models.file(TTS_BERT_DIRS.en),
                    zh: models.file(TTS_BERT_DIRS.zh),
                },
                model: { weights: model.weights, config: model.config, style: model.style },
                // 画面で選んだ話者の順をモデルの話者の番号にする
                params: { ...request.params, speakerId: model.speakerIds[request.params.speakerId] ?? 0 },
                segments,
                outputDir,
            },
            {
                jobId,
                onEvent: event => {
                    if (event.kind === 'progress' && typeof event.fraction === 'number') progress(event.fraction);
                    else forwardPhase(jobId, event);
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
    await worker.request(
        'assemble',
        { sampleRate: model.sampleRate, placements, output, minDuration },
        { jobId, onEvent: event => forwardPhase(jobId, event) }
    );
}

// 読み上げる文字があるか (補助プロセスの _speakable と同じ判定: 文字か数字を含むか)
function isSpeakable(piece: Piece): boolean {
    if (piece.kind !== 'speech') return false;
    return piece.parts.some(part => /[\p{L}\p{N}]/u.test('text' in part ? part.text : part.surface));
}

// 区間の中の間 (break) の長さ (秒)
function silenceSeconds(segment: Segment): number {
    return segment.pieces.reduce((sum, piece) => sum + (piece.kind === 'silence' ? piece.ms / 1000 : 0), 0);
}

// 合成できないほど長かった区間 (補助プロセスの TTS_SEGMENT_TOO_LONG) の ID。それ以外の失敗は null
function tooLongSegment(error: unknown): string | null {
    const match = /TTS_SEGMENT_TOO_LONG:\s*(\S+)/.exec(error instanceof Error ? error.message : String(error));
    return match ? match[1] : null;
}

// 文章の段落 (元の文章での開始位置と終わりの位置) 全体を指す誤り。段落はタグの中の改行で文章の複数の行にまたがることがある
function paragraphIssue(text: string, start: number, end: number, code: TagIssue['code']): TagIssue {
    const body = text.slice(start, end).replace(/(?:\n|&#0*10;|&#[xX]0*[aA];)$/, '');
    const line = text.slice(0, start).split('\n').length;
    const column = start - (text.lastIndexOf('\n', start - 1) + 1) + 1;
    return { code, offset: start, length: Math.max(1, body.length), line, column };
}

// 読み上げる文字が無いことを、文章 (または表の行) の先頭の誤りとして返す
function nothingToRead(row?: number): TagIssue {
    return { code: 'nothingToRead', offset: 0, length: 1, line: 1, column: 1, ...(row ? { row } : {}) };
}

// 合成した区間を、行の時間に収まるよう時間伸縮で縮める。間 (break) を含む区間は、声の部分だけを同じ倍率で縮めて
// 間はそのままの長さで挟み直す (間の長さを保つため)。間だけで行の時間を超える区間と、間の無い区間は全体を縮める
async function fitIntoSlot(
    jobId: string,
    model: ResolvedModel,
    result: SegmentResult,
    slot: number
): Promise<SegmentResult> {
    const folder = path.dirname(result.path);
    const output = path.join(folder, `${result.id}-fit.wav`);
    const rate = result.sampleRate;
    const silence = result.parts.filter(part => part.kind === 'silence').reduce((sum, part) => sum + part.frames, 0);
    const speech = result.parts.filter(part => part.kind === 'speech').reduce((sum, part) => sum + part.frames, 0);
    const available = slot - silence / rate;
    if (silence === 0 || speech === 0 || available <= 0.05) {
        await timeStretch(result.path, output, result.duration / slot, jobId);
        return { ...result, path: output, duration: slot };
    }
    const tempo = speech / rate / available;
    const placements: { path: string; start: number }[] = [];
    let cursor = 0;
    for (const [index, part] of result.parts.entries()) {
        if (part.kind === 'silence') {
            cursor += part.frames / rate;
            continue;
        }
        const piece = path.join(folder, `${result.id}-part${index}.wav`);
        const stretched = path.join(folder, `${result.id}-part${index}-fit.wav`);
        await extractSamples(result.path, piece, part.start, part.frames, jobId);
        await timeStretch(piece, stretched, tempo, jobId);
        placements.push({ path: stretched, start: cursor });
        cursor += part.frames / tempo / rate;
    }
    await assemble(jobId, model, placements, output, slot);
    return { ...result, path: output, duration: Math.max(slot, cursor) };
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
        checkParams(request.params);
        const model = resolveModel(request);
        const id = newId();
        const dir = sessionDir(request.workKey, 'tts', id);
        // 作成した音声を返す (確認待ちを含む) とき以外 (入力の誤り・失敗・キャンセル) は、作りかけの結果をその場で消す
        let keep = false;
        try {
            const result = await synthesizeInto(jobId, request, model, id, dir);
            keep = result.status !== 'invalid';
            return result;
        } finally {
            if (!keep) discardLater(dir);
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
    voicePhase(jobId, 'prepare');

    if (request.inputMode === 'normal') {
        const parsed = parseControlTags(request.text, { language: request.language });
        if (parsed.errors.length > 0 || parsed.fixes.length > 0) return invalid(parsed.errors, parsed.fixes);
        // 音の無い段落 (空行・末尾の改行・読み上げる文字の無い段落) は除く。段落の間の無音は、音のある段落の間にだけ入れる。
        // 段落は文章の改行で分ける (start・end: 元の文章での段落の範囲。長すぎる段落を示すときに使う)
        const starts: number[] = [];
        const groups = buildSegments(parsed.runs, request.language, request.readSymbols, request, true, starts)
            .map((pieces, index) => ({
                pieces,
                start: starts[index] ?? 0,
                end: starts[index + 1] ?? request.text.length,
            }))
            .filter(group => group.pieces.some(piece => piece.kind === 'silence' || isSpeakable(piece)));
        if (groups.length === 0) return invalid([nothingToRead()], []);
        const segments = groups.map((group, index) => ({
            id: `p${String(index + 1).padStart(4, '0')}`,
            pieces: group.pieces,
        }));
        let results: SegmentResult[];
        try {
            results = await synthesize(jobId, request, model, segments, path.join(dir, 'parts'), fraction =>
                progress(fraction * 90)
            );
        } catch (error) {
            // 合成できないほど長い段落は、その段落を示して改行で分けてもらう (アプリでは分けない)
            const tooLong = tooLongSegment(error);
            const index = segments.findIndex(segment => segment.id === tooLong);
            if (index < 0) throw error;
            const group = groups[index];
            return invalid([paragraphIssue(request.text, group.start, group.end, 'paragraphTooLong')], []);
        }
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
        discardLater(path.join(dir, 'parts'));
        progress(100);
        return {
            status: 'done',
            audio: {
                id,
                voiceId: request.voiceId,
                voiceName: model.voiceName,
                modelType: request.modelType,
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
        // 時間とテキストは画面で確かめてから渡される。ここでも確かめ、誤りがあれば始めない
        if (request.lines.length === 0) throw new Error('TTS_TIMING_EMPTY');
        const timingIssues = validateTimedLines(request.lines);
        if (timingIssues.length > 0) {
            // 利用者には誤りのある行の番号を示す (誤りの内容は画面の表で示す)
            const rows = [...new Set(timingIssues.map(issue => issue.row))].sort((a, b) => a - b);
            throw new Error(`TTS_TIMING_INVALID: ${rows.join(', ')}`);
        }
        const cues: TimelineCue[] = request.lines.map((line, index) => ({ index: index + 1, ...line }));
        const errors: TagIssue[] = [];
        const fixes: TagFix[] = [];
        const segments: Segment[] = [];
        for (const cue of cues) {
            // 誤りの位置は、その行のテキストの中の位置と行の番号で示す
            const parsed = parseControlTags(cue.text, { language: request.language, timed: true });
            cue.fit = parsed.fit;
            errors.push(...parsed.errors.map(issue => ({ ...issue, row: cue.index })));
            fixes.push(...parsed.fixes.map(fix => ({ ...fix, row: cue.index })));
            const pieces = buildSegments(parsed.runs, request.language, request.readSymbols, request, false)[0];
            if (parsed.errors.length === 0 && !pieces.some(isSpeakable)) errors.push(nothingToRead(cue.index));
            segments.push({ id: `c${String(cue.index).padStart(4, '0')}`, pieces });
        }
        if (errors.length > 0 || fixes.length > 0) return invalid(errors, fixes);
        // 話速を上げて収める行 (全体の設定、または行の fit タグ) があれば、微調整に使う rubberband の有無を
        // 合成を始める前に確かめる (合成や確認の後で失敗しないため)
        if (cues.some(cue => (cue.fit ?? request.overflowMode) === 'speedup')) await requireRubberband();
        try {
            return await placeTimeline(jobId, request, key, model, id, dir, output, progress, cues, segments, pending);
        } catch (error) {
            // 合成できないほど長い行は、その行を示して分けてもらう (区間の ID は c<行の番号>、話速を上げた合成は -fast 付き)
            const match = /^c(\d+)/.exec(tooLongSegment(error) ?? '');
            if (!match) throw error;
            const row = Number(match[1]);
            return invalid([{ code: 'rowTooLong', offset: 0, length: 1, line: 1, column: 1, row }], []);
        }
    } finally {
        // 確認を求めたときの合成結果は、続きの処理が終われば成否を問わず不要になる
        if (pending) discardLater(pending.dir);
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
    cues: TimelineCue[],
    segments: Segment[],
    pending: PendingTimeline | undefined
): Promise<TtsRunResult> {
    const modeOf = (cue: TimelineCue): TimelineOverflowMode => cue.fit ?? request.overflowMode;
    // 進み具合の割り当て: 話速を上げる区間がありうる場合は 1 回目を 60% まで、無ければ 1 回目でほぼすべて
    const firstShare = cues.some(cue => modeOf(cue) === 'speedup') ? 60 : 95;

    // 1 回目: すべての区間を指定どおりの話速で合成する (確認を済ませた再実行では、確認を求めたときの結果を使う)
    let first: SegmentResult[];
    if (pending) {
        first = pending.results;
        progress(firstShare);
    } else {
        first = await synthesize(jobId, request, model, segments, path.join(dir, 'first'), fraction =>
            progress(fraction * firstShare)
        );
    }
    // 話速の倍率は、間 (break) の無音を除いた声の部分で求める (間の長さは保つ)。
    // 間だけで行の時間を超える場合は、行全体を縮める倍率にする
    const speedups = cues
        .map((cue, index) => {
            const result = first[index];
            const slot = Math.max(0.05, cue.end - cue.start);
            const silence = silenceSeconds(segments[index]);
            const factor =
                slot - silence > 0.05 ? (result.duration - silence) / (slot - silence) : result.duration / slot;
            return { cue, index, result, slot, factor };
        })
        .filter(item => modeOf(item.cue) === 'speedup' && item.result.duration > item.slot + 0.005);

    const needsConfirm = speedups.filter(item => item.factor > SPEEDUP_CONFIRM_THRESHOLD);
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
                factor: item.factor,
            })),
        };
        return { status: 'needsConfirmation', confirmation };
    }

    // 2 回目: 収まらない区間を話速を上げて合成し直し、残ったわずかな差を時間伸縮で詰める
    const finalResults = [...first];
    const adjusted: { index: number; factor: number }[] = [];
    if (speedups.length > 0) {
        const faster = await synthesize(
            jobId,
            request,
            model,
            speedups.map(item => speedUp(segments[item.index], item.factor)),
            path.join(dir, 'fast'),
            fraction => progress(60 + fraction * 25)
        );
        // 間 (break) を含む行は、話速を上げても声の部分がまだ長い (ライブラリの話速が倍率どおりに速くならない) 場合、
        // 足りない分だけ倍率を上げて合成し直す。残りを時間伸縮で詰めると間も一緒に縮むため、詰める量を小さくする
        const retry = speedups
            .map((item, i) => {
                const silence = silenceSeconds(segments[item.index]);
                const available = item.slot - silence;
                const speech = faster[i].duration - silence;
                return {
                    i,
                    factor: item.factor * (speech / available),
                    needed: silence > 0 && available > 0.05 && speech > available * 1.01,
                };
            })
            .filter(entry => entry.needed);
        if (retry.length > 0) {
            const again = await synthesize(
                jobId,
                request,
                model,
                retry.map(entry => speedUp(segments[speedups[entry.i].index], entry.factor)),
                path.join(dir, 'fast2'),
                fraction => progress(85 + fraction * 5)
            );
            retry.forEach((entry, k) => {
                faster[entry.i] = again[k];
                speedups[entry.i] = { ...speedups[entry.i], factor: entry.factor };
            });
        }
        progress(90);
        voicePhase(jobId, 'stretch', { fraction: 0 });
        for (let i = 0; i < speedups.length; i++) {
            const item = speedups[i];
            let result = faster[i];
            if (result.duration > item.slot + 0.005) result = await fitIntoSlot(jobId, model, result, item.slot);
            finalResults[item.index] = result;
            adjusted.push({ index: item.cue.index, factor: item.factor });
            voicePhase(jobId, 'stretch', { fraction: (i + 1) / speedups.length });
            progress(90 + ((i + 1) / speedups.length) * 5);
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
    for (const sub of ['first', 'fast', 'fast2']) discardLater(path.join(dir, sub));
    progress(100);
    return {
        status: 'done',
        audio: {
            id,
            voiceId: request.voiceId,
            voiceName: model.voiceName,
            modelType: request.modelType,
            language: request.language,
            params: request.params,
            media: await mediaRef(output),
            adjusted,
            overflows,
            createdAt: Date.now(),
        },
    };
}
