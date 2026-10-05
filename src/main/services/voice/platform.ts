import fs from 'fs';
import os from 'os';
import path from 'path';
import { runTool } from '../ffmpeg/ffmpeg';
import { getLibraryDir, getModelDir, getWorkDir, hasNonAscii } from '../storage';
import type { CudaFlavor, GpuInfo, VoicePlatformInfo, VoicePlatformKey } from '../../../shared/voice/types';

// 音声機能を動かす環境の判定 (OS・CPU・GPU・Visual C++ 再頒布可能パッケージ)。
// 対応は Windows (x64)・Apple Silicon の macOS・Linux (x64)。PyTorch が Intel 版 macOS 向けの配布をやめているため、
// Intel 版 macOS では動かせない。Arm 版の Windows と Linux は、使うライブラリの一部に配布物が無いため対象外。

function platformKey(): VoicePlatformKey {
    if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64';
    if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
    if (process.platform === 'darwin') {
        // x64 版のアプリを Rosetta で動かしている場合も、Python は arm64 版をそのまま起動できる
        const appleSilicon = process.arch === 'arm64' || os.cpus().some(cpu => cpu.model.includes('Apple'));
        if (appleSilicon) return 'darwin-arm64';
    }
    return 'unsupported';
}

// macOS のバージョン (メジャー番号)。Darwin のカーネル番号から求める (Darwin 23 = macOS 14)
function macosMajorVersion(): number | null {
    if (process.platform !== 'darwin') return null;
    const darwin = Number(os.release().split('.')[0]);
    return Number.isFinite(darwin) ? darwin - 9 : null;
}

// 対応する最も古い macOS (PyTorch の macOS 向け配布物の要件)
const MIN_MACOS_MAJOR = 14;

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
    } else if (key === 'win32-x64' || key === 'linux-x64') {
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
    } else if (key === 'darwin-arm64' && (macosMajorVersion() ?? 0) < MIN_MACOS_MAJOR) {
        unsupportedReason = 'macosVersion';
    }
    const libraryDir = getLibraryDir();
    const modelDir = getModelDir();
    return {
        platform: key,
        supported: unsupportedReason === undefined,
        unsupportedReason,
        gpu,
        vcRuntimeMissing: isVcRuntimeMissing(),
        // 読み上げのモデルの学習は、上流が NVIDIA GPU を前提としているため、NVIDIA GPU を使える Windows と Linux でのみ行う
        ttsTrainingAvailable: (key === 'win32-x64' || key === 'linux-x64') && gpu.kind === 'cuda' && !!gpu.cudaFlavor,
        libraryDir,
        modelDir,
        storageNonAscii:
            process.platform === 'win32' && [libraryDir, modelDir, getWorkDir()].some(dir => hasNonAscii(dir)),
    };
}

// 論理 CPU 数 (前処理の並列数に使う)
export function cpuCount(): number {
    return os.availableParallelism();
}
