import path from 'path';
import { app } from 'electron';
import { getLibraryDir, getModelDir } from '../storage';
import type { VoiceComponentId, VoiceModelFeature } from '../../../shared/voice/types';

// 音声機能 (分離・変換・読み上げ) が使う場所の解決。
// 保存場所そのもの (ライブラリ・モデル・作業ディレクトリ) はアプリ全体の設定 (storage.ts) で、
// ここではその中での音声機能の配置を決める。
// - ライブラリディレクトリ: Python 本体と、ライブラリごとのディレクトリ (仮想環境・ソース一式・キャッシュ)
// - モデルディレクトリ: audio/<separation|conversion|tts>/ (ダウンロードしたモデル・声のモデル)

// コンポーネント (仮想環境の単位) と、それを収めるライブラリディレクトリ内のディレクトリ
const LIBRARY_NAMES: Record<VoiceComponentId, string> = {
    separator: 'audio-separator',
    converter: 'applio',
    tts: 'style-bert-vits2',
};

// 音声機能のモデルを置く場所 (モデルディレクトリからの相対パス。分類 audio の下に機能ごと)
export const MODEL_GROUP_DIRS: Record<VoiceComponentId, string> = {
    separator: 'audio/separation',
    converter: 'audio/conversion',
    tts: 'audio/tts',
};

// ライブラリディレクトリ内の構成
export function libraryPaths(root = getLibraryDir()) {
    const library = (component: VoiceComponentId) => path.join(root, LIBRARY_NAMES[component]);
    return {
        // Python 本体・パッケージ一式の取得状況の記録
        manifest: path.join(root, 'manifest.json'),
        python: path.join(root, 'python'),
        // Python 本体の書庫 (展開先と同じディスクに取得し、展開したら消す)
        pythonArchive: path.join(root, 'python.tar.gz'),
        // pip のキャッシュ (仮想環境へ展開するパッケージを、展開先と同じディスクに置く。取得が全て成功したら消す)
        pipCache: path.join(root, 'pip-cache'),
        library,
        env: (component: VoiceComponentId) => path.join(library(component), 'venv'),
        // GitHub から取得するソース一式 (Applio / Style-Bert-VITS2 の学習用のリポジトリ)
        source: (component: 'converter' | 'tts') => path.join(library(component), 'source'),
        // ソース一式の書庫 (展開先と同じディスクに取得し、展開したら消す)
        sourceArchive: (component: 'converter' | 'tts') => path.join(library(component), 'source.tar.gz'),
        // 各ライブラリが既定でホームディレクトリ配下に書き込むキャッシュの書き込み先
        cache: (component: VoiceComponentId) => path.join(library(component), 'cache'),
    };
}

// モデルディレクトリ内の構成
export function modelPaths() {
    const root = getModelDir();
    const group = (component: VoiceComponentId) => path.join(root, ...MODEL_GROUP_DIRS[component].split('/'));
    return {
        root,
        // ダウンロードしたモデルの取得状況の記録
        manifest: path.join(root, 'manifest.json'),
        group,
        // 利用者が学習・取り込みした声のモデル
        voices: (feature: VoiceModelFeature) => path.join(group(feature), 'voices'),
        // モデルディレクトリからの相対パス (/ 区切り) を絶対パスにする
        file: (relative: string) => path.join(root, ...relative.split('/')),
    };
}

// Python 本体の実行ファイル
export function pythonExecutable(): string {
    const base = libraryPaths().python;
    return process.platform === 'win32' ? path.join(base, 'python.exe') : path.join(base, 'bin', 'python3');
}

// 仮想環境の Python
export function envPythonExecutable(component: VoiceComponentId): string {
    const env = libraryPaths().env(component);
    return process.platform === 'win32' ? path.join(env, 'Scripts', 'python.exe') : path.join(env, 'bin', 'python');
}

// アプリに同梱した Python の補助スクリプト (python) と、外部から取り込んだデータ (third_party。読み上げの学習用の文章など)
// (配布時は electron-builder の extraResources で Electron の resources/ 直下に置く)
export function bundledResourceDir(name: 'python' | 'third_party'): string {
    if (app.isPackaged) return path.join(process.resourcesPath, name);
    // 開発時はリポジトリ内のファイルを直接使う (dist/main/services/voice から 4 階層上がリポジトリ)
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    return name === 'python' ? path.join(repoRoot, 'src', 'python') : path.join(repoRoot, 'third_party');
}
