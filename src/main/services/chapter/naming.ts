import path from 'path';
import type { FfStream } from './probe';
import type { ChapterInfo } from '../../../shared/types';

// 映像として描画するタイプの字幕 (テキストではないもの)
const BITMAP_SUBTITLES = new Set(['dvd_subtitle', 'hdmv_pgs_subtitle', 'hdmv_text_subtitle', 'dvb_subtitle', 'xsub']);

// mp4 系のコンテナはビットマップ字幕の扱いが不十分なため、その場合は mkv へ切り替える。
// - VOBSUB: 表示領域の大きさとパレットを正しく持てず、VLC で巨大化・色化けする
// - PGS: そもそも mp4 に格納できない
export function resolveSubtitleFriendlyOutput(outputPath: string, streams: FfStream[]): string {
    const extension = path.extname(outputPath).toLowerCase();
    if (!['.mp4', '.m4v', '.mov'].includes(extension)) return outputPath;
    const hasBitmapSubtitle = streams.some(
        stream => stream.codec_type === 'subtitle' && BITMAP_SUBTITLES.has(stream.codec_name ?? '')
    );
    if (!hasBitmapSubtitle) return outputPath;
    return `${outputPath.slice(0, outputPath.length - extension.length)}.mkv`;
}

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

// 出力先ディレクトリ (未指定なら入力と同一ディレクトリ) を返す。
function outputDirectory(inputPath: string, outputDir: string | null): string {
    return outputDir || path.dirname(path.resolve(inputPath));
}

// [入力ファイル名]-[fromラベル]-[toラベル].[拡張子] を生成する。
// outputDir が指定されていればそこへ、なければ入力と同一ディレクトリに出力する。
export function defaultOutputPath(
    inputPath: string,
    fromLabel: string,
    toLabel: string,
    outputDir: string | null
): string {
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const name = `${base}-${sanitizeForFilename(fromLabel)}-${sanitizeForFilename(toLabel)}${ext}`;
    return path.join(outputDirectory(inputPath, outputDir), name);
}

// 明示指定されたファイル名を出力先ディレクトリの下のパスに変換する。
// ディレクトリ部が混ざっていても最後の要素だけを使い、出力先が入れ替わらないようにする。
export function namedOutputPath(inputPath: string, outputDir: string | null, fileName: string): string {
    let name = sanitizeForFilename(path.basename(fileName.replace(/\\/g, '/')));
    // 拡張子が無いと ffmpeg が出力形式を決められないため、入力と同じ拡張子を補う
    if (!path.extname(name)) name += path.extname(inputPath);
    return path.join(outputDirectory(inputPath, outputDir), name);
}
