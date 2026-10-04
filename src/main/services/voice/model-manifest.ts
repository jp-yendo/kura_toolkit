import { readJsonFile, writeJsonFile } from './json-file';
import { modelPaths } from './paths';
import type { ModelManifestEntry } from './manifest';

// ダウンロードしたモデルの取得記録 (<モデルディレクトリ>/manifest.json)

type ModelManifestFile = {
    version: 1;
    models: Record<string, ModelManifestEntry>;
};

// 記録が無い場合は、何も取得していない状態を返す。読めない・壊れている場合は DATA_FILE_CORRUPT で失敗する
export function readModelManifest(): ModelManifestFile {
    return readJsonFile<ModelManifestFile>(modelPaths().manifest) ?? { version: 1, models: {} };
}

export function writeModelManifest(data: ModelManifestFile): void {
    writeJsonFile(modelPaths().manifest, data);
}
