import fs from 'fs';
import os from 'os';
import path from 'path';
import { runTool } from '../ffmpeg/ffmpeg';
import { getCacheDir, getLibraryDir, getModelDir, getWorkDir, hasNonAscii } from '../storage';
import type { CudaFlavor, GpuInfo, VoicePlatformInfo, VoicePlatformKey } from '../../../shared/voice/types';

// 音声機能を動かす環境の判定 (OS・CPU・GPU・Visual C++ 再頒布可能パッケージ)。
// 対応は Windows (x64)・macOS (Apple Silicon・Intel)・Linux (x64・Arm64)。Arm 版の Windows は、使うライブラリの一部
// (PyTorch・pedalboard・faiss) に配布物が無いため対象外。
// Intel 版 Mac と macOS 14 より前の macOS では、アプリが固定している版の PyTorch・onnxruntime・faiss に配布物が無いため、
// PyTorch を使う処理 (分離のモデル・音声変換・読み上げ) は使えない (PyTorch の Intel 版 Mac 向けの配布は 2.2 まで。
// onnxruntime・faiss・PyTorch 2.14 の macOS 向けの配布物は macOS 14 以上が対象)。

function platformKey(): VoicePlatformKey {
    if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64';
    if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
    if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
    if (process.platform === 'darwin') {
        // x64 版のアプリを Rosetta で動かしている場合も、Python は arm64 版をそのまま起動できる
        const appleSilicon = process.arch === 'arm64' || os.cpus().some(cpu => cpu.model.includes('Apple'));
        return appleSilicon ? 'darwin-arm64' : 'darwin-x64';
    }
    return 'unsupported';
}

// macOS のバージョン (メジャー番号)。Darwin のカーネル番号から求める (Darwin 23 = macOS 14)
function macosMajorVersion(): number | null {
    if (process.platform !== 'darwin') return null;
    const darwin = Number(os.release().split('.')[0]);
    return Number.isFinite(darwin) ? darwin - 9 : null;
}

// PyTorch を使う処理に必要な最も古い macOS (固定している版の onnxruntime・faiss・PyTorch 2.14 の macOS 向け配布物の要件)
const MIN_MACOS_MAJOR_FOR_TORCH = 14;

let gpuCache: GpuInfo | null = null;

// GPU の世代とドライバーから、使える PyTorch の CUDA 版を決める。
// - CUDA 13.0 版: ドライバー 580 以上かつ Turing (7.5) 以降
// - CUDA 12.8 版: ドライバー 570 以上かつ Volta (7.0) 以降 (Blackwell を含む)
// - CUDA 12.6 版: Blackwell より前の世代 (古い GPU とドライバーにも対応。ドライバーは Windows で 528、Linux で 525 以上)
function selectCudaFlavor(computeCapability: number, driverMajor: number): CudaFlavor | null {
    if (driverMajor >= 580 && computeCapability >= 7.5) return 'cu130';
    if (driverMajor >= 570 && computeCapability >= 7.0) return 'cu128';
    const cu126Driver = process.platform === 'linux' ? 525 : 528;
    if (computeCapability < 10 && driverMajor >= cu126Driver) return 'cu126';
    return null;
}

// NVIDIA のドライバーに含まれる nvidia-smi を、名前で (PATH から探して) 実行して GPU を調べる
async function detectNvidiaGpu(): Promise<GpuInfo> {
    try {
        const result = await runTool('nvidia-smi', [
            '--query-gpu=name,driver_version,compute_cap,memory.total',
            '--format=csv,noheader,nounits',
        ]);
        if (result.code !== 0) return { kind: 'none' };
        const line = result.stdout.split(/\r?\n/).find(item => item.trim().length > 0);
        if (!line) return { kind: 'none' };
        const [name, driver, cc, memory] = line.split(',').map(item => item.trim());
        const computeCapability = Number(cc);
        const driverMajor = Number(driver.split('.')[0]);
        if (!Number.isFinite(computeCapability) || !Number.isFinite(driverMajor)) return { kind: 'none' };
        const flavor = selectCudaFlavor(computeCapability, driverMajor);
        return {
            kind: 'cuda',
            name,
            memoryMb: Number(memory) || undefined,
            cudaFlavor: flavor,
            driverUpdateRequired: flavor === null,
        };
    } catch {
        // nvidia-smi が無い (NVIDIA のドライバーが入っていない) 場合など、実行できなければ NVIDIA の GPU は使えない
        return { kind: 'none' };
    }
}

async function detectGpu(refresh = false): Promise<GpuInfo> {
    if (gpuCache && !refresh) return gpuCache;
    const key = platformKey();
    if (key === 'darwin-arm64') {
        gpuCache = { kind: 'mps', name: 'Apple Silicon' };
    } else if (key === 'win32-x64' || key === 'linux-x64' || key === 'linux-arm64') {
        gpuCache = await detectNvidiaGpu();
    } else {
        gpuCache = { kind: 'none' };
    }
    return gpuCache;
}

// PyTorch は Microsoft Visual C++ 再頒布可能パッケージ (C++ ランタイム) を必要とする。
// Python 本体には C ランタイムが同梱されているが、C++ ランタイム (msvcp140.dll) は含まれない
function isVcRuntimeMissing(): boolean {
    if (process.platform !== 'win32') return false;
    // Windows のフォルダの場所は環境変数 SystemRoot で得る (Windows が常に設定する)
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw new Error('SystemRoot is not set');
    const system32 = path.join(systemRoot, 'System32');
    return !['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].every(name =>
        fs.existsSync(path.join(system32, name))
    );
}

export async function getPlatformInfo(refreshGpu = false): Promise<VoicePlatformInfo> {
    const key = platformKey();
    const gpu = await detectGpu(refreshGpu);
    let unsupportedReason: VoicePlatformInfo['unsupportedReason'];
    if (key === 'unsupported') {
        unsupportedReason = ['win32', 'darwin', 'linux'].includes(process.platform) ? 'arch' : 'os';
    }
    let torchUnavailableReason: VoicePlatformInfo['torchUnavailableReason'];
    if (key === 'darwin-x64') {
        torchUnavailableReason = 'intelMac';
    } else if (key === 'darwin-arm64' && (macosMajorVersion() ?? 0) < MIN_MACOS_MAJOR_FOR_TORCH) {
        torchUnavailableReason = 'macosVersion';
    }
    const libraryDir = getLibraryDir();
    const modelDir = getModelDir();
    return {
        platform: key,
        supported: unsupportedReason === undefined,
        unsupportedReason,
        torchUnavailableReason,
        // PyTorch を使えない環境では GPU を使う処理が無い (Apple Silicon でも macOS 14 より前は CPU だけで処理する)
        gpu: torchUnavailableReason ? { kind: 'none' } : gpu,
        vcRuntimeMissing: isVcRuntimeMissing(),
        // 読み上げのモデルの学習。Windows は NVIDIA GPU を使える場合だけ行う。macOS・Linux は PyTorch を使えれば行う
        // (上流の学習処理は CUDA を使えなければ CPU で学習する。MPS は使わない)
        ttsTrainingAvailable:
            key === 'win32-x64'
                ? gpu.kind === 'cuda' && !!gpu.cudaFlavor
                : (key === 'darwin-arm64' || key === 'linux-x64' || key === 'linux-arm64') && !torchUnavailableReason,
        libraryDir,
        modelDir,
        storageNonAscii:
            process.platform === 'win32' &&
            [libraryDir, modelDir, getCacheDir(), getWorkDir()].some(dir => hasNonAscii(dir)),
    };
}

// 論理 CPU 数 (前処理の並列数に使う)
export function cpuCount(): number {
    return os.availableParallelism();
}
