import path from 'path';
import type { ChapterInfo } from '../../../shared/types';

// 出力ファイル名の生成 (元: cut-chapter.py の sanitize_for_filename / default_output_path)

// 出力ファイル名の可搬性のため、全 OS で Windows の制約を適用する
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
const WINDOWS_RESERVED_NAMES = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
]);

// ファイル名に使用できない文字のみアンダースコアに置換する
export function sanitizeForFilename(value: string): string {
    let result = value.replace(INVALID_FILENAME_CHARS, '_');
    // Windows ではファイル名末尾のスペースとピリオドが不可のため除去する
    result = result.replace(/[ .]+$/, '');
    // Windows の予約デバイス名と一致する場合は回避する
    if (WINDOWS_RESERVED_NAMES.has(result.toUpperCase())) {
        result = result + '_';
    }
    if (!result) {
        result = 'x';
    }
    return result;
}

// ファイル名用ラベルを返す (タイトルがあればタイトル、なければ id)
export function chapterLabel(chapter: ChapterInfo): string {
    return chapter.title ? chapter.title : chapter.id;
}

// [入力ファイル名]-[fromラベル]-[toラベル].[拡張子] を生成する。
// outputDir が指定されていればそこへ、なければ入力と同一ディレクトリに出力する。
export function defaultOutputPath(
    inputPath: string,
    fromLabel: string,
    toLabel: string,
    outputDir: string | null
): string {
    const directory = outputDir || path.dirname(path.resolve(inputPath));
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const name = `${base}-${sanitizeForFilename(fromLabel)}-${sanitizeForFilename(toLabel)}${ext}`;
    return path.join(directory, name);
}
