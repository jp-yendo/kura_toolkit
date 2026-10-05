import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { emitJobEvent, finishJob, isCancelled, startJob } from '../job-manager';
import { encodeTrainingWav, probeAudio } from './audio-tools';
import { corpusSentences } from './corpus';
import { readJsonFile, writeJsonFile } from './json-file';
import { forgetMedia, forgetMediaUnder, mediaUrl } from './media-protocol';
import { modelPaths } from './paths';
import { moveToTrash } from '../../utils/trash';
import type { VoiceLanguage } from '../../../shared/voice/languages';
import type {
    TrainingAudio,
    TrainingSetDetail,
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

type StoredSet = {
    id: string;
    feature: VoiceModelFeature;
    name: string;
    language?: VoiceLanguage;
    createdAt: number;
    updatedAt: number;
    audios: StoredAudio[];
};

// 学習セットごとの処理中の状態。学習中・削除中は音声を変えさせず、音声の追加中は学習・削除を始めさせない
// (追加の途中で学習を始めると、録り直しで消える前の音声を学習が読むことになるため)
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

// 学習・削除・音声の追加のいずれかを行っている学習セットがあるか (保存場所の移動を断るため)
export function hasBusyTrainingSets(): boolean {
    return [...activities.values()].some(activity => activity.training || activity.removing || activity.adding > 0);
}

// 音声の追加中は、学習と削除を始めさせない
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
    const activity = activities.get(setKey(feature, id));
    if (activity?.training || activity?.removing) throw new Error('TRAINING_SET_IN_USE');
}

// 学習・削除を始める前に、ほかの処理 (学習・削除・音声の追加) をしていないかを確かめる
function checkIdle(feature: VoiceModelFeature, id: string): void {
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

function toSummary(data: StoredSet): TrainingSetSummary {
    return {
        id: data.id,
        feature: data.feature,
        name: data.name,
        language: data.language,
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
        sentences: data.language ? corpusSentences(data.language) : [],
    };
}

export function createTrainingSet(
    feature: VoiceModelFeature,
    name: string,
    language?: VoiceLanguage
): TrainingSetSummary {
    // 読み上げの学習セットは言語を 1 つ持ち、音声変換の学習セットは言語を持たない
    if ((feature === 'tts') !== (language !== undefined)) throw new Error('TRAINING_SET_LANGUAGE_MISMATCH');
    const now = Date.now();
    const data: StoredSet = {
        id: crypto.randomUUID(),
        feature,
        name: checkName(name),
        language,
        createdAt: now,
        updatedAt: now,
        audios: [],
    };
    fs.mkdirSync(path.join(setDir(feature, data.id), AUDIO_DIR), { recursive: true });
    writeSet(data);
    return toSummary(data);
}

export function renameTrainingSet(feature: VoiceModelFeature, id: string, name: string): TrainingSetSummary {
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

// 読み上げの学習セットでは読み上げ文の文を 1 つ指定し、音声変換の学習セットでは指定しない
function checkSentence(data: StoredSet, sentenceId: string | undefined): void {
    if (!data.language) {
        if (sentenceId !== undefined) throw new Error('UNKNOWN_SENTENCE');
        return;
    }
    if (!sentenceId || !corpusSentences(data.language).some(sentence => sentence.id === sentenceId)) {
        throw new Error('UNKNOWN_SENTENCE');
    }
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
        // 調べている間に削除が始まっていないかを確かめ、変わっていないよう記録は直前に読み直す
        checkNotInUse(data.feature, data.id);
        current = readSet(data.feature, data.id);
    } catch (error) {
        fs.rmSync(file, { force: true });
        throw error;
    }
    // 記録に加えた後は、新しい音声を消さない (置き換えた前の音声だけを消す)
    removeAudioFiles(data.feature, data.id, addToSet(current, audio));
    return toAudio(current, audio);
}

// アプリ内で録音した音声 (16bit・モノラルの WAV) を学習セットに加える
export async function addTrainingRecording(
    feature: VoiceModelFeature,
    setId: string,
    wav: Uint8Array,
    target: { name: string; sentenceId?: string }
): Promise<TrainingAudio> {
    return whileAdding(feature, setId, async () => {
        const data = readSet(feature, setId);
        checkSentence(data, target.sentenceId);
        const audioId = crypto.randomUUID();
        const file = audioPath(feature, setId, audioId);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(wav));
        return registerAudio(data, audioId, target.name, 'recording', target.sentenceId);
    });
}

// 音声ファイル (動画の音声も含む) を、録音と同じ形式にして学習セットに加える。
// 読み上げの学習セットでは、その 1 文を読み上げたファイルを 1 つ指定する
export async function addTrainingFiles(
    jobId: string,
    feature: VoiceModelFeature,
    setId: string,
    paths: string[],
    sentenceId?: string
): Promise<TrainingAudio[]> {
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
): Promise<TrainingAudio[]> {
    const data = readSet(feature, setId);
    checkSentence(data, sentenceId);
    if (sentenceId !== undefined && paths.length !== 1) throw new Error('UNKNOWN_SENTENCE');
    const added: TrainingAudio[] = [];
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
        const audioId = crypto.randomUUID();
        const file = audioPath(feature, setId, audioId);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await encodeTrainingWav(source, file, jobId);
        added.push(await registerAudio(data, audioId, path.basename(source), 'file', sentenceId, jobId));
    }
    return added;
}

export function removeTrainingAudio(feature: VoiceModelFeature, setId: string, audioId: string): void {
    checkNotInUse(feature, setId);
    const data = readSet(feature, setId);
    const removed = data.audios.filter(audio => audio.id === audioId);
    if (removed.length === 0) return;
    writeSet({ ...data, updatedAt: Date.now(), audios: data.audios.filter(audio => audio.id !== audioId) });
    removeAudioFiles(feature, setId, removed);
}

// 学習に使う音声 (学習セットの中のファイル)
export type TrainingSetAudio = { path: string; sentenceId?: string; durationSec: number };

// 学習に使う学習セットの内容。fn の実行中は学習セットを変更・削除させない
export async function withTrainingSet<T>(
    feature: VoiceModelFeature,
    setId: string,
    fn: (set: { language?: VoiceLanguage; audios: TrainingSetAudio[] }) => Promise<T>
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
        return await fn({ language: data.language, audios });
    } finally {
        activity.training = false;
    }
}

// 起動時に、前回の起動で書きかけのまま残った音声 (ファイルの変換の途中で終了したもの) を消す。
// 記録に無い音声のファイルは、記録に加える前に終了したもの
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
