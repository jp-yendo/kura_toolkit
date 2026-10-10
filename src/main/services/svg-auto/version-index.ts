import fs from 'fs/promises';
import path from 'path';
import type { SvgAutoVersionSource } from '../../../shared/types';
import type { Trial } from './search';

// 作業ごとの置き場にある、今ある版の一覧 (version-index.json)。版が変わるたびに書き直す。
// 処理が途中で終わったとき (ワーカーのメモリ不足など) も、それまでに得た版をこの一覧から返せるようにする

const INDEX_FILE = 'version-index.json';

// 版のファイル (表示・保存できる SVG) と、その指標・設定
export type AutoVersionFile = {
    file: string;
    source: SvgAutoVersionSource;
    fidelity: number;
    pathCount: number;
    bytes: number;
    trial: Trial;
};

export type VersionIndex = {
    versions: AutoVersionFile[];
    // 変換を試した回数と、そのうち変換できなかった回数
    trials: number;
    failures: number;
};

// 一覧を書く (別の名前に書いてから置き換え、書きかけの一覧を読まないようにする)
export async function writeVersionIndex(dir: string, index: VersionIndex): Promise<void> {
    const file = path.join(dir, INDEX_FILE);
    const partial = `${file}.tmp`;
    await fs.writeFile(partial, JSON.stringify(index), 'utf-8');
    await fs.rename(partial, file);
}

// 一覧を読み、ファイルが残っている版だけを返す (一覧が無い・読めないときは null)
export async function readVersionIndex(dir: string): Promise<VersionIndex | null> {
    let index: VersionIndex;
    try {
        index = JSON.parse(await fs.readFile(path.join(dir, INDEX_FILE), 'utf-8')) as VersionIndex;
    } catch {
        return null;
    }
    if (!Array.isArray(index?.versions)) return null;
    const versions: AutoVersionFile[] = [];
    for (const version of index.versions) {
        const inside = path.resolve(version.file).startsWith(path.resolve(dir) + path.sep);
        if (inside && (await fs.stat(version.file).catch(() => null))) versions.push(version);
    }
    return { versions, trials: Number(index.trials) || 0, failures: Number(index.failures) || 0 };
}
