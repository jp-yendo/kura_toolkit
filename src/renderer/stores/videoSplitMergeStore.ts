import { create } from 'zustand';
import type { VideoCutMethod, VideoProbeResult } from '@shared/types';
import type { MergeOutputFormat } from '@shared/video-merge';

// 表示している画面 (ファイルを選ぶ画面・チャプターで分割する画面・結合する画面)
export type VideoScreen = 'select' | 'split' | 'merge';

export type SplitMode = 'cut' | 'split';

// 結合するファイルの一覧の 1 行
export type MergeItem = {
    // 行の識別 (同じファイルを複数回並べられるため、パスとは別に持つ)
    key: string;
    input: string;
    probe: VideoProbeResult;
    // ファイルの始まりに付けるチャプターの名前
    chapterTitle: string;
};

// 番号を自動で振るチャプター名の形。この形の名前だけを、上から順に 1 から振り直す (他の名前の行は数えない)
const AUTO_CHAPTER_TITLE = /^Chapter (\d+)$/;

function renumberChapterTitles(items: MergeItem[]): MergeItem[] {
    let number = 0;
    return items.map(item => {
        if (!AUTO_CHAPTER_TITLE.test(item.chapterTitle)) return item;
        number += 1;
        const chapterTitle = `Chapter ${number}`;
        return chapterTitle === item.chapterTitle ? item : { ...item, chapterTitle };
    });
}

type VideoSplitMergeState = {
    screen: VideoScreen;
    // 分割するファイル
    input: string | null;
    probe: VideoProbeResult | null;
    mode: SplitMode;
    fromIndex: number;
    // -1 = 最終チャプターまで
    toIndex: number;
    boundaries: number[];
    // 切り出しモードの出力ファイル名 (空文字 = チャプター名から自動生成)。
    // ディレクトリは含まず、出力先は outputDir が決める
    outputName: string;
    // 出力設定。設定ファイルには保存しない (空文字 = 入力と同じディレクトリ)
    outputDir: string;
    // 切り出し・分割の方法
    cutMethod: VideoCutMethod;
    // 結合するファイル (並べた順に結合する)
    mergeItems: MergeItem[];
    // 結合部にチャプターを付ける
    mergeChapters: boolean;
    // 形式がそろっていても再エンコードする
    mergeReencode: boolean;
    // 結合の出力形式 (source = 元の形式)
    mergeFormat: MergeOutputFormat;
    // 結合の出力ファイルの絶対パス
    mergeOutput: string;
    logs: string[];
    // 分割するファイルを決めて、分割する画面へ移る
    setInput(input: string, probe: VideoProbeResult): void;
    setOutputName(outputName: string): void;
    setOutputDir(outputDir: string): void;
    setCutMethod(method: VideoCutMethod): void;
    setMode(mode: SplitMode): void;
    setFromIndex(index: number): void;
    setToIndex(index: number): void;
    toggleBoundary(index: number): void;
    // 結合するファイルを一覧の末尾へ足し、結合する画面へ移る
    addMergeItems(entries: Array<{ input: string; probe: VideoProbeResult }>): void;
    removeMergeItem(key: string): void;
    // from 番目の行を to 番目へ動かす
    moveMergeItem(from: number, to: number): void;
    setMergeChapterTitle(key: string, title: string): void;
    setMergeChapters(enabled: boolean): void;
    setMergeReencode(enabled: boolean): void;
    setMergeFormat(format: MergeOutputFormat): void;
    setMergeOutput(output: string): void;
    appendLog(line: string): void;
    clearLogs(): void;
    // 初めの状態に戻す (別の機能へ移ったとき)
    reset(): void;
};

type VideoSplitMergeData = Pick<
    VideoSplitMergeState,
    | 'screen'
    | 'input'
    | 'probe'
    | 'mode'
    | 'fromIndex'
    | 'toIndex'
    | 'boundaries'
    | 'outputName'
    | 'outputDir'
    | 'cutMethod'
    | 'mergeItems'
    | 'mergeChapters'
    | 'mergeReencode'
    | 'mergeFormat'
    | 'mergeOutput'
    | 'logs'
>;

const INITIAL_STATE: VideoSplitMergeData = {
    screen: 'select',
    input: null,
    probe: null,
    mode: 'cut',
    fromIndex: 0,
    toIndex: -1,
    boundaries: [],
    outputName: '',
    outputDir: '',
    cutMethod: 'lossless',
    mergeItems: [],
    mergeChapters: false,
    mergeReencode: false,
    mergeFormat: 'source',
    mergeOutput: '',
    logs: [],
};

// 選んだファイルごとに初めの状態へ戻す項目 (出力先ディレクトリ・再エンコードなどの設定はファイルを変えても引き継ぐ)
const FILE_STATE: Partial<VideoSplitMergeData> = {
    input: null,
    probe: null,
    fromIndex: 0,
    toIndex: -1,
    boundaries: [],
    outputName: '',
    mergeItems: [],
    mergeOutput: '',
    logs: [],
};

export const useVideoSplitMergeStore = create<VideoSplitMergeState>((set, get) => ({
    ...INITIAL_STATE,
    setInput(input, probe) {
        set({ ...FILE_STATE, screen: 'split', input, probe });
    },
    setOutputName(outputName) {
        set({ outputName });
    },
    setOutputDir(outputDir) {
        set({ outputDir });
    },
    setCutMethod(method) {
        set({ cutMethod: method });
    },
    setMode(mode) {
        set({ mode });
    },
    setFromIndex(index) {
        set({ fromIndex: index });
    },
    setToIndex(index) {
        set({ toIndex: index });
    },
    toggleBoundary(index) {
        const current = get().boundaries;
        set({
            boundaries: current.includes(index)
                ? current.filter(value => value !== index)
                : [...current, index].sort((a, b) => a - b),
        });
    },
    addMergeItems(entries) {
        // 足した行には番号を振る形の名前を付け、一覧全体で振り直す
        const added = entries.map(entry => ({
            key: crypto.randomUUID(),
            input: entry.input,
            probe: entry.probe,
            chapterTitle: 'Chapter 0',
        }));
        set({ screen: 'merge', mergeItems: renumberChapterTitles([...get().mergeItems, ...added]) });
    },
    removeMergeItem(key) {
        set({ mergeItems: renumberChapterTitles(get().mergeItems.filter(item => item.key !== key)) });
    },
    moveMergeItem(from, to) {
        const items = [...get().mergeItems];
        if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return;
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        set({ mergeItems: renumberChapterTitles(items) });
    },
    setMergeChapterTitle(key, title) {
        // 入力中に番号を振り直すと書き換わってしまうため、ここでは振り直さない (並びが変わったときに振り直す)
        set({ mergeItems: get().mergeItems.map(item => (item.key === key ? { ...item, chapterTitle: title } : item)) });
    },
    setMergeChapters(enabled) {
        set({ mergeChapters: enabled });
    },
    setMergeReencode(enabled) {
        set({ mergeReencode: enabled });
    },
    setMergeFormat(format) {
        set({ mergeFormat: format });
    },
    setMergeOutput(output) {
        set({ mergeOutput: output });
    },
    appendLog(line) {
        set({ logs: [...get().logs, line] });
    },
    clearLogs() {
        set({ logs: [] });
    },
    reset() {
        set(INITIAL_STATE);
    },
}));
