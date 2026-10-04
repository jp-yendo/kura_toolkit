import fs from 'fs';
import path from 'path';
import { extractTarGz, extractZip } from './archive';
import { downloadFile, isAbortError } from './downloader';
import { updateManifest } from './manifest';
import { bundledResourceDir, envPythonExecutable, libraryPaths, modelPaths, pythonExecutable } from './paths';
import { buildPythonEnv } from './python-env';
import { runProcess, WINDOWS_DLL_NOT_FOUND } from './process-runner';
import {
    componentVariant,
    PYTHON_SPEC,
    TORCH_INDEX,
    type ComponentSpec,
    type DownloadAsset,
    type SpecFile,
} from './spec';
import { newJobTempDir, removeTemp } from '../work-dir';
import type { VoiceComponentId, VoicePlatformInfo } from '../../../shared/voice/types';

// Python 本体・パッケージ一式・モデルの取得と展開。
// 進捗は「受け取ったバイト数 / 全体のバイト数 (分かる場合)」と、処理中の内容 (ファイル名など) で通知する。

export type InstallProgress = {
    received: number;
    total: number | null;
    detail?: string;
    installing?: boolean;
};

export type InstallContext = {
    jobId: string;
    signal: AbortSignal;
    onProgress(progress: InstallProgress): void;
};

// 1 ファイルを取得元の URL から dest (絶対パス) に取得し、取得したファイルの大きさを返す。
// 取得に失敗したらそのまま失敗とする (別の URL からは取得しない)
async function fetchAsset(
    asset: DownloadAsset,
    dest: string,
    context: InstallContext,
    base: number,
    total: number | null
): Promise<number> {
    try {
        await downloadFile(asset.url, dest, {
            signal: context.signal,
            sha256: asset.sha256,
            onProgress: progress =>
                context.onProgress({
                    received: base + progress.received,
                    total,
                    detail: path.basename(dest),
                }),
        });
    } catch (error) {
        if (isAbortError(error) || context.signal.aborted) throw new Error('KURA_CANCELLED');
        throw error;
    }
    return fs.statSync(dest).size;
}

// モデルディレクトリに置くファイルを 1 つ取得する
async function fetchSpecFile(
    file: SpecFile,
    context: InstallContext,
    base: number,
    total: number | null
): Promise<number> {
    const dest = modelPaths().file(file.dest);
    const size = await fetchAsset(file, dest, context, base, total);
    if (file.extractZip) {
        await extractZip(dest, path.dirname(dest));
    }
    return size;
}

// ファイルが取得済みか (大きさが分かるものは大きさも確かめる)
export function isSpecFilePresent(file: SpecFile): boolean {
    try {
        const stat = fs.statSync(modelPaths().file(file.dest));
        return stat.isFile() && (file.size === undefined || stat.size === file.size);
    } catch {
        return false;
    }
}

// 複数のファイルを順に取得する。取得済みのものは飛ばす
export async function fetchFiles(files: SpecFile[], context: InstallContext, totalBytes: number | null): Promise<void> {
    let received = 0;
    for (const file of files) {
        if (context.signal.aborted) throw new Error('KURA_CANCELLED');
        if (isSpecFilePresent(file)) {
            received += file.size ?? 0;
            continue;
        }
        received += await fetchSpecFile(file, context, received, totalBytes);
    }
}

// --- Python 本体 ---

async function checkPython(executable: string): Promise<void> {
    const result = await runProcess(executable, ['-c', 'import sys, ssl, sqlite3; print(sys.version)'], {
        env: buildPythonEnv(null),
    });
    if (result.code === WINDOWS_DLL_NOT_FOUND) throw new Error('VC_RUNTIME_MISSING');
    if (result.code !== 0) throw new Error(`PYTHON_BROKEN: ${result.tail.join('\n')}`);
}

export async function installPython(platform: VoicePlatformInfo, context: InstallContext): Promise<void> {
    if (platform.platform === 'unsupported') throw new Error('PLATFORM_UNSUPPORTED');
    const asset = PYTHON_SPEC.assets[platform.platform];
    const lib = libraryPaths();
    // 書庫は展開先と同じディスク (ライブラリディレクトリ) に取得し、展開したら消す。
    // 失敗・キャンセルの場合も書庫と展開途中のものを消す (取得途中の .part は続きの取得に使うため残る)
    const archive = lib.pythonArchive;
    const staging = `${lib.python}.staging`;
    try {
        await fetchAsset(asset, archive, context, 0, asset.size ?? null);
        context.onProgress({ received: asset.size ?? 0, total: asset.size ?? null, installing: true });
        await fs.promises.rm(staging, { recursive: true, force: true });
        // 書庫の先頭は python/ ディレクトリ
        await extractTarGz(archive, staging, 1);
        await fs.promises.rm(lib.python, { recursive: true, force: true });
        fs.renameSync(staging, lib.python);
    } finally {
        await fs.promises.rm(archive, { force: true });
        await fs.promises.rm(staging, { recursive: true, force: true });
    }
    await checkPython(pythonExecutable());
    updateManifest(manifest => {
        manifest.python = { version: PYTHON_SPEC.version, installedAt: Date.now() };
    });
}

// --- パッケージ一式 ---

// requirements ファイル (*.in) を読む。コメントと -r の取り込みを処理する
function readRequirementLines(name: string): string[] {
    const file = path.join(bundledResourceDir('python'), 'requirements', `${name}.in`);
    const lines: string[] = [];
    for (const raw of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
        const line = raw.split('#')[0].trim();
        if (!line) continue;
        const include = /^-r\s+(\S+)\.in$/.exec(line);
        if (include) {
            lines.push(...readRequirementLines(include[1]));
            continue;
        }
        lines.push(line);
    }
    return lines;
}

// PyTorch を環境に合った版 (CUDA 版など) にする。CUDA 版は版番号に +cuXXX が付く
function resolveRequirements(
    spec: ComponentSpec,
    platform: VoicePlatformInfo
): { lines: string[]; indexUrls: string[] } {
    const flavor = platform.platform === 'win32-x64' ? platform.gpu.cudaFlavor : null;
    const lines = readRequirementLines(spec.requirements).map(line => {
        const match = /^(torch|torchaudio)==([0-9.]+)(\s*;\s*sys_platform\s*==\s*"(\w+)")?$/.exec(line);
        if (!match || !flavor) return line;
        if (match[4] && match[4] !== 'win32') return line;
        return `${match[1]}==${match[2]}+${flavor}`;
    });
    return { lines, indexUrls: flavor ? [TORCH_INDEX[flavor]] : [] };
}

// pip の「Downloading xxx.whl (2.6 GB)」の大きさをバイト数にする
function parseSize(text: string): number {
    const match = /([\d.]+)\s*(kB|MB|GB|bytes)/.exec(text);
    if (!match) return 0;
    const value = Number(match[1]);
    const unit = { bytes: 1, kB: 1e3, MB: 1e6, GB: 1e9 }[match[2] as 'bytes' | 'kB' | 'MB' | 'GB'];
    return value * unit;
}

// 仮想環境を用意する。Python 本体へのリンクは作らずにファイルを写して作る (--copies。どの OS でも
// シンボリックリンクを持ち込まず、保存場所の移動ではファイルをそのまま写せるようにするため)
async function ensureVenv(env: VoiceComponentId): Promise<void> {
    const lib = libraryPaths();
    const python = envPythonExecutable(env);
    if (fs.existsSync(python)) {
        try {
            await checkPython(python);
            return;
        } catch {
            // 壊れている場合は作り直す
        }
    }
    await fs.promises.rm(lib.env(env), { recursive: true, force: true });
    fs.mkdirSync(lib.library(env), { recursive: true });
    const result = await runProcess(pythonExecutable(), ['-m', 'venv', '--without-pip', '--copies', lib.env(env)], {
        env: buildPythonEnv(null),
    });
    if (result.code !== 0) throw new Error(`VENV_FAILED: ${result.tail.join('\n')}`);
    if (process.platform === 'darwin') await copyLibpython(lib.env(env));
}

// macOS の Python 本体の実行ファイルは、隣の lib/ にある libpython を相対パス (@executable_path/../lib) で読む。
// 写した実行ファイルが起動できるよう、仮想環境の lib/ にも libpython を置く
async function copyLibpython(venv: string): Promise<void> {
    const source = path.join(libraryPaths().python, 'lib');
    const names = (await fs.promises.readdir(source)).filter(name => /^libpython3.*\.dylib$/.test(name));
    if (names.length === 0) throw new Error(`VENV_FAILED: libpython not found in ${source}`);
    for (const name of names) await fs.promises.copyFile(path.join(source, name), path.join(venv, 'lib', name));
}

// 仮想環境へのパッケージの導入。pip は Python 本体のもの (新しい版が同梱されている) を --python で
// 仮想環境に向けて使う。進捗は --progress-bar raw の機械可読な出力から読む
async function pipInstall(spec: ComponentSpec, platform: VoicePlatformInfo, estimate: number, context: InstallContext) {
    const { lines, indexUrls } = resolveRequirements(spec, platform);
    // pip に渡す要件ファイルは作業ディレクトリに書き、導入が終わったら (成否・キャンセルを問わず) 消す
    const workDir = newJobTempDir(`pip-${spec.id}`);
    try {
        await runPip(spec, lines, indexUrls, workDir, estimate, context);
    } finally {
        await removeTemp(workDir);
    }
}

async function runPip(
    spec: ComponentSpec,
    lines: string[],
    indexUrls: string[],
    workDir: string,
    estimate: number,
    context: InstallContext
): Promise<void> {
    const requirementsFile = path.join(workDir, 'requirements.txt');
    // pip は要件ファイルを OS の既定の文字コードで読むため、ASCII だけで書く
    fs.writeFileSync(requirementsFile, `${lines.join('\n')}\n`, 'ascii');
    const constraintsFile = path.join(bundledResourceDir('python'), 'requirements', `${spec.requirements}.lock.txt`);
    const args = [
        '-m',
        'pip',
        '--python',
        path.resolve(envPythonExecutable(spec.env)),
        'install',
        '--progress-bar',
        'raw',
        '--no-input',
        '--disable-pip-version-check',
        '--prefer-binary',
        '-r',
        requirementsFile,
        '-c',
        constraintsFile,
    ];
    for (const url of indexUrls) args.push('--extra-index-url', url);

    let completed = 0;
    let current = 0;
    let currentName = '';
    const result = await runProcess(pythonExecutable(), args, {
        jobId: context.jobId,
        env: buildPythonEnv(null, {
            // キャッシュは展開先 (仮想環境) と同じディスクのライブラリディレクトリに置く。同じ PyTorch を使う
            // パッケージ一式を続けて導入するときと、途中で失敗・中断して再試行するときに取得し直さないため、
            // ダウンロードの処理が全て成功してから消す
            PIP_CACHE_DIR: libraryPaths().pipCache,
            PIP_DISABLE_PIP_VERSION_CHECK: '1',
        }),
        onLine: line => {
            const downloading = /^\s*Downloading (\S+)(?: \((.+)\))?/.exec(line);
            if (downloading && !downloading[1].endsWith('.metadata')) {
                completed += current;
                current = 0;
                currentName = downloading[1];
                context.onProgress({ received: completed, total: estimate, detail: currentName });
                if (downloading[2] && !line.includes('Progress')) {
                    // 大きさだけ分かっていて進捗が出ない小さなファイルは、そのまま完了分に加える
                    current = parseSize(downloading[2]);
                }
                return;
            }
            const progress = /^Progress (\d+) of (\d+)$/.exec(line.trim());
            if (progress) {
                current = Number(progress[1]);
                context.onProgress({ received: completed + current, total: estimate, detail: currentName });
                return;
            }
            if (/^Installing collected packages/.test(line) || /^Building wheel/.test(line.trim())) {
                context.onProgress({ received: completed + current, total: estimate, installing: true, detail: '' });
            }
        },
    });
    if (result.code === WINDOWS_DLL_NOT_FOUND) throw new Error('VC_RUNTIME_MISSING');
    if (result.code !== 0) {
        const text = result.tail.join('\n');
        if (/error: Microsoft Visual C\+\+|xcrun: error|command 'clang' failed|unable to execute 'gcc'/i.test(text)) {
            throw new Error(`BUILD_TOOLS_MISSING: ${text}`);
        }
        throw new Error(`PIP_FAILED: ${text}`);
    }
}

// ソース一式を持つライブラリ (Applio は変換、Style-Bert-VITS2 の学習用のリポジトリは読み上げのライブラリ)
export function sourceOwner(spec: ComponentSpec): 'converter' | 'tts' {
    if (spec.env === 'separator') throw new Error(`no source for ${spec.id}`);
    return spec.env;
}

// GitHub のタグのソース一式を、仮想環境と同じライブラリのディレクトリの source/ に展開する
async function installSource(spec: ComponentSpec, context: InstallContext): Promise<void> {
    if (!spec.source) return;
    const owner = sourceOwner(spec);
    // 書庫は展開先と同じディスク (そのライブラリのディレクトリ) に取得し、展開したら消す。
    // 失敗・キャンセルの場合も書庫と展開途中のものを消す (取得途中の .part は続きの取得に使うため残る)
    const archive = libraryPaths().sourceArchive(owner);
    const target = libraryPaths().source(owner);
    const staging = `${target}.staging`;
    try {
        await fetchAsset({ url: spec.source.url }, archive, context, 0, spec.source.size);
        await fs.promises.rm(staging, { recursive: true, force: true });
        await extractTarGz(archive, staging, 1);
        await fs.promises.rm(target, { recursive: true, force: true });
        fs.renameSync(staging, target);
    } finally {
        await fs.promises.rm(archive, { force: true });
        await fs.promises.rm(staging, { recursive: true, force: true });
    }
}

// Applio の初期設定 (core.py が無い状態でも学習時に設定ファイルが必要)。
// 雛形 (assets/config_template.json) が無ければ失敗させる
function setupApplio(): void {
    const root = libraryPaths().source('converter');
    const template = path.join(root, 'assets', 'config_template.json');
    const config = path.join(root, 'assets', 'config.json');
    const data = JSON.parse(fs.readFileSync(template, 'utf-8')) as Record<string, unknown>;
    data.discord_presence = false;
    data.precision = 'fp16';
    fs.writeFileSync(config, JSON.stringify(data, null, 2), 'utf-8');
}

// 導入できたかを、主要なモジュールの読み込みで確かめる
const VERIFY_IMPORTS: Record<ComponentSpec['id'], string> = {
    separator: 'import torch, onnxruntime, audio_separator.separator',
    converter: 'import torch, torchaudio, faiss, librosa, pedalboard, soundfile, transformers',
    tts: 'import torch, style_bert_vits2.tts_model, pyopenjtalk',
    'tts-train': 'import torch, torchaudio, librosa, pyloudnorm, pyannote.audio',
};

async function verifyComponent(spec: ComponentSpec): Promise<void> {
    const result = await runProcess(envPythonExecutable(spec.env), ['-c', VERIFY_IMPORTS[spec.id]], {
        env: buildPythonEnv(spec.env),
        cwd: spec.env === 'converter' ? libraryPaths().source('converter') : undefined,
    });
    if (result.code === WINDOWS_DLL_NOT_FOUND) throw new Error('VC_RUNTIME_MISSING');
    if (result.code !== 0) throw new Error(`VERIFY_FAILED: ${result.tail.join('\n')}`);
}

export async function installComponent(
    spec: ComponentSpec,
    platform: VoicePlatformInfo,
    estimate: number,
    context: InstallContext
): Promise<void> {
    if (!fs.existsSync(pythonExecutable())) throw new Error('PYTHON_MISSING');
    await ensureVenv(spec.env);
    await installSource(spec, context);
    await pipInstall(spec, platform, estimate, context);
    if (spec.files.length > 0) await fetchFiles(spec.files, context, null);
    context.onProgress({ received: estimate, total: estimate, installing: true });
    if (spec.id === 'converter') setupApplio();
    await verifyComponent(spec);
    updateManifest(manifest => {
        manifest.components[spec.id] = {
            version: spec.version,
            variant: componentVariant(platform),
            installedAt: Date.now(),
        };
    });
}
