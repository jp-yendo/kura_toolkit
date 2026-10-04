import type { MediaRef, SeparationCandidate, SeparationCategory } from '@shared/voice/types';

// 分離の段階と採用から、最終的な出力 (トラック) を求める。
// 段階は前の段階の出力 (トラック) の 1 つを入力にし、採用した結果でそのトラックを置き換える。
// - ボーカルと伴奏の 2 分割: 入力 -> ボーカル + 伴奏 (伴奏は既存の伴奏に加える)
// - メインボーカルとバックコーラス: 入力 -> メイン (取り除いたコーラスは破棄するか伴奏に戻す)。
//   元音源に直接かけた場合はボーカルと伴奏の 2 分割と同じ扱い
// - 整音 (残響・エコー・ノイズの除去): 入力 -> 整音後 (取り除いた音は破棄)
// - 多分割・その他: 入力 -> 出力ごとのトラック

type StemRole = string;

export type SepStage = {
    id: string;
    // 入力にするトラック (1 段目は元音源 = 'source')
    inputKey: string;
    category: SeparationCategory;
    candidates: SeparationCandidate[];
    adoptionMode: 'same' | 'separate';
    sameCandidate: string | null;
    perRole: Record<StemRole, string | null>;
    // メインボーカルとバックコーラスの分割で、取り除いたコーラスを伴奏に戻す
    removedToAccompaniment: boolean;
};

export type Track = {
    key: string;
    // 翻訳キー (labelKey) か、そのままの名前 (label)
    labelKey?: string;
    label?: string;
    // 重ねて 1 つにする音声 (伴奏に戻したコーラスなど、複数の場合がある)
    paths: string[];
};

export const SOURCE_KEY = 'source';
const VOCALS_KEY = 'vocals';
const ACCOMPANIMENT_KEY = 'accompaniment';

const TWO_STEM: SeparationCategory[] = ['vocals', 'karaoke', 'cleanup'];

function normalize(name: string): string {
    return name.toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function primaryScore(category: SeparationCategory, name: string): number {
    const n = normalize(name);
    if (category === 'vocals') {
        if (/no ?vocal|instrument|karaoke|other|accompan/.test(n)) return -1;
        return /vocal|voice|voc\b/.test(n) ? 1 : 0;
    }
    if (category === 'karaoke') {
        if (/back|instrument|karaoke|other|no /.test(n)) return -1;
        return /lead|main|vocal/.test(n) ? 1 : 0;
    }
    // 整音: 取り除いた後の音 (No Reverb / dry / noreverb など) を残す。
    // 取り除く音 (残響・エコー・ノイズ・歓声・息の音) と判定した側の反対を残す
    if (/^(no |no(reverb|echo|noise|crowd|aspiration|breath))|dry|clean/.test(n) && !/no ?dry/.test(n)) return 1;
    if (/reverb|echo|noise|other|wet|crowd|aspiration|breath/.test(n)) return -1;
    return 0;
}

// 候補の出力ごとの役割。2 分割の種類は primary (残す側) / secondary (取り除く側)、それ以外は出力名
export function assignRoles(category: SeparationCategory, stems: string[]): Record<string, StemRole> {
    const roles: Record<string, StemRole> = {};
    if (!TWO_STEM.includes(category) || stems.length !== 2) {
        for (const stem of stems) roles[stem] = normalize(stem) || 'stem';
        return roles;
    }
    const scores = stems.map(stem => primaryScore(category, stem));
    // 判定できない場合は、取り除く側と判定された方の反対、それも無ければ先頭を残す側とする
    let primary = scores.indexOf(1);
    if (primary < 0) primary = scores.indexOf(-1) === 0 ? 1 : 0;
    stems.forEach((stem, index) => {
        roles[stem] = index === primary ? 'primary' : 'secondary';
    });
    return roles;
}

// 段階の中で採用の対象になる役割 (候補の役割の和集合)
export function stageRoles(stage: SepStage): StemRole[] {
    const roles: StemRole[] = [];
    for (const candidate of stage.candidates) {
        const assigned = assignRoles(
            stage.category,
            candidate.stems.map(stem => stem.name)
        );
        for (const role of Object.values(assigned)) if (!roles.includes(role)) roles.push(role);
    }
    return roles;
}

export function roleLabelKey(category: SeparationCategory, role: StemRole): string | null {
    if (role === 'primary' || role === 'secondary') return `voice.roles.${category}.${role}`;
    return null;
}

// 採用した候補の、役割ごとの出力
function adoptedStems(stage: SepStage): Record<StemRole, MediaRef> | null {
    const roles = stageRoles(stage);
    if (roles.length === 0) return null;
    const result: Record<StemRole, MediaRef> = {};
    for (const role of roles) {
        const candidateId = stage.adoptionMode === 'same' ? stage.sameCandidate : stage.perRole[role];
        const candidate = stage.candidates.find(item => item.id === candidateId);
        if (!candidate) return null;
        const assigned = assignRoles(
            stage.category,
            candidate.stems.map(stem => stem.name)
        );
        const stem = candidate.stems.find(item => assigned[item.name] === role);
        if (!stem) return null;
        result[role] = stem.media;
    }
    return result;
}

function stemTrack(role: StemRole, path: string): Track {
    const known = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano', 'instrumental'];
    return known.includes(role)
        ? { key: role, labelKey: `voice.stems.${role}`, paths: [path] }
        : { key: role, label: role, paths: [path] };
}

// 元音源と段階の並びから、各段階の後のトラックを求める。採用が済んでいない段階で打ち切る
export function computeTracks(
    sourcePath: string | null,
    stages: SepStage[]
): { tracks: Track[]; completedStages: number } {
    if (!sourcePath) return { tracks: [], completedStages: 0 };
    let tracks: Track[] = [{ key: SOURCE_KEY, labelKey: 'voice.tracks.source', paths: [sourcePath] }];
    let completed = 0;
    for (const stage of stages) {
        const adopted = adoptedStems(stage);
        const input = tracks.find(track => track.key === stage.inputKey);
        if (!adopted || !input) break;
        const rest = tracks.filter(track => track.key !== stage.inputKey);
        const addToAccompaniment = (paths: string[]) => {
            const existing = rest.find(track => track.key === ACCOMPANIMENT_KEY);
            if (existing) existing.paths = [...existing.paths, ...paths];
            else rest.push({ key: ACCOMPANIMENT_KEY, labelKey: 'voice.tracks.accompaniment', paths });
        };
        // 2 分割の種類でも、出力が 2 つでないモデルは出力ごとのトラックとして扱う
        const twoStem = !!adopted.primary && !!adopted.secondary;
        const splitsVocals =
            stage.category === 'vocals' || (stage.category === 'karaoke' && stage.inputKey === SOURCE_KEY);
        if (twoStem && splitsVocals) {
            rest.unshift({ key: VOCALS_KEY, labelKey: 'voice.tracks.vocals', paths: [adopted.primary.path] });
            addToAccompaniment([adopted.secondary.path]);
        } else if (twoStem && stage.category === 'karaoke') {
            rest.unshift({ ...input, paths: [adopted.primary.path] });
            if (stage.removedToAccompaniment) addToAccompaniment([adopted.secondary.path]);
        } else if (twoStem && stage.category === 'cleanup') {
            rest.unshift({ ...input, paths: [adopted.primary.path] });
        } else {
            for (const [role, media] of Object.entries(adopted)) {
                const track = stemTrack(role, media.path);
                const existing = rest.find(item => item.key === track.key);
                if (existing) existing.paths = [...existing.paths, media.path];
                else rest.push(track);
            }
        }
        tracks = rest.map(track => ({ ...track, paths: [...track.paths] }));
        completed += 1;
    }
    return { tracks, completedStages: completed };
}

// 変換に使うボーカルと伴奏 (伴奏はボーカル以外の出力をすべて重ねたもの)
export function vocalsAndAccompaniment(tracks: Track[]): { vocals: Track | null; accompaniment: string[] } {
    const vocals = tracks.find(track => track.key === VOCALS_KEY) ?? null;
    const accompaniment = tracks
        .filter(track => track.key !== VOCALS_KEY && track.key !== SOURCE_KEY)
        .flatMap(track => track.paths);
    return { vocals, accompaniment };
}
