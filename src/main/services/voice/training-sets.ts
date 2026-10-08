import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { encodeTrainingWav, probeAudio } from './audio-tools';
import { editSilence, normalizeLoudness, removeNoise, removeReverb } from './audio-filters';
import { nextStep, withSteps } from './job-progress';
import { discardLater, isInsideWork, newId, newTempDir, sessionDir, sessionPath } from '../work-dir';
import { mediaRef } from './media';
import type { SilenceOption, TrainingFilterOptions } from '../../../shared/voice/audio-filters';
import { getWorker } from './python-worker';
import { corpusSentences } from './corpus';
import { readJsonFile, writeJsonFile } from './json-file';
import { forgetMedia, forgetMediaUnder, mediaUrl, releaseMedia } from '../media-protocol';
import { modelPaths } from './paths';
import { discardRecording, moveRecordingTo } from './recording';
import { moveToTrash } from '../../utils/trash';
import type { VoiceLanguage } from '../../../shared/voice/languages';
import type {
    MediaRef,
    TrainingAddFilesResult,
    TrainingAudio,
    TrainingSentence,
    TrainingSetDetail,
    TrainingSetMode,
    TrainingSetSummary,
    VoiceModelFeature,
} from '../../../shared/voice/types';

// 学習セット (学習用の音声に名前を付けて残したもの)。
// 利用者が録音・用意した、作り直せないデータのため、モデルディレクトリの声のモデルとは別の場所
// <モデルディレクトリ>/audio/<conversion|tts>/training-sets/<ID>/ に置く。
// set.json に名前・言語・音声の一覧を記録し、音声は audio/<音声の ID>.wav に置く。
// 録音もファイルの指定も同じ形式 (16bit・モノラルの WAV) で保存するため、元のファイルは取り込んだ後に移動・削除してよい。
// 学習が終わっても消さない。学習セットの削除はごみ箱に移す。

const SET_FILE = 'set.json';
const AUDIO_DIR = 'audio';

type StoredAudio = {
    id: string;
    name: string;
    source: 'recording' | 'file';
    sentenceId?: string;
    durationSec: number;
    sampleRate: number;
    channels: number;
    addedAt: number;
};

// 任意の文で作成する読み上げの学習セットのグループ (音声は StoredAudio の sentenceId で結び付く)
type StoredGroup = { id: string; text: string };

type StoredSet = {
    id: string;
    feature: VoiceModelFeature;
    name: string;
    language?: VoiceLanguage;
    // 読み上げの学習セットの作り方 (無い場合はサンプル文から作成。作り方を選べるようになる前の学習セット)
    mode?: TrainingSetMode;
    // 任意の文で作成する学習セットのグループ (加えた順)
    groups?: StoredGroup[];
    createdAt: number;
    updatedAt: number;
    audios: StoredAudio[];
};

// 学習セットごとの処理中の状態。学習中・削除中は音声を変えさせず、音声の追加中と置き換え中 (学習用の音のフィルターの
// 確定・全体への適用) は学習・削除を始めさせない (途中で学習を始めると、消える前・置き換わる前の音声を学習が読むことになるため)
type SetActivity = { training: boolean; removing: boolean; adding: number };
const activities = new Map<string, SetActivity>();

function activityOf(feature: VoiceModelFeature, id: string): SetActivity {
    const key = setKey(feature, id);
    let activity = activities.get(key);
    if (!activity) {
        activity = { training: false, removing: false, adding: 0 };
        activities.set(key, activity);
    }
    return activity;
}

// 学習・削除・音声の追加・置き換えのいずれかを行っている学習セットがあるか (保存場所の移動を断るため)
function hasBusyTrainingSets(): boolean {
    return [...activities.values()].some(activity => activity.training || activity.removing || activity.adding > 0);
}

// 保存場所の移動中は、学習セットを作る・変える・使うことを断る (古い場所に書かれて移動から漏れないようにするため)
let storageMoves = 0;

export async function whileStorageMoving<T>(fn: () => Promise<T>): Promise<T> {
    if (hasBusyTrainingSets()) throw new Error('LIBRARY_BUSY');
    storageMoves += 1;
    try {
        return await fn();
    } finally {
        storageMoves -= 1;
    }
}

function checkNotMoving(): void {
    if (storageMoves > 0) throw new Error('LIBRARY_BUSY');
}

// 音声の追加中・置き換え中は、学習と削除を始めさせない
async function whileAdding<T>(feature: VoiceModelFeature, id: string, fn: () => Promise<T>): Promise<T> {
    checkNotInUse(feature, id);
    const activity = activityOf(feature, id);
    activity.adding += 1;
    try {
        return await fn();
    } finally {
        activity.adding -= 1;
    }
}

// すべての音にフィルターを適用している学習セット。その間は、音の削除と個々の音の置き換えを断る
// (適用の結果で、削除した音を作り直したり、個々に置き換えた音を上書きしたりしないため)
const filteringSets = new Set<string>();

function checkNotFiltering(feature: VoiceModelFeature, id: string): void {
    if (filteringSets.has(setKey(feature, id))) throw new Error('TRAINING_SET_IN_USE');
}

async function whileFiltering<T>(feature: VoiceModelFeature, id: string, fn: () => Promise<T>): Promise<T> {
    checkNotFiltering(feature, id);
    return whileAdding(feature, id, async () => {
        filteringSets.add(setKey(feature, id));
        try {
            return await fn();
        } finally {
            filteringSets.delete(setKey(feature, id));
        }
    });
}

function setKey(feature: VoiceModelFeature, id: string): string {
    return `${feature}:${id}`;
}

function checkSetId(id: string): string {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('INVALID_TRAINING_SET_ID');
    return id;
}

function setsDir(feature: VoiceModelFeature): string {
    return modelPaths().trainingSets(feature);
}

function setDir(feature: VoiceModelFeature, id: string): string {
    return path.join(setsDir(feature), checkSetId(id));
}

function audioPath(feature: VoiceModelFeature, setId: string, audioId: string): string {
    return path.join(setDir(feature, setId), AUDIO_DIR, `${audioId}.wav`);
}

function readSet(feature: VoiceModelFeature, id: string): StoredSet {
    const file = path.join(setDir(feature, id), SET_FILE);
    const data = readJsonFile<unknown>(file);
    if (data === null) throw new Error('TRAINING_SET_NOT_FOUND');
    if (!isStoredSet(data, feature, id)) throw new Error(`DATA_FILE_CORRUPT: ${file}`);
    return data;
}

function writeSet(data: StoredSet): void {
    writeJsonFile(path.join(setDir(data.feature, data.id), SET_FILE), data);
}

// 学習中・削除中なら断る (音声を変えさせない)
function checkNotInUse(feature: VoiceModelFeature, id: string): void {
    checkNotMoving();
    const activity = activities.get(setKey(feature, id));
    if (activity?.training || activity?.removing) throw new Error('TRAINING_SET_IN_USE');
}

// 学習・削除を始める前に、ほかの処理 (学習・削除・音声の追加) をしていないかを確かめる
function checkIdle(feature: VoiceModelFeature, id: string): void {
    checkNotMoving();
    const activity = activities.get(setKey(feature, id));
    if (activity && (activity.training || activity.removing || activity.adding > 0)) {
        throw new Error('TRAINING_SET_IN_USE');
    }
}

function isStoredSet(data: unknown, feature: VoiceModelFeature, id: string): data is StoredSet {
    const set = data as StoredSet | null;
    return !!set && set.feature === feature && set.id === id && Array.isArray(set.audios);
}

function checkName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('TRAINING_SET_NAME_EMPTY');
    return trimmed;
}

// 読み上げの学習セットの作り方 (音声変換の学習セットは undefined)
function modeOf(data: StoredSet): TrainingSetMode | undefined {
    if (!data.language) return undefined;
    return data.mode ?? 'sentences';
}

function toSummary(data: StoredSet): TrainingSetSummary {
    return {
        id: data.id,
        feature: data.feature,
        name: data.name,
        language: data.language,
        mode: modeOf(data),
        audioCount: data.audios.length,
        durationSec: data.audios.reduce((sum, audio) => sum + audio.durationSec, 0),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
    };
}

function toAudio(data: StoredSet, audio: StoredAudio): TrainingAudio {
    const file = audioPath(data.feature, data.id, audio.id);
    return {
        id: audio.id,
        name: audio.name,
        source: audio.source,
        sentenceId: audio.sentenceId,
        durationSec: audio.durationSec,
        media: {
            path: file,
            // ファイルが無くなっている場合は再生できない (学習の開始時に TRAINING_FILE_MISSING で知らせる)
            url: fs.existsSync(file) ? mediaUrl(file) : '',
            durationSec: audio.durationSec,
            channels: audio.channels,
            sampleRate: audio.sampleRate,
        },
    };
}

// 学習セットの一覧 (更新の新しい順)。記録 (set.json) の無いフォルダは学習セットとして扱わない。
// 記録が読めない学習セットは一覧から除いてログに残す (1 つが壊れていても、ほかの学習セットを使えるようにするため)
export function listTrainingSets(feature: VoiceModelFeature): TrainingSetSummary[] {
    let names: string[];
    try {
        names = fs.readdirSync(setsDir(feature));
    } catch {
        return [];
    }
    const sets: TrainingSetSummary[] = [];
    for (const name of names) {
        if (!/^[A-Za-z0-9-]+$/.test(name) || !fs.existsSync(path.join(setsDir(feature), name, SET_FILE))) continue;
        try {
            sets.push(toSummary(readSet(feature, name)));
        } catch (error) {
            console.warn(`failed to read the training set ${name}`, error);
        }
    }
    return sets.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTrainingSet(feature: VoiceModelFeature, id: string): TrainingSetDetail {
    const data = readSet(feature, id);
    return {
        summary: toSummary(data),
        audios: data.audios.map(audio => toAudio(data, audio)),
        sentences: sentencesOf(data),
    };
}

// 学習セットの文 (サンプル文から作成する学習セットは言語の学習用の文章、任意の文で作成する学習セットはグループ)
function sentencesOf(data: StoredSet): TrainingSentence[] {
    if (!data.language) return [];
    if (modeOf(data) === 'custom') return (data.groups ?? []).map(group => ({ id: group.id, text: group.text }));
    return corpusSentences(data.language);
}

export function createTrainingSet(
    feature: VoiceModelFeature,
    name: string,
    language?: VoiceLanguage,
    mode?: TrainingSetMode
): TrainingSetSummary {
    // 読み上げの学習セットは言語と作り方を 1 つずつ持ち、音声変換の学習セットはどちらも持たない
    if ((feature === 'tts') !== (language !== undefined)) throw new Error('TRAINING_SET_LANGUAGE_MISMATCH');
    if (feature !== 'tts' && mode !== undefined) throw new Error('TRAINING_SET_LANGUAGE_MISMATCH');
    checkNotMoving();
    const now = Date.now();
    const tts = feature === 'tts';
    const data: StoredSet = {
        id: crypto.randomUUID(),
        feature,
        name: checkName(name),
        language,
        ...(tts ? { mode: mode ?? 'sentences' } : {}),
        ...(tts && mode === 'custom' ? { groups: [] } : {}),
        createdAt: now,
        updatedAt: now,
        audios: [],
    };
    fs.mkdirSync(path.join(setDir(feature, data.id), AUDIO_DIR), { recursive: true });
    writeSet(data);
    return toSummary(data);
}

// 名前は学習中も変えられる。削除中は断る (ごみ箱へ移した後に記録を書いて、フォルダを作り直さないため)
export function renameTrainingSet(feature: VoiceModelFeature, id: string, name: string): TrainingSetSummary {
    checkNotMoving();
    if (activities.get(setKey(feature, id))?.removing) throw new Error('TRAINING_SET_IN_USE');
    const data = readSet(feature, id);
    const next = { ...data, name: checkName(name), updatedAt: Date.now() };
    writeSet(next);
    return toSummary(next);
}

export async function removeTrainingSet(feature: VoiceModelFeature, id: string): Promise<void> {
    checkIdle(feature, id);
    const dir = setDir(feature, id);
    readSet(feature, id);
    const activity = activityOf(feature, id);
    activity.removing = true;
    try {
        forgetMediaUnder(dir);
        await moveToTrash(dir);
    } finally {
        activity.removing = false;
    }
}

// 音声を記録に加える。読み上げの学習セットでは、同じ文の前の音声を置き換えて消す
function addToSet(data: StoredSet, audio: StoredAudio): StoredAudio[] {
    const replaced = audio.sentenceId ? data.audios.filter(item => item.sentenceId === audio.sentenceId) : [];
    writeSet({
        ...data,
        updatedAt: Date.now(),
        audios: [...data.audios.filter(item => !replaced.includes(item)), audio],
    });
    return replaced;
}

// 記録から外した音声のファイルを消す。消せなかったものは次の起動時に消す (記録に無いファイルとして)
function removeAudioFiles(feature: VoiceModelFeature, setId: string, audios: StoredAudio[]): void {
    for (const audio of audios) {
        const file = audioPath(feature, setId, audio.id);
        forgetMedia(file);
        try {
            fs.rmSync(file, { force: true });
        } catch (error) {
            console.warn(`failed to remove the training audio ${file}`, error);
        }
    }
}

// 読み上げの学習セットでは文 (サンプル文から作成する学習セットは読み上げ文、任意の文で作成する学習セットはグループ) を
// 1 つ指定し、音声変換の学習セットでは指定しない
function checkSentence(data: StoredSet, sentenceId: string | undefined): void {
    if (!data.language) {
        if (sentenceId !== undefined) throw new Error('UNKNOWN_SENTENCE');
        return;
    }
    if (!sentenceId || !sentencesOf(data).some(sentence => sentence.id === sentenceId)) {
        throw new Error('UNKNOWN_SENTENCE');
    }
}

// --- 任意の文で作成する読み上げの学習セットのグループ ---

function readCustomSet(setId: string): StoredSet {
    const data = readSet('tts', setId);
    if (modeOf(data) !== 'custom') throw new Error('TRAINING_SET_MODE_MISMATCH');
    return data;
}

function findGroup(data: StoredSet, groupId: string): StoredGroup {
    const group = (data.groups ?? []).find(item => item.id === groupId);
    if (!group) throw new Error('UNKNOWN_SENTENCE');
    return group;
}

// グループを末尾に加える (本文は空、音声は無し)
export function addTrainingGroup(setId: string): TrainingSentence {
    checkNotInUse('tts', setId);
    const data = readCustomSet(setId);
    const group: StoredGroup = { id: crypto.randomUUID(), text: '' };
    writeSet({ ...data, updatedAt: Date.now(), groups: [...(data.groups ?? []), group] });
    return { ...group };
}

// グループの本文を変える (入力の途中で保存するため、空も受け付ける。学習では本文が空のグループを使わない)
export function setTrainingGroupText(setId: string, groupId: string, text: string): void {
    checkNotInUse('tts', setId);
    const data = readCustomSet(setId);
    findGroup(data, groupId);
    writeSet({
        ...data,
        updatedAt: Date.now(),
        groups: (data.groups ?? []).map(group => (group.id === groupId ? { ...group, text } : group)),
    });
}

// グループを削除する (そのグループの音声も消す。元に戻せない)
export function removeTrainingGroup(setId: string, groupId: string): void {
    checkNotInUse('tts', setId);
    checkNotFiltering('tts', setId);
    const data = readCustomSet(setId);
    findGroup(data, groupId);
    const removed = data.audios.filter(audio => audio.sentenceId === groupId);
    writeSet({
        ...data,
        updatedAt: Date.now(),
        groups: (data.groups ?? []).filter(group => group.id !== groupId),
        audios: data.audios.filter(audio => audio.sentenceId !== groupId),
    });
    removeAudioFiles('tts', setId, removed);
}

// 保存した音声を調べて記録に加える。記録に加えられなければ保存した音声を消す
async function registerAudio(
    data: StoredSet,
    audioId: string,
    name: string,
    source: StoredAudio['source'],
    sentenceId: string | undefined,
    jobId?: string
): Promise<TrainingAudio> {
    const file = audioPath(data.feature, data.id, audioId);
    let current: StoredSet;
    let audio: StoredAudio;
    try {
        const info = await probeAudio(file, jobId);
        audio = {
            id: audioId,
            name,
            source,
            sentenceId,
            durationSec: info.durationSec,
            sampleRate: info.sampleRate,
            channels: info.channels,
            addedAt: Date.now(),
        };
        // 調べている間に削除が始まっていないかを確かめ、変わっていないよう記録は直前に読み直す。読み上げの学習セットでは、
        // 加える先の文 (グループ) がその間に削除されていないかも確かめる (記録に、どの文にも結び付かない音声を残さないため)
        checkNotInUse(data.feature, data.id);
        current = readSet(data.feature, data.id);
        checkSentence(current, sentenceId);
    } catch (error) {
        fs.rmSync(file, { force: true });
        throw error;
    }
    let replaced: StoredAudio[];
    try {
        replaced = addToSet(current, audio);
    } catch (error) {
        fs.rmSync(file, { force: true });
        throw error;
    }
    // 記録に加えた後は、新しい音声を消さない (置き換えた前の音声だけを消す)
    removeAudioFiles(data.feature, data.id, replaced);
    return toAudio(current, audio);
}

// アプリ内で録音した音声 (16bit・モノラルの WAV) を学習セットに加える
export async function addTrainingRecording(
    feature: VoiceModelFeature,
    setId: string,
    recordingId: string,
    target: { name: string; sentenceId?: string }
): Promise<TrainingAudio> {
    try {
        return await whileAdding(feature, setId, async () => {
            const data = readSet(feature, setId);
            checkSentence(data, target.sentenceId);
            const audioId = crypto.randomUUID();
            const file = audioPath(feature, setId, audioId);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            moveRecordingTo(recordingId, file);
            return registerAudio(data, audioId, target.name, 'recording', target.sentenceId);
        });
    } finally {
        // 加えられなかった場合も録音のファイルを残さない (移した場合は何もしない)
        discardRecording(recordingId);
    }
}

// 音声ファイル (動画の音声も含む) を、録音と同じ形式にして学習セットに加える。
// 読み上げの学習セットでは、その 1 文を読み上げたファイルを 1 つ指定する。学習セットにすでに同じ名前 (大文字・小文字は
// 区別しない) の音声があるファイルは加えず、名前を返す (同じ名前のファイルを加えるのは誤った操作とみなす。一度に渡した
// 中で重なる場合は、2 つ目以降を加えない)。読み上げの学習セットで置き換える、その文の今の音声とは比べない
export async function addTrainingFiles(
    jobId: string,
    feature: VoiceModelFeature,
    setId: string,
    paths: string[],
    sentenceId?: string
): Promise<TrainingAddFilesResult> {
    startJob(jobId);
    try {
        return await whileAdding(feature, setId, () => addFilesNow(jobId, feature, setId, paths, sentenceId));
    } finally {
        finishJob(jobId);
    }
}

// 中断された場合は、それまでに加えたものを残して KURA_CANCELLED で終える
async function addFilesNow(
    jobId: string,
    feature: VoiceModelFeature,
    setId: string,
    paths: string[],
    sentenceId?: string
): Promise<TrainingAddFilesResult> {
    const data = readSet(feature, setId);
    checkSentence(data, sentenceId);
    if (sentenceId !== undefined && paths.length !== 1) throw new Error('UNKNOWN_SENTENCE');
    const nameKey = (name: string) => name.toLowerCase();
    const names = new Set(
        data.audios
            .filter(audio => sentenceId === undefined || audio.sentenceId !== sentenceId)
            .map(audio => nameKey(audio.name))
    );
    const added: TrainingAudio[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < paths.length; i++) {
        if (isCancelled(jobId)) throw new Error('KURA_CANCELLED');
        emitJobEvent({
            jobId,
            kind: 'progress',
            percent: (i / paths.length) * 100,
            current: i + 1,
            total: paths.length,
        });
        const source = path.resolve(paths[i]);
        const name = path.basename(source);
        if (names.has(nameKey(name))) {
            skipped.push(name);
            continue;
        }
        names.add(nameKey(name));
        const audioId = crypto.randomUUID();
        const file = audioPath(feature, setId, audioId);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await encodeTrainingWav(source, file, jobId);
        added.push(await registerAudio(data, audioId, name, 'file', sentenceId, jobId));
    }
    return { added, skipped };
}

export function removeTrainingAudio(feature: VoiceModelFeature, setId: string, audioId: string): void {
    checkNotInUse(feature, setId);
    checkNotFiltering(feature, setId);
    const data = readSet(feature, setId);
    const removed = data.audios.filter(audio => audio.id === audioId);
    if (removed.length === 0) return;
    writeSet({ ...data, updatedAt: Date.now(), audios: data.audios.filter(audio => audio.id !== audioId) });
    removeAudioFiles(feature, setId, removed);
}

// --- 学習用の音のフィルター ---

// 加工する。残響・エコーの除去 → ノイズ除去 → 無音部分の除去 → 音量をそろえるの順に行い (TrainingFilterOptions)、
// 最後に学習用の音声と同じ形式 (16bit・モノラル) にして output に書く (聞いた音と置き換える音を同じにするため)。
// 途中のファイルは work に作る
async function applyTrainingFilters(
    jobId: string,
    feature: VoiceModelFeature,
    input: string,
    output: string,
    options: TrainingFilterOptions,
    work: string
): Promise<void> {
    let current = input;
    // 手順で進むジョブでは、加工ごとに次の手順に入る (すべての音に適用するときは、何個目の音かで進める)
    if (options.dereverb.enabled) {
        nextStep(jobId);
        const next = path.join(work, 'dereverb.wav');
        await removeReverb(jobId, current, next, options.dereverb, work);
        current = next;
    }
    if (options.noiseRemoval.enabled) {
        nextStep(jobId);
        const next = path.join(work, 'noise.wav');
        await removeNoise(jobId, current, next, options.noiseRemoval, work);
        current = next;
    }
    if (options.removeSilence.enabled) {
        nextStep(jobId);
        const next = path.join(work, 'silence.wav');
        // 無音の判断は、その機能の処理役で行う (音声変換の学習は変換、読み上げの学習は読み上げ)
        await editSilence(jobId, feature, current, next, options.removeSilence, 'remove');
        current = next;
    }
    if (options.loudness.enabled) {
        nextStep(jobId);
        const next = path.join(work, 'loudness.wav');
        await normalizeLoudness(jobId, current, next, options.loudness);
        current = next;
    }
    await encodeTrainingWav(current, output, jobId);
}

function findAudio(data: StoredSet, audioId: string): StoredAudio {
    const audio = data.audios.find(item => item.id === audioId);
    if (!audio) throw new Error('TRAINING_AUDIO_NOT_FOUND');
    return audio;
}

// 個々の音に加工をかけた結果を作る (作業 workKey の中に置く。確定するまで学習セットは変えない)
export async function filterTrainingAudio(
    jobId: string,
    feature: VoiceModelFeature,
    setId: string,
    audioId: string,
    workKey: string,
    options: TrainingFilterOptions
): Promise<{ media: MediaRef; durationSec: number }> {
    startJob(jobId);
    try {
        const data = readSet(feature, setId);
        findAudio(data, audioId);
        const dir = sessionDir(workKey, 'filters', newId());
        const output = path.join(dir, 'result.wav');
        try {
            // チェックした加工ごとに 1 手順
            const steps = [options.dereverb, options.noiseRemoval, options.removeSilence, options.loudness].filter(
                option => option.enabled
            ).length;
            await withSteps(jobId, steps, () =>
                applyTrainingFilters(jobId, feature, audioPath(feature, setId, audioId), output, options, dir)
            );
        } catch (error) {
            discardLater(dir);
            throw error;
        }
        emitJobEvent({ jobId, kind: 'progress', percent: 100 });
        const media = await mediaRef(output);
        return { media, durationSec: media.durationSec ?? 0 };
    } finally {
        finishJob(jobId);
    }
}

// 加工した結果のファイルを、学習セットの音のファイルとして置く (元の音のファイルは消え、置き換わる)。
// 同じドライブなら名前の変更で済ませ、別のドライブなら学習セットの中へ写してから置き換える。
// 再生のために開いている元の音のファイルは、名前を変える直前に閉じる (開いたままだと Windows では置き換えられないため。
// 写している間に読み込みが始まっても置き換えられるよう、写した後に閉じる)
async function moveIntoSet(result: string, file: string): Promise<void> {
    try {
        await releaseMedia(file);
        await fs.promises.rename(result, file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        const staging = `${file}.kura-tmp`;
        await fs.promises.copyFile(result, staging);
        await releaseMedia(file);
        await fs.promises.rename(staging, file);
        await fs.promises.rm(result, { force: true });
    }
}

// 置き換えた音の長さなどを記録に反映する
async function updateAudioInfo(feature: VoiceModelFeature, setId: string, audioIds: string[]): Promise<void> {
    const infos = new Map<string, Awaited<ReturnType<typeof probeAudio>>>();
    for (const audioId of audioIds) infos.set(audioId, await probeAudio(audioPath(feature, setId, audioId)));
    const current = readSet(feature, setId);
    writeSet({
        ...current,
        updatedAt: Date.now(),
        audios: current.audios.map(audio => {
            const info = infos.get(audio.id);
            return info
                ? { ...audio, durationSec: info.durationSec, sampleRate: info.sampleRate, channels: info.channels }
                : audio;
        }),
    });
}

// 個々の音のフィルターの確定: 選んだ結果で学習セットの音を置き換える
export async function replaceTrainingAudio(
    feature: VoiceModelFeature,
    setId: string,
    audioId: string,
    workKey: string,
    result: string
): Promise<TrainingAudio> {
    // 置き換えに使えるのは、その作業で作ったフィルターの結果のファイルだけ
    const resolved = path.resolve(result);
    const filters = path.join(sessionPath(workKey), 'filters') + path.sep;
    if (!isInsideWork(workKey, resolved) || !resolved.startsWith(filters) || !fs.statSync(resolved).isFile()) {
        throw new Error('INVALID_PATH');
    }
    checkNotFiltering(feature, setId);
    return whileAdding(feature, setId, async () => {
        findAudio(readSet(feature, setId), audioId);
        await moveIntoSet(resolved, audioPath(feature, setId, audioId));
        await updateAudioInfo(feature, setId, [audioId]);
        const data = readSet(feature, setId);
        return toAudio(data, findAudio(data, audioId));
    });
}

// 学習セットのすべての音に同じ加工をかけて置き換える。キャンセルしたら何も置き換えない (しなかったことにする) ため、
// すべての音の加工を済ませてから、まとめて置き換える
export async function filterTrainingSet(
    jobId: string,
    feature: VoiceModelFeature,
    setId: string,
    options: TrainingFilterOptions
): Promise<void> {
    startJob(jobId);
    let work: string | null = null;
    try {
        work = newTempDir();
        const workDir = work;
        await whileFiltering(feature, setId, async () => {
            const audios = readSet(feature, setId).audios;
            const results: { audioId: string; path: string }[] = [];
            for (const [index, audio] of audios.entries()) {
                if (isCancelled(jobId)) throw new Error('KURA_CANCELLED');
                emitJobEvent({
                    jobId,
                    kind: 'progress',
                    percent: (index / audios.length) * 100,
                    current: index + 1,
                    total: audios.length,
                });
                const dir = path.join(workDir, String(index));
                fs.mkdirSync(dir, { recursive: true });
                const output = path.join(dir, 'result.wav');
                await applyTrainingFilters(jobId, feature, audioPath(feature, setId, audio.id), output, options, dir);
                results.push({ audioId: audio.id, path: output });
            }
            if (isCancelled(jobId)) throw new Error('KURA_CANCELLED');
            // 置き換えている途中で失敗しても、置き換えたものの記録 (長さなど) は必ず直す
            const replaced: string[] = [];
            try {
                const remaining = new Set(readSet(feature, setId).audios.map(audio => audio.id));
                for (const item of results) {
                    // 加工している間に削除された音は置き換えない (記録に無いファイルを作らないため)
                    if (!remaining.has(item.audioId)) continue;
                    await moveIntoSet(item.path, audioPath(feature, setId, item.audioId));
                    replaced.push(item.audioId);
                }
            } finally {
                if (replaced.length > 0) await updateAudioInfo(feature, setId, replaced);
            }
        });
        emitJobEvent({ jobId, kind: 'progress', percent: 100 });
    } finally {
        if (work) discardLater(work);
        finishJob(jobId);
    }
}

// 学習前の確かめ: 音ごとの、無音部分の長さの合計 (秒)。判断はフィルターの無音部分の除去と同じ
export async function trainingSilenceReport(
    feature: VoiceModelFeature,
    setId: string,
    option: SilenceOption
): Promise<{ audioId: string; silenceSec: number }[]> {
    const audios = readSet(feature, setId).audios;
    const paths = audios.map(audio => audioPath(feature, setId, audio.id));
    const result = await getWorker(feature).request<{ files: { path: string; silenceSec: number }[] }>(
        'detect_silence',
        {
            paths,
            thresholdDb: option.thresholdDb,
            minSeconds: option.minSeconds,
        }
    );
    return audios.map((audio, index) => ({ audioId: audio.id, silenceSec: result.files[index]?.silenceSec ?? 0 }));
}

// 学習に使う音声 (学習セットの中のファイル)
export type TrainingSetAudio = { path: string; sentenceId?: string; durationSec: number };

// 学習に使う学習セットの内容。fn の実行中は学習セットを変更・削除させない。
// sentences は読み上げの学習セットの文 (任意の文で作成する学習セットはグループ。getTrainingSet と同じ)
export async function withTrainingSet<T>(
    feature: VoiceModelFeature,
    setId: string,
    fn: (set: {
        language?: VoiceLanguage;
        mode?: TrainingSetMode;
        sentences: TrainingSentence[];
        audios: TrainingSetAudio[];
    }) => Promise<T>
): Promise<T> {
    checkIdle(feature, setId);
    const data = readSet(feature, setId);
    const audios = data.audios.map(audio => ({
        path: audioPath(feature, setId, audio.id),
        sentenceId: audio.sentenceId,
        durationSec: audio.durationSec,
    }));
    const missing = data.audios.filter((_audio, index) => !fs.existsSync(audios[index].path));
    if (missing.length > 0) throw new Error(`TRAINING_FILE_MISSING: ${missing.map(audio => audio.name).join(', ')}`);
    const activity = activityOf(feature, setId);
    activity.training = true;
    try {
        return await fn({ language: data.language, mode: modeOf(data), sentences: sentencesOf(data), audios });
    } finally {
        activity.training = false;
    }
}

// 起動時に、前回の起動で書きかけのまま残った音声 (ファイルの変換・置き換えの途中で終了したもの) を消す。
// 記録に無い音声のファイル (置き換えの一時ファイル `.kura-tmp` を含む) は、記録に加える前に終了したもの
export function removeTrainingSetLeftovers(): void {
    for (const feature of ['converter', 'tts'] as const) {
        let summaries: TrainingSetSummary[];
        try {
            summaries = listTrainingSets(feature);
        } catch (error) {
            console.warn('failed to look for leftover training audio', error);
            continue;
        }
        for (const summary of summaries) {
            const dir = path.join(setDir(feature, summary.id), AUDIO_DIR);
            let known: Set<string>;
            let names: string[];
            try {
                known = new Set(readSet(feature, summary.id).audios.map(audio => `${audio.id}.wav`));
                names = fs.readdirSync(dir);
            } catch {
                continue;
            }
            for (const name of names) {
                if (known.has(name)) continue;
                void fs.promises
                    .rm(path.join(dir, name), { recursive: true, force: true })
                    .catch(error => console.warn(`failed to remove leftover training audio ${name}`, error));
            }
        }
    }
}
