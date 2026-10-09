import path from 'path';
import type {
    CudaFlavor,
    LibraryItemGroup,
    VoiceComponentId,
    VoiceFeatureId,
    VoicePlatformInfo,
    VoicePlatformKey,
} from '../../../shared/voice/types';
import { languagesForModelType, TTS_LANGUAGE_MODEL_ITEMS, type VoiceLanguage } from '../../../shared/voice/languages';
import { SEPARATOR_MODEL_PREFIX, TTS_READY_PREFIX } from '../../../shared/voice/requirements';
import { libraryPaths, MODEL_GROUP_DIRS } from './paths';

// 音声機能が使う Python 本体・パッケージ一式・モデルの定義。
// 使う版はアプリが決め、利用者による更新は許可しない。版を上げるときは version を変える
// (インストール済みの記録と食い違うと「更新が必要」として扱われ、起動時に利用者へ確認する)。

// 取得するファイル (保存先を持たないもの。Python 本体の書庫など、取得後に展開して消すもの)
export type DownloadAsset = {
    // 取得元 (この URL からだけ取得する)
    url: string;
    size?: number;
    sha256?: string;
};

// モデルディレクトリに置くファイル
export type SpecFile = DownloadAsset & {
    // モデルディレクトリからの相対パス (区切りは /)
    dest: string;
    // 取得後に同じディレクトリへ展開する zip
    extractZip?: boolean;
};

type LicenseInfo = { name: string; url?: string };
type SourceInfo = { name: string; url: string };

// ---------------------------------------------------------------------------
// Python 本体 (python-build-standalone)
// ---------------------------------------------------------------------------

const PBS_RELEASE = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261003';

export const PYTHON_SPEC = {
    version: '3.11.17+20261003',
    assets: {
        'win32-x64': {
            url: `${PBS_RELEASE}/cpython-3.11.17%2B20261003-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
            size: 25222085,
            sha256: '861f9a03b0c4ca537da1754ed0556e0628dd2114a1be36e8aae6b1e2bb1304a0',
        },
        'darwin-arm64': {
            url: `${PBS_RELEASE}/cpython-3.11.17%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz`,
            size: 26974674,
            sha256: '0c9fbd0b2ddfbb6877493a650259bf379ee71a91b17f0f5f06dd2dcd52fbcade',
        },
        'darwin-x64': {
            url: `${PBS_RELEASE}/cpython-3.11.17%2B20261003-x86_64-apple-darwin-install_only_stripped.tar.gz`,
            size: 26888478,
            sha256: 'ba62d0fb634c4e347341a4f3e29d7fb0b27920be6326c614d541c316e4da7693',
        },
        'linux-x64': {
            url: `${PBS_RELEASE}/cpython-3.11.17%2B20261003-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
            size: 30785899,
            sha256: 'aadcba18994cb8f9ee752aceb31d61e04f75b5d900d76fb575c6fbfabadec434',
        },
        'linux-arm64': {
            url: `${PBS_RELEASE}/cpython-3.11.17%2B20261003-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz`,
            size: 31111705,
            sha256: '41f16793d33161dcd9bfa2622332b8af870cfdb4540bd1fdc477f9e6b7c58c26',
        },
    } as Record<Exclude<VoicePlatformKey, 'unsupported'>, DownloadAsset>,
    license: { name: 'PSF-2.0 and others', url: 'https://github.com/astral-sh/python-build-standalone' } as LicenseInfo,
    source: { name: 'python-build-standalone', url: 'https://github.com/astral-sh/python-build-standalone' },
};

// Python 本体の実行ファイル。macOS は版番号の付いた実体 (bin/python3.11 など) を使う
// (書庫の bin/python3 はこの実体へのシンボリックリンクで、リンクは展開しないため)
export function pythonExecutable(): string {
    const base = libraryPaths().python;
    if (process.platform === 'win32') return path.join(base, 'python.exe');
    const [major, minor] = PYTHON_SPEC.version.split('.');
    return path.join(base, 'bin', `python${major}.${minor}`);
}

// ---------------------------------------------------------------------------
// パッケージ一式 (仮想環境ごと)
// ---------------------------------------------------------------------------

export type ComponentItemId = 'separator' | 'converter' | 'tts' | 'tts-train';

export type ComponentSpec = {
    id: ComponentItemId;
    // パッケージを入れる仮想環境
    env: VoiceComponentId;
    version: string;
    // src/python/requirements/ 内のファイル名 (拡張子なし)
    requirements: string;
    // ソース一式 (GitHub のタグのアーカイブ)。仮想環境と同じライブラリのディレクトリの source/ に展開する
    source?: { url: string; size: number };
    // パッケージ一式と一緒に取得する小さなファイル
    files: SpecFile[];
    requires: string[];
    usedBy: VoiceFeatureId[];
    nameKey: string;
    descriptionKey: string;
    license?: LicenseInfo;
    sourceInfo?: SourceInfo;
    credit?: string;
};

// PyTorch の CUDA 版の取得元
export const TORCH_INDEX: Record<CudaFlavor | 'cpu', string> = {
    cu126: 'https://download.pytorch.org/whl/cu126',
    cu128: 'https://download.pytorch.org/whl/cu128',
    cu130: 'https://download.pytorch.org/whl/cu130',
    // Linux の PyPI の PyTorch は CUDA のライブラリ一式を含むため、GPU を使えない Linux では CPU 版を使う
    cpu: 'https://download.pytorch.org/whl/cpu',
};

// CUDA 版 PyTorch 本体の大きさ (目安の根拠。配布物の実測値)
const TORCH_CUDA_BYTES: Record<CudaFlavor, number> = {
    cu126: 2_596_413_186,
    cu128: 2_753_148_611,
    cu130: 1_915_194_626,
};
const TORCH_CPU_BYTES = 125_000_000;

// PyTorch 以外のパッケージの大きさの目安
const PACKAGE_BYTES: Record<ComponentItemId, number> = {
    separator: 320_000_000,
    converter: 460_000_000,
    tts: 520_000_000,
    'tts-train': 380_000_000,
};

// PyTorch を使えない環境の分離・加工のパッケージ一式の大きさ (配布物の実測値。pedalboard・numpy・soundfile・cffi・pycparser)
const SEPARATOR_LITE_BYTES = 21_000_000;

const UVR_DATA = 'https://raw.githubusercontent.com/TRvlvr/application_data/main';

// 読み上げの学習で style_gen.py が使う話者埋め込みモデルの置き場所 (モデルディレクトリからの相対パス)
export const TTS_WESPEAKER_DIR = `${MODEL_GROUP_DIRS.tts}/wespeaker`;

export const COMPONENT_SPECS: ComponentSpec[] = [
    {
        id: 'separator',
        env: 'separator',
        version: 'separator-0.47.0-2',
        requirements: 'separator',
        files: [
            {
                url: `${UVR_DATA}/filelists/download_checks.json`,
                dest: `${MODEL_GROUP_DIRS.separator}/download_checks.json`,
            },
            {
                url: `${UVR_DATA}/vr_model_data/model_data_new.json`,
                dest: `${MODEL_GROUP_DIRS.separator}/vr_model_data.json`,
            },
            {
                url: `${UVR_DATA}/mdx_model_data/model_data_new.json`,
                dest: `${MODEL_GROUP_DIRS.separator}/mdx_model_data.json`,
            },
        ],
        requires: ['python'],
        usedBy: ['separation', 'conversion'],
        nameKey: 'voice.library.items.separatorPackages',
        descriptionKey: 'voice.library.items.separatorPackagesDesc',
        license: { name: 'MIT', url: 'https://github.com/nomadkaraoke/python-audio-separator/blob/main/LICENSE' },
        sourceInfo: { name: 'python-audio-separator', url: 'https://github.com/nomadkaraoke/python-audio-separator' },
        credit: 'Ultimate Vocal Remover (UVR) - Anjok07 and contributors',
    },
    {
        id: 'converter',
        env: 'converter',
        version: 'applio-3.6.5-1',
        requirements: 'converter',
        source: {
            url: 'https://github.com/IAHispano/Applio/archive/refs/tags/3.6.5.tar.gz',
            size: 19_040_424,
        },
        files: [],
        requires: ['python'],
        usedBy: ['conversion', 'conversionTraining'],
        nameKey: 'voice.library.items.converterPackages',
        descriptionKey: 'voice.library.items.converterPackagesDesc',
        license: { name: 'MIT', url: 'https://github.com/IAHispano/Applio/blob/main/LICENSE' },
        sourceInfo: { name: 'Applio', url: 'https://github.com/IAHispano/Applio' },
    },
    {
        id: 'tts',
        env: 'tts',
        version: 'sbv2mk-2.8.8-1',
        requirements: 'tts',
        files: [],
        requires: ['python'],
        usedBy: ['tts', 'ttsTraining'],
        nameKey: 'voice.library.items.ttsPackages',
        descriptionKey: 'voice.library.items.ttsPackagesDesc',
        license: {
            name: 'AGPL-3.0 (user dictionary: LGPL-3.0)',
            url: 'https://github.com/sync-dev-org/Style-Bert-VITS2',
        },
        sourceInfo: {
            name: 'Style-Bert-VITS2 (sync-dev-org)',
            url: 'https://github.com/sync-dev-org/Style-Bert-VITS2',
        },
    },
    {
        id: 'tts-train',
        env: 'tts',
        version: 'sbv2mk-train-2.8.8-1',
        requirements: 'tts-train',
        source: {
            url: 'https://github.com/sync-dev-org/Style-Bert-VITS2/archive/refs/tags/v2.8.8.tar.gz',
            size: 8_667_112,
        },
        files: [
            // style_gen.py がスタイルベクトルの計算に使う話者埋め込みモデル
            {
                url: 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM/resolve/837717ddb9ff5507820346191109dc79c958d614/pytorch_model.bin',
                dest: `${TTS_WESPEAKER_DIR}/pytorch_model.bin`,
                size: 26_645_418,
                sha256: '366edf44f4c80889a3eb7a9d7bdf02c4aede3127f7dd15e274dcdb826b143c56',
            },
            {
                url: 'https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM/resolve/837717ddb9ff5507820346191109dc79c958d614/config.yaml',
                dest: `${TTS_WESPEAKER_DIR}/config.yaml`,
            },
        ],
        requires: ['component:tts'],
        usedBy: ['ttsTraining'],
        nameKey: 'voice.library.items.ttsTrainPackages',
        descriptionKey: 'voice.library.items.ttsTrainPackagesDesc',
        license: {
            name: 'AGPL-3.0 (wespeaker model: CC BY 4.0)',
            url: 'https://github.com/sync-dev-org/Style-Bert-VITS2',
        },
        sourceInfo: {
            name: 'Style-Bert-VITS2 (sync-dev-org)',
            url: 'https://github.com/sync-dev-org/Style-Bert-VITS2',
        },
        credit: 'wespeaker-voxceleb-resnet34-LM (pyannote, WeSpeaker)',
    },
];

export function componentSpec(id: ComponentItemId): ComponentSpec {
    const spec = COMPONENT_SPECS.find(item => item.id === id);
    if (!spec) throw new Error(`unknown component ${id}`);
    return spec;
}

// PyTorch を使えない環境 (Intel 版 Mac・macOS 14 より前の macOS) の分離・加工のパッケージ一式。
// audio-separator は PyTorch を必須とするため入れず、PyTorch を使わない処理 (エフェクト・無音部分の処理) に要るものだけを入れる。
// 分離のモデルを使わないため、モデルの情報のファイルも取得しない
export const SEPARATOR_LITE_VERSION = 'separator-lite-1';
const SEPARATOR_LITE_SPEC: Partial<ComponentSpec> = {
    version: SEPARATOR_LITE_VERSION,
    requirements: 'separator-lite',
    files: [],
    descriptionKey: 'voice.library.items.separatorLitePackagesDesc',
    license: { name: 'GPL-3.0', url: 'https://github.com/spotify/pedalboard/blob/master/LICENSE' },
    sourceInfo: { name: 'pedalboard', url: 'https://github.com/spotify/pedalboard' },
    credit: undefined,
};

// その環境で使うパッケージ一式の定義 (PyTorch を使えない環境の分離・加工は、軽いパッケージ一式にする)
export function resolveComponentSpec(spec: ComponentSpec, platform: VoicePlatformInfo): ComponentSpec {
    if (spec.id === 'separator' && platform.torchUnavailableReason) return { ...spec, ...SEPARATOR_LITE_SPEC };
    return spec;
}

// CUDA 版の PyTorch の種類
const CUDA_FLAVORS: CudaFlavor[] = ['cu130', 'cu128', 'cu126'];

// CUDA 版の PyTorch を使う環境か (Windows と Linux)
function usesCudaTorch(platform: VoicePlatformInfo): boolean {
    return (
        platform.platform === 'win32-x64' || platform.platform === 'linux-x64' || platform.platform === 'linux-arm64'
    );
}

// パッケージ一式の大きさの目安
export function estimateComponentBytes(spec: ComponentSpec, platform: VoicePlatformInfo): number {
    const resolved = resolveComponentSpec(spec, platform);
    if (resolved.requirements === 'separator-lite') return SEPARATOR_LITE_BYTES;
    const torch =
        resolved.id === 'tts-train'
            ? 0
            : usesCudaTorch(platform) && platform.gpu.cudaFlavor
              ? TORCH_CUDA_BYTES[platform.gpu.cudaFlavor]
              : TORCH_CPU_BYTES;
    return torch + PACKAGE_BYTES[resolved.id] + (resolved.source?.size ?? 0);
}

// パッケージ一式の版。CUDA 版の種類が変わった場合 (GPU やドライバーの交換) も入れ直しが必要になるため含める
export function componentVariant(platform: VoicePlatformInfo): string {
    if (usesCudaTorch(platform)) return platform.gpu.cudaFlavor ?? 'cpu';
    return platform.platform;
}

// 導入したときの版 (installed) のパッケージ一式を、今の環境でそのまま使えるか。
// CUDA 版の PyTorch は NVIDIA GPU が無くても CPU で動くため、GPU を外した (検出されなくなった) 環境では入れ直さない。
// CPU 版から CUDA 版へ (GPU を足した場合) と、CUDA 版の種類が変わる場合 (GPU の世代に合わないことがある) は入れ直す
export function isVariantUsable(installed: string | undefined, platform: VoicePlatformInfo): boolean {
    const current = componentVariant(platform);
    if (installed === current) return true;
    return usesCudaTorch(platform) && current === 'cpu' && CUDA_FLAVORS.some(flavor => flavor === installed);
}

// ---------------------------------------------------------------------------
// モデル (1 モデル単位で取得・削除する)
// ---------------------------------------------------------------------------

export type ModelSpec = {
    id: string;
    group: Exclude<LibraryItemGroup, 'runtime'>;
    version: string;
    nameKey?: string;
    name?: string;
    descriptionKey?: string;
    files: SpecFile[];
    requires: string[];
    usedBy: VoiceFeatureId[];
    license?: LicenseInfo;
    source?: SourceInfo;
    credit?: string;
    // この環境で取得できるか (読み上げの学習用は NVIDIA GPU を使える Windows と Linux のみ)
    trainingOnly?: 'tts';
    // すぐに使えるモデル (読み上げ) が読める言語
    readsLanguages?: VoiceLanguage[];
};

const APPLIO_HF = 'https://huggingface.co/IAHispano/Applio/resolve/70ed563897504c756ec94067c12c902c4fd42025/Resources';
const APPLIO_LICENSE: LicenseInfo = { name: 'MIT', url: 'https://huggingface.co/IAHispano/Applio' };
const APPLIO_SOURCE: SourceInfo = {
    name: 'IAHispano/Applio (Hugging Face)',
    url: 'https://huggingface.co/IAHispano/Applio',
};

function applioFile(remote: string, dest: string, size: number, sha256?: string): SpecFile {
    return { url: `${APPLIO_HF}/${remote}`, dest: `${MODEL_GROUP_DIRS.converter}/${dest}`, size, sha256 };
}

function embedderSpec(
    id: string,
    dir: string,
    nameKey: string,
    descriptionKey: string,
    size: number,
    sha256: string,
    configSize: number
): ModelSpec {
    return {
        id: `model:converter:${id}`,
        group: 'converter',
        version: '1',
        nameKey,
        descriptionKey,
        files: [
            applioFile(`embedders/${dir}/pytorch_model.bin`, `embedders/${dir}/pytorch_model.bin`, size, sha256),
            applioFile(`embedders/${dir}/config.json`, `embedders/${dir}/config.json`, configSize),
        ],
        requires: [],
        usedBy: ['conversion'],
        license: APPLIO_LICENSE,
        source: APPLIO_SOURCE,
    };
}

const SBV2_RAW = 'https://raw.githubusercontent.com/sync-dev-org/Style-Bert-VITS2/v2.8.8';
const JVNV_HF = 'https://huggingface.co/litagin/style_bert_vits2_jvnv/resolve/205830ca1d49e666ddfbf2a755f0108e9cade4dd';
const JVNV_LICENSE: LicenseInfo = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const JVNV_SOURCE: SourceInfo = {
    name: 'litagin/style_bert_vits2_jvnv',
    url: 'https://huggingface.co/litagin/style_bert_vits2_jvnv',
};

type JvnvModel = {
    name: string;
    weights: string;
    size: number;
    sha256: string;
    styleSha256: string;
    jpExtra: boolean;
};

const JVNV_MODELS: JvnvModel[] = [
    {
        name: 'jvnv-F1-jp',
        weights: 'jvnv-F1-jp_e160_s14000.safetensors',
        size: 251150980,
        sha256: 'a90fa6c9444d9235c9ec4db99daf7c5c6a21cc26ca141b4c48455d66a3257d01',
        styleSha256: '1f959bb45ed0922efc31ff24e9147253814f42cb1d2d1e2bb10391a9df368489',
        jpExtra: true,
    },
    {
        name: 'jvnv-F2-jp',
        weights: 'jvnv-F2_e166_s20000.safetensors',
        size: 251150980,
        sha256: 'f6289a6f30bb9795744815b9da764a3c8198b18652d9fddef82fff1e14f0e784',
        styleSha256: '900f8cde3a336d12193fec7b7d8e6c5dc77b3a5d719a9be3f8598389cd88e643',
        jpExtra: true,
    },
    {
        name: 'jvnv-M1-jp',
        weights: 'jvnv-M1-jp_e158_s14000.safetensors',
        size: 251150980,
        sha256: '0d86765f1fe08dbba74cd06283e96b6941b3f232329fabbba9c30e6edc27887a',
        styleSha256: '7a925435e8c1c9efc8fc8e90e690655ab9a7bae00a790892e13e936510d04f05',
        jpExtra: true,
    },
    {
        name: 'jvnv-M2-jp',
        weights: 'jvnv-M2-jp_e159_s17000.safetensors',
        size: 251150980,
        sha256: '8245f39438076d36a3befd8aefb15c38830cef326c1f7c9d9c8e64b647645402',
        styleSha256: 'c965bb63fa4a759d41a8a4a3649333125d6497ae8a705d81b7d5c5bd2854797c',
        jpExtra: true,
    },
    {
        name: 'jvnv-F1',
        weights: 'jvnv-F1.safetensors',
        size: 198768188,
        sha256: '62c45494f0222888f9e8834ba3ccdc7cb53024e67b6f9903ceff4c011d44630c',
        styleSha256: '1f959bb45ed0922efc31ff24e9147253814f42cb1d2d1e2bb10391a9df368489',
        jpExtra: false,
    },
    {
        name: 'jvnv-F2',
        weights: 'jvnv-F2.safetensors',
        size: 198768188,
        sha256: '7408a75ec677d461a8e959d3f2fed5256deaa8691fd841672e0a368007f9b682',
        styleSha256: '900f8cde3a336d12193fec7b7d8e6c5dc77b3a5d719a9be3f8598389cd88e643',
        jpExtra: false,
    },
    {
        name: 'jvnv-M1',
        weights: 'jvnv-M1.safetensors',
        size: 198768188,
        sha256: '397cc7e0b8ea1e290a7049802c2894315381ad84657947779078f79a36e98729',
        styleSha256: '7a925435e8c1c9efc8fc8e90e690655ab9a7bae00a790892e13e936510d04f05',
        jpExtra: false,
    },
    {
        name: 'jvnv-M2',
        weights: 'jvnv-M2.safetensors',
        size: 198768188,
        sha256: '2fcc35ddfddc94234c5d3f30d3c5c865c66b0ba2ad12ed2a13afd2c4878119e2',
        styleSha256: 'c965bb63fa4a759d41a8a4a3649333125d6497ae8a705d81b7d5c5bd2854797c',
        jpExtra: false,
    },
];

// すぐに使えるモデル (JVNV) の項目 ID
export function readyItemId(name: string): string {
    return `${TTS_READY_PREFIX}${name}`;
}

export const TTS_READY_DIR = `${MODEL_GROUP_DIRS.tts}/ready`;

function jvnvSpec(model: JvnvModel): ModelSpec {
    const base = `${TTS_READY_DIR}/${model.name}`;
    return {
        id: readyItemId(model.name),
        group: 'tts',
        version: '1',
        name: `JVNV ${model.name}`,
        // 名前の F は女性、M は男性の話者
        descriptionKey: `voice.library.items.jvnv${model.name.startsWith('jvnv-F') ? 'Female' : 'Male'}${
            model.jpExtra ? 'JpExtra' : 'Multilingual'
        }Desc`,
        files: [
            { url: `${JVNV_HF}/${model.name}/config.json`, dest: `${base}/config.json` },
            {
                url: `${JVNV_HF}/${model.name}/style_vectors.npy`,
                dest: `${base}/style_vectors.npy`,
                size: 7296,
                sha256: model.styleSha256,
            },
            {
                url: `${JVNV_HF}/${model.name}/${model.weights}`,
                dest: `${base}/${model.weights}`,
                size: model.size,
                sha256: model.sha256,
            },
        ],
        // JP-Extra 版の声は日本語だけを読むため、日本語の言語モデルが無いと使えない。多言語版の声は、読み上げる言語の
        // 言語モデルがあれば使える (読み上げの実行時に確かめる)
        requires: model.jpExtra ? [TTS_LANGUAGE_MODEL_ITEMS.ja] : [],
        readsLanguages: model.jpExtra ? ['ja'] : languagesForModelType('multilingual'),
        usedBy: ['tts'],
        license: JVNV_LICENSE,
        source: JVNV_SOURCE,
        credit: 'JVNV corpus (Detai Xin, Junfeng Jiang, Shinnosuke Takamichi, Yuki Saito, Akiko Aizawa, Hiroshi Saruwatari)',
    };
}

export const JVNV_MODEL_NAMES = JVNV_MODELS.map(model => model.name);

// 変換に使える埋め込みモデルの名前 (補助プロセスの runtime.py の APPLIO_EMBEDDERS と同じもの) -> ダウンロード項目
export const RVC_EMBEDDER_ITEMS: Record<string, string> = {
    contentvec: 'model:converter:contentvec',
    spin: 'model:converter:embedder-spin',
    'spin-v2': 'model:converter:embedder-spin-v2',
    'japanese-hubert-base': 'model:converter:embedder-japanese-hubert-base',
    'chinese-hubert-base': 'model:converter:embedder-chinese-hubert-base',
    'korean-hubert-base': 'model:converter:embedder-korean-hubert-base',
};

export const TTS_BERT_DIRS = {
    ja: `${MODEL_GROUP_DIRS.tts}/bert/deberta-v2-large-japanese-char-wwm`,
    en: `${MODEL_GROUP_DIRS.tts}/bert/deberta-v3-large`,
    zh: `${MODEL_GROUP_DIRS.tts}/bert/chinese-roberta-wwm-ext-large`,
} as const;

export const TTS_NLTK_DIR = `${MODEL_GROUP_DIRS.tts}/nltk_data`;

function sbv2RawFile(repoPath: string, dest: string, size: number, sha256: string): SpecFile {
    return { url: `${SBV2_RAW}/${repoPath}`, dest, size, sha256 };
}

export const MODEL_SPECS: ModelSpec[] = [
    // --- 音声変換 (Applio が使う補助モデル) ---
    {
        id: 'model:converter:rmvpe',
        group: 'converter',
        version: '1',
        nameKey: 'voice.library.items.rmvpe',
        descriptionKey: 'voice.library.items.rmvpeDesc',
        files: [
            applioFile(
                'predictors/rmvpe.pt',
                'predictors/rmvpe.pt',
                181184272,
                '6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193'
            ),
        ],
        requires: [],
        usedBy: ['conversion', 'conversionTraining'],
        license: APPLIO_LICENSE,
        source: APPLIO_SOURCE,
    },
    {
        id: 'model:converter:contentvec',
        group: 'converter',
        version: '1',
        nameKey: 'voice.library.items.contentvec',
        descriptionKey: 'voice.library.items.contentvecDesc',
        files: [
            applioFile(
                'embedders/contentvec/pytorch_model.bin',
                'embedders/contentvec/pytorch_model.bin',
                378342945,
                'd8dd400e054ddf4e6be75dab5a2549db748cc99e756a097c496c099f65a4854e'
            ),
            applioFile('embedders/contentvec/config.json', 'embedders/contentvec/config.json', 1388),
        ],
        requires: [],
        usedBy: ['conversion', 'conversionTraining'],
        license: APPLIO_LICENSE,
        source: APPLIO_SOURCE,
    },
    {
        id: 'model:converter:fcpe',
        group: 'converter',
        version: '1',
        nameKey: 'voice.library.items.fcpe',
        descriptionKey: 'voice.library.items.fcpeDesc',
        files: [
            applioFile(
                'predictors/fcpe.pt',
                'predictors/fcpe.pt',
                43362881,
                '8544427eebbf2baef6213cc9a05057e46961617a8e5bd96975a0d42da6a09059'
            ),
        ],
        requires: [],
        usedBy: [],
        license: APPLIO_LICENSE,
        source: APPLIO_SOURCE,
    },
    {
        id: 'model:converter:pretrained-40k',
        group: 'converter',
        version: '1',
        nameKey: 'voice.library.items.rvcPretrained',
        descriptionKey: 'voice.library.items.rvcPretrainedDesc',
        files: [
            applioFile(
                'pretrained_v2/f0G40k.pth',
                'pretraineds/hifi-gan/f0G40k.pth',
                73106273,
                '3b2c44035e782c4b14ddc0bede9e2f4a724d025cd073f736d4f43708453adfcb'
            ),
            applioFile(
                'pretrained_v2/f0D40k.pth',
                'pretraineds/hifi-gan/f0D40k.pth',
                142875703,
                '6b6ab091e70801b28e3f41f335f2fc5f3f35c75b39ae2628d419644ec2b0fa09'
            ),
        ],
        requires: [],
        usedBy: ['conversionTraining'],
        license: APPLIO_LICENSE,
        source: APPLIO_SOURCE,
    },
    // 取り込んだモデルが contentvec 以外の埋め込みで作られている場合にだけ必要
    embedderSpec(
        'embedder-spin',
        'spin',
        'voice.library.items.embedderSpin',
        'voice.library.items.embedderSpinDesc',
        378356791,
        '057f12bfda54e2d486d86a52a3beb2a07c96a888bc6ac0c382c12ac18dbd500c',
        1459
    ),
    embedderSpec(
        'embedder-spin-v2',
        'spin-v2',
        'voice.library.items.embedderSpinV2',
        'voice.library.items.embedderSpinV2Desc',
        378356791,
        '9a9ac0be326057b17607a988be497793817f8274e987cf691a1b61192510f823',
        1492
    ),
    embedderSpec(
        'embedder-japanese-hubert-base',
        'japanese_hubert_base',
        'voice.library.items.embedderJapaneseHubert',
        'voice.library.items.embedderJapaneseHubertDesc',
        377554841,
        '6c023ccb71e4c2b5a324c94fc5ebe12403d3081c5f370df229892419996fd113',
        1375
    ),
    embedderSpec(
        'embedder-chinese-hubert-base',
        'chinese_hubert_base',
        'voice.library.items.embedderChineseHubert',
        'voice.library.items.embedderChineseHubertDesc',
        377552987,
        '2fefccd26c2794a583b80f6f7210c721873cb7ebae2c1cde3baf9b27855e24d8',
        1380
    ),
    embedderSpec(
        'embedder-korean-hubert-base',
        'korean_hubert_base',
        'voice.library.items.embedderKoreanHubert',
        'voice.library.items.embedderKoreanHubertDesc',
        377554841,
        '931f6232879f8eadf7dbd9e00e1fa4cac61ad269af89d509b2ed75009b1a02c5',
        1594
    ),

    // --- 読み上げ (言語ごとの言語モデル = BERT) ---
    {
        id: TTS_LANGUAGE_MODEL_ITEMS.ja,
        group: 'tts',
        version: '1',
        nameKey: 'voice.library.items.languageModelJa',
        descriptionKey: 'voice.library.items.languageModelJaDesc',
        files: [
            sbv2RawFile(
                'bert/deberta-v2-large-japanese-char-wwm/config.json',
                `${TTS_BERT_DIRS.ja}/config.json`,
                895,
                '8f387ab4c6b36e47c7071327c7a42099002781279b00a7e6a7fe88f3da237a3f'
            ),
            sbv2RawFile(
                'bert/deberta-v2-large-japanese-char-wwm/special_tokens_map.json',
                `${TTS_BERT_DIRS.ja}/special_tokens_map.json`,
                125,
                'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3'
            ),
            sbv2RawFile(
                'bert/deberta-v2-large-japanese-char-wwm/tokenizer.json',
                `${TTS_BERT_DIRS.ja}/tokenizer.json`,
                430981,
                '21a17e4d0032739e82dc60f155b4ae37e94519103e0d399657fdd249ec3e7905'
            ),
            sbv2RawFile(
                'bert/deberta-v2-large-japanese-char-wwm/tokenizer_config.json',
                `${TTS_BERT_DIRS.ja}/tokenizer_config.json`,
                520,
                '1cc5203f09ecac12bb7a98a05cb9c2e39a9e37a113a7d85d12542ef29190583b'
            ),
            sbv2RawFile(
                'bert/deberta-v2-large-japanese-char-wwm/vocab.txt',
                `${TTS_BERT_DIRS.ja}/vocab.txt`,
                88151,
                '902cbd7e218aaf23a72955533293ceac12fcc4e010ad98c0c14757b94ce7abb6'
            ),
            {
                url: 'https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm/resolve/547b0e8b044fba3f9b84d0ab9f990440bd130c8b/pytorch_model.bin',
                dest: `${TTS_BERT_DIRS.ja}/pytorch_model.bin`,
                size: 1318456639,
                sha256: 'bf0dab8ad87bd7c22e85ec71e04f2240804fda6d33196157d6b5923af6ea1201',
            },
        ],
        requires: [],
        usedBy: ['tts', 'ttsTraining'],
        license: { name: 'CC BY-SA 4.0', url: 'https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm' },
        source: {
            name: 'ku-nlp/deberta-v2-large-japanese-char-wwm',
            url: 'https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm',
        },
    },
    {
        id: TTS_LANGUAGE_MODEL_ITEMS.en,
        group: 'tts',
        version: '1',
        nameKey: 'voice.library.items.languageModelEn',
        descriptionKey: 'voice.library.items.languageModelEnDesc',
        files: [
            sbv2RawFile(
                'bert/deberta-v3-large/config.json',
                `${TTS_BERT_DIRS.en}/config.json`,
                580,
                'ddec8b81d079d218ce9e54fc0af5d1d5937d6d53b5d42e70c1f251a1cebc830d'
            ),
            sbv2RawFile(
                'bert/deberta-v3-large/generator_config.json',
                `${TTS_BERT_DIRS.en}/generator_config.json`,
                560,
                '36956d8ce96c4a9f3acbb43501394c78756f75f491bb7288cff065ad7636e223'
            ),
            sbv2RawFile(
                'bert/deberta-v3-large/tokenizer.json',
                `${TTS_BERT_DIRS.en}/tokenizer.json`,
                8655754,
                '5120fa65c0d75be41808a62a5aef7ae9a01e832c031385857851e7ff86ec13fa'
            ),
            sbv2RawFile(
                'bert/deberta-v3-large/tokenizer_config.json',
                `${TTS_BERT_DIRS.en}/tokenizer_config.json`,
                52,
                '3f3978e0c036f2c2588cac34a6047cbb0af0b0dc1814254e291028529805496d'
            ),
            {
                url: 'https://huggingface.co/microsoft/deberta-v3-large/resolve/64a8c8eab3e352a784c658aef62be1662607476f/spm.model',
                dest: `${TTS_BERT_DIRS.en}/spm.model`,
                size: 2464616,
                sha256: 'c679fbf93643d19aab7ee10c0b99e460bdbc02fedf34b92b05af343b4af586fd',
            },
            {
                url: 'https://huggingface.co/microsoft/deberta-v3-large/resolve/64a8c8eab3e352a784c658aef62be1662607476f/pytorch_model.bin',
                dest: `${TTS_BERT_DIRS.en}/pytorch_model.bin`,
                size: 873673253,
                sha256: 'dd5b5d93e2db101aaf281df0ea1216c07ad73620ff59c5b42dccac4bf2eef5b5',
            },
            // 英語の発音推定 (g2p_en) が使う NLTK のデータ
            {
                url: 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/taggers/averaged_perceptron_tagger.zip',
                dest: `${TTS_NLTK_DIR}/taggers/averaged_perceptron_tagger.zip`,
                extractZip: true,
            },
            {
                url: 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/cmudict.zip',
                dest: `${TTS_NLTK_DIR}/corpora/cmudict.zip`,
                extractZip: true,
            },
        ],
        requires: [],
        usedBy: ['tts', 'ttsTraining'],
        // NLTK のデータ: averaged_perceptron_tagger は MIT、CMUdict は用途を問わず利用可 (出典の表示を求めている)
        license: { name: 'MIT (CMUdict: free use)', url: 'https://huggingface.co/microsoft/deberta-v3-large' },
        source: { name: 'microsoft/deberta-v3-large', url: 'https://huggingface.co/microsoft/deberta-v3-large' },
        credit: 'The Carnegie Mellon Pronouncing Dictionary (Carnegie Mellon University)',
    },
    {
        id: TTS_LANGUAGE_MODEL_ITEMS.zh,
        group: 'tts',
        version: '1',
        nameKey: 'voice.library.items.languageModelZh',
        descriptionKey: 'voice.library.items.languageModelZhDesc',
        files: [
            sbv2RawFile(
                'bert/chinese-roberta-wwm-ext-large/added_tokens.json',
                `${TTS_BERT_DIRS.zh}/added_tokens.json`,
                3,
                'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356'
            ),
            sbv2RawFile(
                'bert/chinese-roberta-wwm-ext-large/config.json',
                `${TTS_BERT_DIRS.zh}/config.json`,
                690,
                '53d086daf0ccdddbeb78f8798f34c685a3c48089fa21ec61300527f083fa2563'
            ),
            sbv2RawFile(
                'bert/chinese-roberta-wwm-ext-large/special_tokens_map.json',
                `${TTS_BERT_DIRS.zh}/special_tokens_map.json`,
                113,
                '88bbdf754dd64c44fff9e61b2c7d4380ded1bdf5c6d386be827ee28d79596cb9'
            ),
            sbv2RawFile(
                'bert/chinese-roberta-wwm-ext-large/tokenizer.json',
                `${TTS_BERT_DIRS.zh}/tokenizer.json`,
                438228,
                'b9a5d82ccce844a850a31c00db93b95f65c66fc622ac3f625dd03154dd23d373'
            ),
            sbv2RawFile(
                'bert/chinese-roberta-wwm-ext-large/tokenizer_config.json',
                `${TTS_BERT_DIRS.zh}/tokenizer_config.json`,
                20,
                '2d42242ad531c9aecff5082dab50027f71cddc439e1869b276bc7cbabdd7596b'
            ),
            sbv2RawFile(
                'bert/chinese-roberta-wwm-ext-large/vocab.txt',
                `${TTS_BERT_DIRS.zh}/vocab.txt`,
                109540,
                '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c'
            ),
            {
                url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/a25cc9e05974bd9687e528edd516f2cfdb3f5db9/pytorch_model.bin',
                dest: `${TTS_BERT_DIRS.zh}/pytorch_model.bin`,
                size: 1306484351,
                sha256: '4ac62d49144d770c5ca9a5d1d3039c4995665a080febe63198189857c6bd11cd',
            },
        ],
        requires: [],
        usedBy: ['tts', 'ttsTraining'],
        license: { name: 'Apache-2.0', url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large' },
        source: {
            name: 'hfl/chinese-roberta-wwm-ext-large',
            url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large',
        },
    },
    // --- 読み上げのモデルの学習 (NVIDIA GPU を使える Windows と Linux のみ) ---
    {
        id: 'model:tts:train-jp-extra',
        group: 'tts',
        version: '1',
        nameKey: 'voice.library.items.ttsTrainJpExtra',
        descriptionKey: 'voice.library.items.ttsTrainJpExtraDesc',
        files: [
            ...(['G_0', 'D_0', 'WD_0'] as const).map(name => ({
                url: `https://huggingface.co/litagin/Style-Bert-VITS2-2.0-base-JP-Extra/resolve/a731761009f3c96d104487be6ad332bf1bb5a3a5/${name}.safetensors`,
                dest: `${MODEL_GROUP_DIRS.tts}/pretrained_jp_extra/${name}.safetensors`,
                size: { G_0: 292939468, D_0: 187000064, WD_0: 4695736 }[name],
                sha256: {
                    G_0: '90c26f3dc5f6678a695c5308fdf9441fb5be15cdcb87f27e811084f25e87c92d',
                    D_0: '2d8de5a29a00c4bbe682d27cd882b2837ac9a16cc9025d7be76b67954b743ef3',
                    WD_0: 'ba4a0fb0d611f05ad2656c8cfe8282d53f42c61aeeb5aafcd1daf5c05ece6523',
                }[name],
            })),
            // JP-Extra 版の学習で使う音声の判別器 (WavLM)
            {
                url: 'https://huggingface.co/microsoft/wavlm-base-plus/resolve/4c66d4806a428f2e922ccfa1a962776e232d487b/pytorch_model.bin',
                dest: `${MODEL_GROUP_DIRS.tts}/slm/wavlm-base-plus/pytorch_model.bin`,
                size: 377617425,
                sha256: '3bb273a6ace99408b50cfc81afdbb7ef2de02da2eab0234e18db608ce692fe51',
            },
            {
                url: 'https://huggingface.co/microsoft/wavlm-base-plus/resolve/4c66d4806a428f2e922ccfa1a962776e232d487b/config.json',
                dest: `${MODEL_GROUP_DIRS.tts}/slm/wavlm-base-plus/config.json`,
            },
            {
                url: 'https://huggingface.co/microsoft/wavlm-base-plus/resolve/4c66d4806a428f2e922ccfa1a962776e232d487b/preprocessor_config.json',
                dest: `${MODEL_GROUP_DIRS.tts}/slm/wavlm-base-plus/preprocessor_config.json`,
            },
        ],
        requires: [TTS_LANGUAGE_MODEL_ITEMS.ja],
        usedBy: ['ttsTraining'],
        license: {
            name: 'AGPL-3.0 (WavLM: CC BY-SA 3.0)',
            url: 'https://huggingface.co/litagin/Style-Bert-VITS2-2.0-base-JP-Extra',
        },
        source: {
            name: 'litagin/Style-Bert-VITS2-2.0-base-JP-Extra',
            url: 'https://huggingface.co/litagin/Style-Bert-VITS2-2.0-base-JP-Extra',
        },
        credit: 'WavLM Base+ (Microsoft)',
        trainingOnly: 'tts',
    },
    {
        id: 'model:tts:train-multilingual',
        group: 'tts',
        version: '1',
        nameKey: 'voice.library.items.ttsTrainMultilingual',
        descriptionKey: 'voice.library.items.ttsTrainMultilingualDesc',
        files: (['G_0', 'D_0', 'DUR_0'] as const).map(name => ({
            url: `https://huggingface.co/litagin/Style-Bert-VITS2-1.0-base/resolve/56b47b34cb2bbc9f750dfe64504bb6e3e213f1fb/${name}.safetensors`,
            dest: `${MODEL_GROUP_DIRS.tts}/pretrained/${name}.safetensors`,
            size: { G_0: 234266180, D_0: 187000064, DUR_0: 2422556 }[name],
            sha256: {
                G_0: 'ee9718a5f3ef1a4ce47fedaad8504e67bfd68b536493ee2d8642be42b450470c',
                D_0: 'cc27022d712fcc030db11ebb6d023c95310d2d909d32126de9abfa92d00e8dfc',
                DUR_0: '802e99864e072bead2630f5622733620d489175e14f34fe70a09405d7d55f08d',
            }[name],
        })),
        requires: [],
        usedBy: ['ttsTraining'],
        // モデルカードにライセンスの記載は無い。Bert-VITS2 2.1 の事前学習モデルを safetensors にしたもの
        license: { name: 'Bert-VITS2 (AGPL-3.0)', url: 'https://github.com/fishaudio/Bert-VITS2' },
        source: {
            name: 'litagin/Style-Bert-VITS2-1.0-base',
            url: 'https://huggingface.co/litagin/Style-Bert-VITS2-1.0-base',
        },
        credit: 'Bert-VITS2 2.1 base models (Fish Audio)',
        trainingOnly: 'tts',
    },
    ...JVNV_MODELS.map(jvnvSpec),
];

// 分離モデルの項目 ID
export function separatorItemId(filename: string): string {
    return `${SEPARATOR_MODEL_PREFIX}${filename}`;
}

// 分離モデルの項目 ID からモデルのファイル名を得る (分離モデルの項目でなければ null)
export function separatorFilename(itemId: string): string | null {
    return itemId.startsWith(SEPARATOR_MODEL_PREFIX) ? itemId.slice(SEPARATOR_MODEL_PREFIX.length) : null;
}

export const SEPARATOR_MODEL_DIR = MODEL_GROUP_DIRS.separator;
export const CONVERTER_MODEL_DIR = MODEL_GROUP_DIRS.converter;
