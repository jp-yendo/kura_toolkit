import type { ChapterInfo } from '../../../shared/types';

// FFMETADATA の生成

// FFMETADATA の特殊文字をエスケープする
export function escapeMeta(value: string): string {
    let result = value;
    for (const char of ['\\', '=', ';', '#']) {
        result = result.split(char).join('\\' + char);
    }
    return result;
}

// 出力に含まれるチャプター。ストリームコピーでは切り出しが外側へ広がるため (始まりは直前のキーフレームまで、終わりは
// 後ろのフレームの表示に要るところまで)、出力には前後のチャプターの一部が入る。その部分も元のチャプターとして含め、
// 選んだチャプターが元と同じ位置から始まり、同じ位置で終わるようにする (mp4 のチャプターは先頭から隙間なく並ぶ形式で、
// 最初のチャプターが 0 秒より後に始まると 0 秒からに詰められてしまうため)。
// contentStart・contentEnd は出力に入っている内容の始まりと終わりの元の時刻 (再エンコードでは選んだ範囲と同じになり、
// 前後のチャプターは含めない)
export function chaptersInOutput(
    chapters: ChapterInfo[],
    first: number,
    last: number,
    contentStart: number,
    contentEnd: number
): ChapterInfo[] {
    let start = first;
    let end = last;
    // 1ms 未満しか重ならないものは、時刻の丸めの差のため含めない
    while (start > 0 && chapters[start - 1].end - contentStart > 0.001) start -= 1;
    while (end < chapters.length - 1 && contentEnd - chapters[end + 1].start > 0.001) end += 1;
    return chapters.slice(start, end + 1);
}

// 出力の 0 秒に当たる元の時刻 base を基準に FFMETADATA を生成する。
// base は実測した出力の始まりのため、チャプター位置と実映像が一致する
export function buildMetadata(
    chapters: ChapterInfo[],
    first: number,
    last: number,
    base: number,
    contentStart: number,
    contentEnd: number
): string {
    const lines = [';FFMETADATA1'];
    for (const chapter of chaptersInOutput(chapters, first, last, contentStart, contentEnd)) {
        lines.push('[CHAPTER]');
        lines.push('TIMEBASE=1/1000');
        lines.push(`START=${Math.max(0, Math.round((chapter.start - base) * 1000))}`);
        // 出力の内容の終わりを超えないようにする (後ろのチャプターは出力に入っている部分だけ)
        lines.push(`END=${Math.round((Math.min(chapter.end, contentEnd) - base) * 1000)}`);
        // タイトルのほか、言語などのタグもすべて引き継ぐ
        for (const [key, value] of Object.entries(chapter.tags)) {
            lines.push(`${escapeMeta(key)}=${escapeMeta(value)}`);
        }
    }
    return lines.join('\n') + '\n';
}
