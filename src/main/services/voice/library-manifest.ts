import { readJsonFile, writeJsonFile } from './json-file';
import { libraryPaths } from './paths';
import type { ManifestEntry } from './manifest';

// Python 本体とパッケージ一式の取得記録 (<ライブラリディレクトリ>/manifest.json)

type LibraryManifestFile = {
    version: 1;
    python: ManifestEntry | null;
    components: Record<string, ManifestEntry>;
};

// 記録が無い場合は、何も取得していない状態を返す。読めない・壊れている場合は DATA_FILE_CORRUPT で失敗する
export function readLibraryManifest(root?: string): LibraryManifestFile {
    return (
        readJsonFile<LibraryManifestFile>(libraryPaths(root).manifest) ?? { version: 1, python: null, components: {} }
    );
}

export function writeLibraryManifest(data: LibraryManifestFile, root?: string): void {
    writeJsonFile(libraryPaths(root).manifest, data);
}
