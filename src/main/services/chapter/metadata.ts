import type { ChapterInfo } from '../../../shared/types';

// FFMETADATA の生成 (元: cut-chapter.py の escape_meta / build_metadata)

// FFMETADATA の特殊文字をエスケープする
function escapeMeta(value: string): string {
    let result = value;
    for (const char of ['\\', '=', ';', '#']) {
        result = result.split(char).join('\\' + char);
    }
    return result;
}

// 出力映像の実際の開始時刻 base を基準に FFMETADATA を生成する。
// base はスナップ後の開始点のため、チャプター位置と実映像が一致する。
export function buildMetadata(chapters: ChapterInfo[], first: number, last: number, base: number): string {
    const lines = [';FFMETADATA1'];
    for (const chapter of chapters.slice(first, last + 1)) {
        lines.push('[CHAPTER]');
        lines.push('TIMEBASE=1/1000');
        lines.push(`START=${Math.max(0, Math.round((chapter.start - base) * 1000))}`);
        lines.push(`END=${Math.round((chapter.end - base) * 1000)}`);
        if (chapter.title) {
            lines.push(`title=${escapeMeta(chapter.title)}`);
        }
    }
    return lines.join('\n') + '\n';
}
