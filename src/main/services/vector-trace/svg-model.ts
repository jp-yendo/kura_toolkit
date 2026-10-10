import type { ImageSize } from './types';

// 変換ライブラリが出力する SVG (path 要素だけを並べたもの) の読み取りと書き出し。
// 形 (d と transform) は変換ライブラリの出力をそのまま持ち、塗りの色と並び順だけを変える

export type SvgPath = {
    d: string;
    fill: string;
    // transform 属性 (無い場合は null)
    transform: string | null;
};

export type SvgModel = {
    width: number;
    height: number;
    paths: SvgPath[];
};

function attribute(attributes: string, name: string): string | null {
    return new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;
}

// SVG の大きさと path 要素を読む。形の無い path (d が空) は除く
// SVG の path 要素の数
export function countPaths(svg: string): number {
    return svg.match(/<path\b/g)?.length ?? 0;
}

export function parseSvg(svg: string): SvgModel {
    const root = /<svg\b([^>]*)>/.exec(svg)?.[1] ?? '';
    const width = Number(attribute(root, 'width'));
    const height = Number(attribute(root, 'height'));
    if (!(width > 0) || !(height > 0)) throw new Error('VECTORIZE_FAILED: unexpected SVG output');
    const paths: SvgPath[] = [];
    for (const match of svg.matchAll(/<path\b([^>]*?)\/?>/g)) {
        const d = (attribute(match[1], 'd') ?? '').trim();
        if (!d) continue;
        paths.push({ d, fill: attribute(match[1], 'fill') ?? '#000000', transform: attribute(match[1], 'transform') });
    }
    return { width, height, paths };
}

// SVG を書き出す。fills を渡すと、塗りの色を順にそれで置き換える
export function toSvg(model: SvgModel, fills?: string[]): string {
    const body = model.paths
        .map((path, i) => {
            const transform = path.transform ? ` transform="${path.transform}"` : '';
            return `<path d="${path.d}" fill="${fills ? fills[i] : path.fill}"${transform}/>`;
        })
        .join('\n');
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" ` +
        `viewBox="0 0 ${model.width} ${model.height}">\n${body}\n</svg>\n`
    );
}

// SVG の枠 (表示の大きさ (width / height)、座標の範囲 (viewBox)、縦横の比の合わせ方 (preserveAspectRatio。無い場合は null))
export type SvgFrame = {
    width: string;
    height: string;
    viewBox: string;
    preserveAspectRatio: string | null;
};

// SVG のルート要素の枠を読む。viewBox が無いときは、width / height と同じ範囲とみなす
export function readSvgFrame(svg: string): SvgFrame {
    const root = /<svg\b([^>]*)>/.exec(svg)?.[1] ?? '';
    const width = attribute(root, 'width');
    const height = attribute(root, 'height');
    const viewBox = attribute(root, 'viewBox') ?? (width && height ? `0 0 ${width} ${height}` : null);
    if (!width || !height || !viewBox) throw new Error('VECTORIZE_FAILED: unexpected SVG output');
    return { width, height, viewBox, preserveAspectRatio: attribute(root, 'preserveAspectRatio') };
}

// SVG のルート要素の width / height / viewBox / preserveAspectRatio を frame の値にする (ほかの属性と中身はそのまま)
export function withSvgFrame(svg: string, frame: SvgFrame): string {
    return svg.replace(/<svg\b([^>]*?)(\/?)>/, (_match, attributes: string, selfClosing: string) => {
        const rest = attributes.replace(/\s(width|height|viewBox|preserveAspectRatio)="[^"]*"/g, '');
        const aspect = frame.preserveAspectRatio === null ? '' : ` preserveAspectRatio="${frame.preserveAspectRatio}"`;
        return `<svg${rest} width="${frame.width}" height="${frame.height}" viewBox="${frame.viewBox}"${aspect}${selfClosing}>`;
    });
}

// SVG の表示の大きさを size にする (座標の範囲 (viewBox) は変えない)。座標の範囲と表示の大きさの縦横の比は、
// 丸めのために少し違うことがある (極端に細長い画像では大きく違う) ため、比を保たずに全体を表示の大きさに合わせる
// (preserveAspectRatio="none")
export function withDisplaySize(svg: string, size: ImageSize): string {
    const frame = readSvgFrame(svg);
    return withSvgFrame(svg, {
        ...frame,
        width: String(size.width),
        height: String(size.height),
        preserveAspectRatio: 'none',
    });
}

// 塗りが黒 (#000000) の形 (白黒モードの変換で、黒の画素から作った形)
export function blackPaths(model: SvgModel): SvgPath[] {
    return model.paths.filter(path => path.fill.toLowerCase() === '#000000');
}
