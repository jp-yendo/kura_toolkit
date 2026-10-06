import { create } from 'zustand';
import { newWorkKey } from '../components/voice/voiceFormat';
import { formatTimestamp, parseTimeInput } from '@shared/voice/timed-text';
import type { TtsModelType, VoiceLanguage } from '@shared/voice/languages';
import type { TimedLine, TimelineOverflowMode, TtsAudio, TtsInputMode, TtsParams } from '@shared/voice/types';

// 読み上げの作業 (編集中の文章・設定・作成した音声)。読み込んだファイルの内容は画面上でだけ編集し、
// ディスク上のファイルへの反映は利用者が保存したときだけ行う。
// 入力方法 (通常・タイミング指定) は内容を別々に持ち、切り替えても変換しない。

const DEFAULT_TTS_PARAMS: TtsParams = {
    // モデルが持つスタイルから選ぶ (選ぶまでは、そのモデルの最初のスタイル)
    style: '',
    styleWeight: 1,
    speed: 1,
    pitchScale: 1,
    intonationScale: 1,
    sdpRatio: 0.2,
    noise: 0.6,
    noiseW: 0.8,
    speakerId: 0,
    paragraphPause: 0.5,
};

// 新しく足す行の長さ (秒)
const NEW_ROW_SECONDS = 3;

// タイミング指定の表の 1 行。時間は入力中の文字列のまま持つ (確定時に整える)
export type TimedRow = {
    id: string;
    start: string;
    end: string;
    text: string;
};

type NormalDocument = {
    text: string;
    // 最後に読み込んだ・保存した内容 (変更があるかの判定に使う)
    savedText: string;
    filePath: string | null;
};

type TimedDocument = {
    rows: TimedRow[];
    // 最後に読み込んだ・保存した内容 (行の時間とテキスト。変更があるかの判定に使う)
    savedSnapshot: string;
    // 保存先 (上書きしてよいファイル)
    filePath: string | null;
    // 開いたファイル (保存先にしない字幕ファイルも含む。画面の表示と、保存するときの名前の候補に使う)
    sourcePath: string | null;
};

type TtsState = {
    workKey: string;
    inputMode: TtsInputMode;
    normal: NormalDocument;
    timed: TimedDocument;
    language: VoiceLanguage | null;
    modelType: TtsModelType | null;
    voiceId: string;
    params: TtsParams;
    readSymbols: boolean;
    overflowMode: TimelineOverflowMode;
    // 最後に作成した音声 (作成し直すと置き換える)
    result: TtsAudio | null;
    // 音声を作成したときの文章のファイル (書き出しの既定の場所に使う)
    resultSourcePath: string | null;
    setInputMode(mode: TtsInputMode): void;
    setText(text: string): void;
    loadNormal(text: string, filePath: string | null): void;
    markNormalSaved(filePath: string): void;
    // 行の一覧を置き換える (読み込み・新規)。filePath は保存先 (SRT のファイル以外から読み込んだ場合は null)、
    // sourcePath は開いたファイル (省略時は filePath)
    loadTimed(lines: TimedLine[], filePath: string | null, saved: boolean, sourcePath?: string | null): void;
    markTimedSaved(filePath: string): void;
    // 変更を破棄して、最後に読み込んだ・保存した内容に戻す (保存したことが無ければ空にする)
    revertNormal(): void;
    revertTimed(): void;
    updateRow(id: string, patch: Partial<Omit<TimedRow, 'id'>>): void;
    // index の位置に行を入れる (省略時は末尾)
    insertRow(index?: number): string;
    removeRow(id: string): void;
    setLanguage(language: VoiceLanguage): void;
    setModelType(modelType: TtsModelType | null): void;
    setVoiceId(id: string): void;
    setParams(params: TtsParams): void;
    setReadSymbols(value: boolean): void;
    setOverflowMode(mode: TimelineOverflowMode): void;
    setResult(result: TtsAudio | null, sourcePath?: string | null): void;
    // 作業 (作成した音声) を破棄して、新しい作業の置き場にする (文章と設定は残す)
    clearWork(): void;
};

function newRowId(): string {
    return crypto.randomUUID();
}

function rowsFromLines(lines: TimedLine[]): TimedRow[] {
    return lines.map(line => ({
        id: newRowId(),
        start: formatTimestamp(line.start),
        end: formatTimestamp(line.end),
        text: line.text,
    }));
}

// 変更があるかの判定に使う内容 (時間は読める場合は秒で比べ、入力の書き方の違いを変更としない)
export function timedSnapshot(rows: TimedRow[]): string {
    return JSON.stringify(
        rows.map(row => [parseTimeInput(row.start) ?? row.start, parseTimeInput(row.end) ?? row.end, row.text])
    );
}

export const useTtsStore = create<TtsState>((set, get) => ({
    workKey: newWorkKey(),
    inputMode: 'normal',
    normal: { text: '', savedText: '', filePath: null },
    timed: { rows: [], savedSnapshot: timedSnapshot([]), filePath: null, sourcePath: null },
    language: null,
    modelType: null,
    voiceId: '',
    params: DEFAULT_TTS_PARAMS,
    readSymbols: false,
    overflowMode: 'speedup',
    result: null,
    resultSourcePath: null,
    setInputMode(inputMode) {
        set({ inputMode });
    },
    setText(text) {
        set({ normal: { ...get().normal, text } });
    },
    loadNormal(text, filePath) {
        set({ normal: { text, savedText: text, filePath } });
    },
    markNormalSaved(filePath) {
        const normal = get().normal;
        set({ normal: { ...normal, filePath, savedText: normal.text } });
    },
    revertNormal() {
        const normal = get().normal;
        set({ normal: { ...normal, text: normal.savedText } });
    },
    revertTimed() {
        const timed = get().timed;
        const saved = JSON.parse(timed.savedSnapshot) as [number | string, number | string, string][];
        if (saved.length === 0) {
            set({ timed: { rows: [], savedSnapshot: timedSnapshot([]), filePath: null, sourcePath: null } });
            return;
        }
        // 保存した内容の時間は読める値だけ (読めない時間がある間は保存できない)
        const lines = saved.map(([start, end, text]) => ({ start: Number(start), end: Number(end), text }));
        const rows = rowsFromLines(lines);
        set({ timed: { ...timed, rows, savedSnapshot: timedSnapshot(rows) } });
    },
    loadTimed(lines, filePath, saved, sourcePath) {
        const rows = rowsFromLines(lines);
        set({
            timed: {
                rows,
                filePath,
                sourcePath: sourcePath ?? filePath,
                savedSnapshot: saved ? timedSnapshot(rows) : timedSnapshot([]),
            },
        });
    },
    markTimedSaved(filePath) {
        const timed = get().timed;
        set({ timed: { ...timed, filePath, sourcePath: filePath, savedSnapshot: timedSnapshot(timed.rows) } });
    },
    updateRow(id, patch) {
        const timed = get().timed;
        set({ timed: { ...timed, rows: timed.rows.map(row => (row.id === id ? { ...row, ...patch } : row)) } });
    },
    insertRow(index) {
        const timed = get().timed;
        const at = index ?? timed.rows.length;
        // 新しい行は、前の行の終了時間から始める。読めない場合は前の行の開始時間、それも読めなければさらに前の行から探す
        // (0 秒から始めると、前の行との時間の前後が逆転して誤りになるため)
        let start = 0;
        for (let index = at - 1; index >= 0; index--) {
            const time = parseTimeInput(timed.rows[index].end) ?? parseTimeInput(timed.rows[index].start);
            if (time !== null) {
                start = time;
                break;
            }
        }
        const row: TimedRow = {
            id: newRowId(),
            start: formatTimestamp(start),
            end: formatTimestamp(start + NEW_ROW_SECONDS),
            text: '',
        };
        set({ timed: { ...timed, rows: [...timed.rows.slice(0, at), row, ...timed.rows.slice(at)] } });
        return row.id;
    },
    removeRow(id) {
        const timed = get().timed;
        set({ timed: { ...timed, rows: timed.rows.filter(row => row.id !== id) } });
    },
    setLanguage(language) {
        set({ language });
    },
    setModelType(modelType) {
        set({ modelType });
    },
    setVoiceId(voiceId) {
        set({ voiceId });
    },
    setParams(params) {
        set({ params });
    },
    setReadSymbols(readSymbols) {
        set({ readSymbols });
    },
    setOverflowMode(overflowMode) {
        set({ overflowMode });
    },
    setResult(result, sourcePath) {
        set({ result, resultSourcePath: result ? (sourcePath ?? null) : null });
    },
    clearWork() {
        set({ workKey: newWorkKey(), result: null });
    },
}));
