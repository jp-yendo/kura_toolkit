import fs from 'fs';
import path from 'path';
import { runFfmpeg } from '../ffmpeg/ffmpeg';
import { combineAss, type AssPart } from './ass-merge';
import { shiftTextSubtitles } from './subtitles';
import type { SubtitleTrackPlan } from '../../../shared/video-merge';

// 結合するときの字幕。各ファイルの字幕を 1 本につなげたファイルを作り、映像・音声と一緒に出力へ取り込む
// (再エンコードで使う concat フィルタは字幕を扱えず、ストリームコピーでも出力形式に合わせて変換が要るため、どちらも同じ方法による)

export type SubtitleSource = {
    input: string;
    // 結合後のファイルでの始まりの位置 (秒) と長さ
    offset: number;
    duration: number;
};

const FFMPEG_QUIET = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];

// concat の一覧に書くパス (区切りを / にそろえ、単一引用符の中の ' は引用を閉じてからエスケープして書く)
export function concatPath(filePath: string): string {
    return `'${path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

// テキストの字幕を 1 本につなげる。各ファイルの字幕を SRT か ASS で取り出し、結合後の位置へ時刻をずらして並べる
async function buildTextTrack(
    sources: SubtitleSource[],
    plan: Extract<SubtitleTrackPlan, { kind: 'text' }>,
    tempDir: string,
    name: string,
    jobId: string
): Promise<string> {
    const { style } = plan;
    const parts: AssPart[] = [];
    for (let i = 0; i < sources.length; i++) {
        const track = plan.parts[i];
        if (track === null) continue;
        const source = sources[i];
        const part = path.join(tempDir, `${name}-${i}.${style}`);
        await runFfmpeg(
            [...FFMPEG_QUIET, '-i', source.input, '-map', `0:s:${track}`, '-c:s', style, '-f', style, part],
            { jobId }
        );
        const raw = fs.readFileSync(part, 'utf-8');
        // 先頭の BOM は時刻の行の判定を妨げるため外す
        const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
        // ファイルの長さを超えて表示し続けるものは、次のファイルに重ならないようそのファイルの終わりで切る
        parts.push({
            file: i + 1,
            content: shiftTextSubtitles(content, style, source.offset, source.offset + source.duration),
        });
    }
    // SRT はつなげた後に、通し番号を 1 から振り直す (時刻はずらさない)
    const combined =
        style === 'ass'
            ? combineAss(parts)
            : shiftTextSubtitles(parts.map(part => part.content).join('\n\n'), 'srt', 0, Number.POSITIVE_INFINITY);
    const target = path.join(tempDir, `${name}.${style}`);
    fs.writeFileSync(target, combined, 'utf-8');
    return target;
}

// 画像の字幕を 1 本につなげる。字幕を持つファイルからそれぞれ字幕だけを取り出し、concat でつなげる。
// 各ファイルの長さを「次に字幕を持つファイルの始まりまで」とすることで、字幕を持たないファイルの分を空ける。
// inpoint 0 は、取り出したファイルの最初の字幕が 0 秒に寄せられないようにするため。
// 戻り値の offset は、1 つ目の字幕を持つファイルの始まりの位置 (取り込むときにずらす)
async function buildBitmapTrack(
    sources: SubtitleSource[],
    plan: Extract<SubtitleTrackPlan, { kind: 'bitmap' }>,
    tempDir: string,
    name: string,
    jobId: string
): Promise<{ file: string; offset: number }> {
    const present = sources.map((_, i) => i).filter(i => plan.parts[i] !== null);
    const lines = ['ffconcat version 1.0'];
    for (let j = 0; j < present.length; j++) {
        const i = present[j];
        const part = path.join(tempDir, `${name}-${i}.mkv`);
        await runFfmpeg([...FFMPEG_QUIET, '-i', sources[i].input, '-map', `0:s:${plan.parts[i]}`, '-c', 'copy', part], {
            jobId,
        });
        const next = present[j + 1];
        const length = next === undefined ? sources[i].duration : sources[next].offset - sources[i].offset;
        lines.push(`file ${concatPath(part)}`, 'inpoint 0', `duration ${length.toFixed(6)}`);
    }
    const listPath = path.join(tempDir, `${name}.txt`);
    fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf-8');
    const target = path.join(tempDir, `${name}.mkv`);
    await runFfmpeg(
        [...FFMPEG_QUIET, '-f', 'concat', '-safe', '0', '-i', listPath, '-map', '0', '-c', 'copy', target],
        {
            jobId,
        }
    );
    return { file: target, offset: sources[present[0]].offset };
}

// つなげた字幕のファイルを作る。戻り値は、ffmpeg の入力の指定 (-itsoffset と -i) と、字幕ごとの扱いのログ
export async function buildSubtitleTracks(
    sources: SubtitleSource[],
    plans: SubtitleTrackPlan[],
    tempDir: string,
    jobId: string
): Promise<Array<{ inputArgs: string[]; plan: string }>> {
    const tracks: Array<{ inputArgs: string[]; plan: string }> = [];
    for (let n = 0; n < plans.length; n++) {
        const plan = plans[n];
        const name = `subtitle${n}`;
        if (plan.kind === 'text') {
            const file = await buildTextTrack(sources, plan, tempDir, name, jobId);
            tracks.push({ inputArgs: ['-i', file], plan: `text (${plan.style}) -> ${plan.encoder}` });
        } else {
            const { file, offset } = await buildBitmapTrack(sources, plan, tempDir, name, jobId);
            const shift = offset > 0.0005 ? ['-itsoffset', offset.toFixed(6)] : [];
            tracks.push({ inputArgs: [...shift, '-i', file], plan: `${plan.codec} -> copy` });
        }
    }
    return tracks;
}
