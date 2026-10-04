import { readLibraryManifest, writeLibraryManifest } from './library-manifest';
import { readModelManifest, writeModelManifest } from './model-manifest';

// 取得状況の記録。取得し終えた項目だけを記録し、途中で失敗・中断した項目は記録しない (次回に取得し直す)。
// 記録は置き場所ごとのファイルに分け (それぞれの場所を個別に移動・変更しても、記録が中身と一緒に動くように)、
// ここでは 2 つを合わせて扱う
// - <ライブラリディレクトリ>/manifest.json: Python 本体とパッケージ一式 (library-manifest.ts)
// - <モデルディレクトリ>/manifest.json: ダウンロードしたモデル (model-manifest.ts)

export type ManifestEntry = {
    version: string;
    // パッケージ一式の CUDA 版の種類など (環境によって中身が変わるもの)
    variant?: string;
    installedAt: number;
    // 動作確認に失敗し、作り直しが必要 (ライブラリの移動後など)
    broken?: boolean;
};

// ダウンロードしたモデルの記録
export type ModelManifestEntry = ManifestEntry & {
    // 取得したファイル。モデルディレクトリからの相対パス (モデルを削除するときは、ここにあるファイルだけを消す)
    files: string[];
};

export type LibraryManifest = {
    python: ManifestEntry | null;
    components: Record<string, ManifestEntry>;
    models: Record<string, ModelManifestEntry>;
};

// 読み書きするライブラリディレクトリ (省略時は設定の場所)。モデルディレクトリは常に設定の場所を使う
type ManifestRoots = { library?: string };

export function readManifest(roots: ManifestRoots = {}): LibraryManifest {
    const library = readLibraryManifest(roots.library);
    const models = readModelManifest();
    return { python: library.python, components: library.components, models: models.models };
}

// 記録を読み、変更して書き戻す。変わった側のファイルだけを書く (もう一方の場所には触れない)
export function updateManifest(mutate: (manifest: LibraryManifest) => void, roots: ManifestRoots = {}): void {
    const manifest = readManifest(roots);
    const libraryPart = () => ({ version: 1 as const, python: manifest.python, components: manifest.components });
    const modelPart = () => ({ version: 1 as const, models: manifest.models });
    const before = [JSON.stringify(libraryPart()), JSON.stringify(modelPart())];
    mutate(manifest);
    if (JSON.stringify(libraryPart()) !== before[0]) writeLibraryManifest(libraryPart(), roots.library);
    if (JSON.stringify(modelPart()) !== before[1]) writeModelManifest(modelPart());
}
