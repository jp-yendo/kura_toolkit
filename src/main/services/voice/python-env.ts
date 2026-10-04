import path from 'path';
import { resolveFfmpegPath, resolveFfprobePath } from '../ffmpeg/ffmpeg';
import { libraryPaths, modelPaths } from './paths';
import { TTS_NLTK_DIR } from './spec';
import type { VoiceComponentId } from '../../../shared/voice/types';

// Python を起動するときの環境変数。
// 各ライブラリは既定でホームディレクトリ配下にキャッシュやモデルを書き込むため、キャッシュの書き込み先を
// ライブラリディレクトリ内のそのライブラリのディレクトリに向け、モデルはモデルディレクトリから読ませる
// (削除後の残留と、利用者の確認を経ないダウンロードの両方を防ぐ)。
// 一時ファイルの置き場 (TEMP / TMP / TMPDIR) は、プロセスを起動する側がプロセスごとに作業ディレクトリに作って渡す
// (process-runner.ts / python-worker.ts)。
// Hugging Face などのダウンロードはオフライン指定で止め、必要なものはアプリのダウンロード画面から取得する。

// 利用者の環境の Python 関連の設定を持ち込まない (別の Python やパッケージを読み込まないため)。
// pip の設定 (PIP_ で始まる環境変数と設定ファイル) も持ち込まない (導入先や取得元が変わると導入が失敗するため)
const STRIPPED_VARIABLES = [
    'PYTHONHOME',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'PYTHONUSERBASE',
    'VIRTUAL_ENV',
    'CONDA_PREFIX',
    'CONDA_DEFAULT_ENV',
    'AUDIO_SEPARATOR_MODEL_DIR',
];

export function buildPythonEnv(
    component: VoiceComponentId | null,
    extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
    const lib = libraryPaths();
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(env)) {
        if (STRIPPED_VARIABLES.includes(name.toUpperCase()) || name.toUpperCase().startsWith('PIP_')) delete env[name];
    }
    Object.assign(env, {
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        PYTHONNOUSERSITE: '1',
        // pip の設定ファイルを読まない (os.devnull を指定すると、すべての設定ファイルを読まなくなる)
        PIP_CONFIG_FILE: process.platform === 'win32' ? 'nul' : '/dev/null',
        // 同梱スクリプトの隣に __pycache__ を作らせない (macOS ではアプリ本体の署名が壊れるため)。
        // パッケージは導入時に pip がバイトコードを作成済みなので、起動時間への影響は小さい
        PYTHONDONTWRITEBYTECODE: '1',
        // Hugging Face / transformers: 通信しない
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        HF_DATASETS_OFFLINE: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
        MPLBACKEND: 'Agg',
        // 利用状況の送信を止める
        DO_NOT_TRACK: '1',
        GRADIO_ANALYTICS_ENABLED: 'False',
        PYANNOTE_METRICS_ENABLED: 'false',
    });

    if (component) {
        // キャッシュはそのライブラリのディレクトリに置く (仮想環境を使わない処理 (pip など) はこれらを使わない)。
        // フォルダは各ライブラリが書き込むときに作る
        const cache = (name: string) => path.join(lib.cache(component), name);
        Object.assign(env, {
            HF_HOME: cache('huggingface'),
            TORCH_HOME: cache('torch'),
            TORCHINDUCTOR_CACHE_DIR: cache('torchinductor'),
            XDG_CACHE_HOME: cache('xdg'),
            NUMBA_CACHE_DIR: cache('numba'),
            MPLCONFIGDIR: cache('matplotlib'),
            // モデルの場所 (上流のスクリプトが自分のフォルダ内で探すモデルを、モデルディレクトリから読ませる)
            KURA_APPLIO_MODELS: modelPaths().group('converter'),
            KURA_SBV2_MODELS: modelPaths().group('tts'),
            NLTK_DATA: modelPaths().file(TTS_NLTK_DIR),
        });
    }

    if (process.platform === 'darwin') {
        // MPS で未対応の演算は CPU で処理して続行する
        Object.assign(env, {
            PYTORCH_ENABLE_MPS_FALLBACK: '1',
            PYTORCH_MPS_HIGH_WATERMARK_RATIO: '0.0',
            KMP_DUPLICATE_LIB_OK: 'TRUE',
        });
    }
    if (process.platform === 'win32') {
        // PyTorch の分散処理の初期化 (学習で 1 プロセスでも使われる) が libuv 無しのビルドで失敗するのを避ける
        env.USE_LIBUV = '0';
    }

    // ffmpeg / ffprobe はアプリの設定で選んだものを Python 側でも使わせる (PATH の先頭に置く)
    const ffmpeg = resolveFfmpegPath();
    const ffprobe = resolveFfprobePath();
    const pathParts: string[] = [];
    if (ffmpeg) pathParts.push(path.dirname(ffmpeg));
    if (ffprobe) pathParts.push(path.dirname(ffprobe));
    if (component) {
        const envDir = lib.env(component);
        pathParts.push(process.platform === 'win32' ? path.join(envDir, 'Scripts') : path.join(envDir, 'bin'));
    }
    const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = [...new Set([...pathParts, ...(env[pathKey] ?? '').split(path.delimiter).filter(Boolean)])].join(
        path.delimiter
    );
    Object.assign(env, extra);
    return env;
}
