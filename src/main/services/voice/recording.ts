import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { discardLater, newTempDir } from '../work-dir';

// マイク録音の書き込み。画面は録音した音声を少しずつ (16bit・モノラルの PCM) 送り、ここで作業ディレクトリの
// WAV ファイルへ順に追記する (録音全体を画面のメモリに持たないため)。
// 長さに上限を設けないため、常に RF64 (64bit の長さを持つ WAV) で書く。録音のファイルを読むのはアプリ
// (再生と学習のライブラリ) だけで、どちらも RF64 を読める。長さ (ds64 の欄) は録音を止めたときに書く。

type Recording = {
    dir: string;
    file: string;
    fd: number | null;
    sampleRate: number;
    dataBytes: number;
};

const recordings = new Map<string, Recording>();

// RF64(12) + ds64(8 + 28) + fmt(8 + 16) + data(8)
const HEADER_BYTES = 80;
const DS64_SIZES_OFFSET = 20;
const FMT_OFFSET = 48;
const DATA_OFFSET = 72;
const UINT32_MAX = 0xffffffff;

// ds64 の長さの欄 (RF64 全体・データ・サンプル数)
function sizes(dataBytes: number): Buffer {
    const buffer = Buffer.alloc(24);
    buffer.writeBigUInt64LE(BigInt(HEADER_BYTES - 8 + dataBytes), 0);
    buffer.writeBigUInt64LE(BigInt(dataBytes), 8);
    buffer.writeBigUInt64LE(BigInt(dataBytes / 2), 16);
    return buffer;
}

function header(sampleRate: number): Buffer {
    const buffer = Buffer.alloc(HEADER_BYTES);
    buffer.write('RF64', 0, 'ascii');
    // 32bit の長さの欄は使わない (ds64 の値を使う)
    buffer.writeUInt32LE(UINT32_MAX, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('ds64', 12, 'ascii');
    buffer.writeUInt32LE(28, 16);
    sizes(0).copy(buffer, DS64_SIZES_OFFSET);
    // ds64 の表の数 (使わない)
    buffer.writeUInt32LE(0, DS64_SIZES_OFFSET + 24);
    buffer.write('fmt ', FMT_OFFSET, 'ascii');
    buffer.writeUInt32LE(16, FMT_OFFSET + 4);
    buffer.writeUInt16LE(1, FMT_OFFSET + 8);
    buffer.writeUInt16LE(1, FMT_OFFSET + 10);
    buffer.writeUInt32LE(sampleRate, FMT_OFFSET + 12);
    buffer.writeUInt32LE(sampleRate * 2, FMT_OFFSET + 16);
    buffer.writeUInt16LE(2, FMT_OFFSET + 20);
    buffer.writeUInt16LE(16, FMT_OFFSET + 22);
    buffer.write('data', DATA_OFFSET, 'ascii');
    buffer.writeUInt32LE(UINT32_MAX, DATA_OFFSET + 4);
    return buffer;
}

function find(id: string): Recording {
    const recording = recordings.get(id);
    if (!recording) throw new Error('RECORDING_NOT_FOUND');
    return recording;
}

function closeFile(recording: Recording): void {
    if (recording.fd === null) return;
    const fd = recording.fd;
    recording.fd = null;
    fs.closeSync(fd);
}

// 録音の書き込みを始め、識別子を返す
export function beginRecording(sampleRate: number): string {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error(`INVALID_SAMPLE_RATE: ${sampleRate}`);
    const dir = newTempDir();
    const file = path.join(dir, 'recording.wav');
    let fd: number;
    try {
        fd = fs.openSync(file, 'w');
        fs.writeSync(fd, header(sampleRate));
    } catch (error) {
        discardLater(dir);
        throw error;
    }
    const id = crypto.randomUUID();
    recordings.set(id, { dir, file, fd, sampleRate, dataBytes: 0 });
    return id;
}

// 16bit・モノラルの PCM (リトルエンディアン) を末尾に足す
export function appendRecording(id: string, pcm: Uint8Array): void {
    const recording = find(id);
    if (recording.fd === null) throw new Error('RECORDING_FINISHED');
    fs.writeSync(recording.fd, pcm);
    recording.dataBytes += pcm.length;
}

// 書き込みを終え、ds64 に長さを書く
export function finishRecording(id: string): void {
    const recording = find(id);
    if (recording.fd === null) return;
    fs.writeSync(recording.fd, sizes(recording.dataBytes), 0, 24, DS64_SIZES_OFFSET);
    closeFile(recording);
}

// 書き終えた録音のファイルを dest へ移す。移した (または失敗した) 録音は片付ける
export function moveRecordingTo(id: string, dest: string): void {
    const recording = find(id);
    try {
        if (recording.fd !== null) throw new Error('RECORDING_NOT_FINISHED');
        try {
            fs.renameSync(recording.file, dest);
        } catch (error) {
            // 作業ディレクトリと移し先のドライブが違う場合
            if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
            fs.copyFileSync(recording.file, dest);
        }
    } finally {
        discardRecording(id);
    }
}

// 録音をやめて、書いたファイルを片付ける (無い識別子は何もしない)
export function discardRecording(id: string): void {
    const recording = recordings.get(id);
    if (!recording) return;
    recordings.delete(id);
    try {
        closeFile(recording);
    } finally {
        discardLater(recording.dir);
    }
}
