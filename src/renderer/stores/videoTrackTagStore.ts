import { create } from 'zustand';
import { isTechnicalFormatTag, isTrackFlag } from '@shared/video-track-tag';
import type {
    TrackKind,
    TrackTagChapter,
    TrackTagFile,
    TrackTagFrames,
    TrackTagPreview,
    TrackTagSaveRequest,
    TrackTagWaveform,
} from '@shared/types';

// 動画トラック・タグ管理の画面の状態 (選んだ動画と、編集している内容)。設定ファイルには保存しない

export type TrackTagTab = 'info' | 'tags' | 'tracks' | 'chapters';

// field はよく使うタグの欄で編集するタグ (false はほかのタグの一覧で名前と値を編集する)
export type EditTag = { id: string; key: string; value: string; field: boolean };

// よく使うタグの名前 (欄を並べる順)。multiline は複数行の欄にする
export const TAG_FIELDS: Array<{ key: string; multiline?: boolean }> = [
    { key: 'title' },
    { key: 'artist' },
    { key: 'album_artist' },
    { key: 'album' },
    { key: 'composer' },
    { key: 'genre' },
    { key: 'date' },
    { key: 'creation_time' },
    { key: 'copyright' },
    { key: 'show' },
    { key: 'season_number' },
    { key: 'episode_id' },
    { key: 'track' },
    { key: 'comment', multiline: true },
    { key: 'description', multiline: true },
    { key: 'synopsis', multiline: true },
];

const isFieldKey = (key: string) => TAG_FIELDS.some(field => field.key === key.trim().toLowerCase());

export type EditTrack = {
    id: string;
    source: string;
    streamIndex: number;
    kind: TrackKind;
    codec: string;
    // コーデックのタグと、一覧に添える要約の行
    codecTag: string;
    summary: string[];
    // トラックの名前 (空 = 名前なし)
    title: string;
    language: string;
    // 既定以外のフラグ (disposition の名前)
    flags: string[];
    isDefault: boolean;
    // 別のファイルから追加したトラック
    added: boolean;
    // 削除の印 (元の動画のトラック。書き出さず、取り消して戻せる)
    removed: boolean;
};

export type EditChapter = TrackTagChapter & { id: string };

// 時刻を同じとみなす差 (秒)。チャプターの時刻はミリ秒で保存されるため
const SAME_TIME = 0.0005;

let nextId = 0;
const newId = () => `e${(nextId += 1)}`;

type EditData = { tags: EditTag[]; tracks: EditTrack[]; chapters: EditChapter[] };

// 変更があるかを比べるための、識別子を除いた内容
function snapshot(data: EditData): string {
    return JSON.stringify({
        // 欄を空にして入れ直すと並びが変わるため、タグは並びを問わずに比べる
        tags: data.tags.map(({ key, value }) => JSON.stringify([key, value])).sort(),
        // 削除の印を付けたトラックは書き出さないため比べない
        tracks: data.tracks
            .filter(track => !track.removed)
            .map(({ source, streamIndex, language, title, isDefault, flags }) => [
                source,
                streamIndex,
                language,
                title,
                isDefault,
                [...flags].sort(),
            ]),
        chapters: data.chapters.map(({ title, start, end, tags }) => [title, start, end, tags]),
    });
}

const byStart = (a: EditChapter, b: EditChapter) => a.start - b.start || a.end - b.end;

// タグの名前の誤り: empty = 空、duplicate = ほかのタグと同じ名前 (大文字・小文字を区別しない)、reserved = 書き出すときに
// 出力形式が書き直す名前 (書いても反映されない)、field = ほかのタグの一覧にある、よく使うタグの欄の名前。
// 誤りが無ければ null
export function tagKeyError(tags: EditTag[], tag: EditTag): 'empty' | 'duplicate' | 'reserved' | 'field' | null {
    const key = tag.key.trim().toLowerCase();
    if (key === '') return 'empty';
    if (isTechnicalFormatTag(key)) return 'reserved';
    if (!tag.field && isFieldKey(key)) return 'field';
    if (tags.some(other => other.id !== tag.id && other.key.trim().toLowerCase() === key)) return 'duplicate';
    return null;
}

// 書き出すトラック (削除の印を付けたものを除く)
export function outputTracks(tracks: EditTrack[]): EditTrack[] {
    return tracks.filter(track => !track.removed);
}

// 書き出す映像のトラックの最後の 1 つか (削除できない)
export function isLastVideo(tracks: EditTrack[], id: string): boolean {
    const track = tracks.find(item => item.id === id);
    return (
        track?.kind === 'video' &&
        !track.removed &&
        outputTracks(tracks).filter(item => item.kind === 'video').length === 1
    );
}

// プレビューに波形を出す音声のトラック (既定の音声、無ければ最初の音声。音声が無ければ null)。key は元のファイルと
// トラックの番号
export function waveformTargetOf(tracks: EditTrack[]): { key: string; source: string; streamIndex: number } | null {
    const audios = outputTracks(tracks).filter(track => track.kind === 'audio');
    const audio = audios.find(track => track.isDefault) ?? audios[0];
    return audio
        ? { key: `${audio.source}#${audio.streamIndex}`, source: audio.source, streamIndex: audio.streamIndex }
        : null;
}

// チャプター id の開始・終了を start・end にするときの誤り: order = 開始が終了以降、overlap = ほかのチャプター
// (index は chapters での位置) と重なる。誤りが無ければ null
export function chapterTimesError(
    chapters: EditChapter[],
    id: string,
    start: number,
    end: number
): { code: 'order' } | { code: 'overlap'; index: number } | null {
    if (start >= end - SAME_TIME) return { code: 'order' };
    const index = chapters.findIndex(
        chapter => chapter.id !== id && chapter.start < end - SAME_TIME && start < chapter.end - SAME_TIME
    );
    return index >= 0 ? { code: 'overlap', index } : null;
}

// 同じ開始のチャプター (except を除く) があるか
function startTaken(chapters: EditChapter[], start: number, except: string | null): boolean {
    return chapters.some(chapter => chapter.id !== except && Math.abs(chapter.start - start) <= SAME_TIME);
}

type VideoTrackTagState = EditData & {
    input: string | null;
    file: TrackTagFile | null;
    frames: TrackTagFrames | null;
    preview: TrackTagPreview | null;
    // プレビューに出す波形 (key は元のファイルとトラックの番号)
    waveform: { key: string; data: TrackTagWaveform } | null;
    tab: TrackTagTab;
    // 出力形式 ('auto' = 自動、ほかはドット付きの拡張子)
    outputFormat: string;
    // プレビューの音量 (0 から 1) と消音。別の動画を読み込んでも保つ
    volume: number;
    muted: boolean;
    // 読み込んだとき・書き出したときの内容 (これと違えば変更がある)
    baseline: string;
    load(input: string, file: TrackTagFile): void;
    setFrames(frames: TrackTagFrames | null): void;
    setPreview(preview: TrackTagPreview | null): void;
    setWaveform(waveform: { key: string; data: TrackTagWaveform } | null): void;
    setTab(tab: TrackTagTab): void;
    setOutputFormat(outputFormat: string): void;
    setVolume(volume: number): void;
    setMuted(muted: boolean): void;
    // ほかのタグの一覧に空のタグを足す
    addTag(): void;
    // よく使うタグの欄の値 (空にするとタグを消す)
    setFieldTag(key: string, value: string): void;
    updateTag(id: string, change: Partial<Pick<EditTag, 'key' | 'value'>>): void;
    removeTag(id: string): void;
    setLanguage(id: string, language: string): void;
    // トラックの名前 (空 = 名前なし)
    setTitle(id: string, title: string): void;
    // 既定以外のフラグ
    setFlags(id: string, flags: string[]): void;
    // 既定は種類ごとに 1 つまで (立てると同じ種類のほかのトラックの既定を外す)
    setDefault(id: string, isDefault: boolean): void;
    addTracks(tracks: Array<Omit<EditTrack, 'id' | 'added' | 'removed'>>): void;
    // トラックを削除する。元の動画のトラックは削除の印を付け (restoreTrack で戻せる)、追加したトラックは一覧から除く。
    // 書き出す映像のトラックは最低 1 つ残す (最後の 1 つは削除せずに false を返す)
    removeTrack(id: string): boolean;
    // 削除の印を外す。既定だったトラックは、同じ種類のほかのトラックが既定になっていれば既定を外して戻す
    restoreTrack(id: string): void;
    // チャプターを足し、開始の順に並べ直す (ほかのチャプターは変えない)。同じ開始のチャプターがある場合は足さずに
    // false を返す
    addChapter(chapter: TrackTagChapter): boolean;
    setChapterTitle(id: string, title: string): void;
    removeChapter(id: string): void;
    // チャプターの開始・終了を time にする (隣のチャプターは変えない)。開始が終了以降になる・隣のチャプターと重なる場合は
    // 変えずに false を返す
    setChapterStart(id: string, time: number): boolean;
    setChapterEnd(id: string, time: number): boolean;
    // チャプターの開始・終了をまとめて変え、開始の順に並べ直す (ほかのチャプターは変えない)。誤りがある場合
    // (chapterTimesError) は変えずに false を返す
    setChapterTimes(id: string, start: number, end: number): boolean;
    // 書き出した内容を、変更の無い状態とする
    markSaved(): void;
    reset(): void;
};

const INITIAL = {
    input: null,
    file: null,
    frames: null,
    preview: null,
    waveform: null,
    volume: 1,
    muted: false,
    tab: 'tracks' as TrackTagTab,
    outputFormat: 'auto',
    tags: [],
    tracks: [],
    chapters: [],
    baseline: '',
};

// 選んだ動画から編集の初めの内容を作る
function editDataOf(input: string, file: TrackTagFile): EditData {
    return {
        // よく使うタグは名前ごとに最初の 1 つを欄で編集する (同じ名前の 2 つ目以降は一覧に入り、誤りとして示す)
        tags: Object.entries(file.formatTags)
            .filter(([key]) => !isTechnicalFormatTag(key))
            .map(([key, value], i, entries) => ({
                id: newId(),
                key,
                value,
                field:
                    isFieldKey(key) && entries.findIndex(([other]) => other.toLowerCase() === key.toLowerCase()) === i,
            })),
        tracks: file.streams.flatMap(stream =>
            stream.kind
                ? [
                      {
                          id: newId(),
                          source: input,
                          streamIndex: stream.index,
                          kind: stream.kind,
                          codec: stream.codec,
                          codecTag: stream.codecTag,
                          summary: stream.summary,
                          title: stream.title,
                          language: stream.language === 'und' ? '' : stream.language,
                          isDefault: stream.isDefault,
                          flags: stream.dispositions.filter(isTrackFlag),
                          added: false,
                          removed: false,
                      },
                  ]
                : []
        ),
        chapters: file.chapters.map(chapter => ({ ...chapter, id: newId() })),
    };
}

export const useVideoTrackTagStore = create<VideoTrackTagState>((set, get) => ({
    ...INITIAL,
    load(input, file) {
        const data = editDataOf(input, file);
        const { volume, muted } = get();
        set({ ...INITIAL, volume, muted, input, file, ...data, baseline: snapshot(data) });
    },
    setFrames(frames) {
        set({ frames });
    },
    setPreview(preview) {
        set({ preview });
    },
    setWaveform(waveform) {
        set({ waveform });
    },
    setTab(tab) {
        set({ tab });
    },
    setOutputFormat(outputFormat) {
        set({ outputFormat });
    },
    setVolume(volume) {
        set({ volume, muted: false });
    },
    setMuted(muted) {
        set({ muted });
    },
    addTag() {
        set({ tags: [...get().tags, { id: newId(), key: '', value: '', field: false }] });
    },
    setFieldTag(key, value) {
        const tags = get().tags;
        const current = tags.find(tag => tag.field && tag.key.toLowerCase() === key);
        if (value === '') {
            set({ tags: tags.filter(tag => tag !== current) });
        } else if (current) {
            set({ tags: tags.map(tag => (tag === current ? { ...tag, value } : tag)) });
        } else {
            set({ tags: [...tags, { id: newId(), key, value, field: true }] });
        }
    },
    updateTag(id, change) {
        set({ tags: get().tags.map(tag => (tag.id === id ? { ...tag, ...change } : tag)) });
    },
    removeTag(id) {
        set({ tags: get().tags.filter(tag => tag.id !== id) });
    },
    setLanguage(id, language) {
        set({ tracks: get().tracks.map(track => (track.id === id ? { ...track, language } : track)) });
    },
    setTitle(id, title) {
        set({ tracks: get().tracks.map(track => (track.id === id ? { ...track, title } : track)) });
    },
    setFlags(id, flags) {
        set({ tracks: get().tracks.map(track => (track.id === id ? { ...track, flags } : track)) });
    },
    setDefault(id, isDefault) {
        const target = get().tracks.find(track => track.id === id);
        if (!target) return;
        set({
            tracks: get().tracks.map(track => {
                if (track.id === id) return { ...track, isDefault };
                if (isDefault && track.kind === target.kind) return { ...track, isDefault: false };
                return track;
            }),
        });
    },
    addTracks(tracks) {
        set({
            tracks: [...get().tracks, ...tracks.map(track => ({ ...track, id: newId(), added: true, removed: false }))],
        });
    },
    removeTrack(id) {
        const tracks = get().tracks;
        const target = tracks.find(track => track.id === id);
        if (!target || isLastVideo(tracks, id)) return false;
        set({
            tracks: target.added
                ? tracks.filter(track => track.id !== id)
                : tracks.map(track => (track.id === id ? { ...track, removed: true } : track)),
        });
        return true;
    },
    restoreTrack(id) {
        const tracks = get().tracks;
        const target = tracks.find(track => track.id === id);
        if (!target) return;
        const defaultTaken = outputTracks(tracks).some(track => track.kind === target.kind && track.isDefault);
        set({
            tracks: tracks.map(track =>
                track.id === id ? { ...track, removed: false, isDefault: track.isDefault && !defaultTaken } : track
            ),
        });
    },
    addChapter(chapter) {
        if (startTaken(get().chapters, chapter.start, null)) return false;
        set({ chapters: [...get().chapters, { ...chapter, id: newId() }].sort(byStart) });
        return true;
    },
    setChapterTitle(id, title) {
        set({ chapters: get().chapters.map(chapter => (chapter.id === id ? { ...chapter, title } : chapter)) });
    },
    removeChapter(id) {
        set({ chapters: get().chapters.filter(chapter => chapter.id !== id) });
    },
    setChapterStart(id, time) {
        const chapters = [...get().chapters];
        const position = chapters.findIndex(chapter => chapter.id === id);
        const chapter = chapters[position];
        if (!chapter || time >= chapter.end - SAME_TIME) return false;
        const previous = chapters[position - 1];
        if (previous && time < previous.end - SAME_TIME) return false;
        chapters[position] = { ...chapter, start: time };
        set({ chapters });
        return true;
    },
    setChapterTimes(id, start, end) {
        if (chapterTimesError(get().chapters, id, start, end)) return false;
        set({
            chapters: get()
                .chapters.map(chapter => (chapter.id === id ? { ...chapter, start, end } : chapter))
                .sort(byStart),
        });
        return true;
    },
    setChapterEnd(id, time) {
        const chapters = [...get().chapters];
        const position = chapters.findIndex(chapter => chapter.id === id);
        const chapter = chapters[position];
        if (!chapter || time <= chapter.start + SAME_TIME) return false;
        const next = chapters[position + 1];
        if (next && time > next.start + SAME_TIME) return false;
        chapters[position] = { ...chapter, end: time };
        set({ chapters });
        return true;
    },
    markSaved() {
        const { tags, tracks, chapters } = get();
        set({ baseline: snapshot({ tags, tracks, chapters }) });
    },
    reset() {
        set({ ...INITIAL });
    },
}));

// 変更があるか
export function hasTrackTagChanges(state: Pick<VideoTrackTagState, 'tags' | 'tracks' | 'chapters' | 'baseline'>) {
    return state.baseline !== '' && snapshot(state) !== state.baseline;
}

// 書き出しの依頼
export function saveRequestOf(state: VideoTrackTagState, output: string): TrackTagSaveRequest {
    return {
        input: state.input ?? '',
        output,
        formatTags: state.tags.map(({ key, value }) => ({ key: key.trim(), value })),
        tracks: outputTracks(state.tracks).map(
            ({ source, streamIndex, kind, codec, language, title, isDefault, flags }) => ({
                source,
                streamIndex,
                kind,
                codec,
                language,
                title: title.trim(),
                isDefault,
                flags,
            })
        ),
        chapters: state.chapters.map(({ title, start, end, tags }) => ({ title, start, end, tags })),
    };
}
