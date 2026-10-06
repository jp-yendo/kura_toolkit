import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { getSettings, resolveSearchThreads } from './settings';
import { emitJobEvent, finishJob, isCancelled, startJob } from './job-manager';
import { buildCleanupScanConfig } from './cleanup-targets';
import { walkCleanupTargets } from './dir-walker';
import { discardLater, toolTempEnv } from './work-dir';
import type {
    CleanupItem,
    CleanupRemoveResult,
    CleanupRoot,
    CleanupScanResult,
    CleanupTargetId,
} from '../../shared/types';

// 不要ファイルのクリーンアップ (元: CleanSweep/clean_sweep.py)。
// 対象の定義とディレクトリ 1 個ぶんの判定は cleanup-targets.ts にある
// (走査ワーカーからも読み込むため、electron に依存させられないので分けている)。
export { getAvailableCleanupTargets } from './cleanup-targets';

// Win32_LogicalDisk の DriveType 値
const DRIVE_TYPE_REMOVABLE = 2;
const DRIVE_TYPE_NETWORK = 4;
const DRIVE_TYPE_CDROM = 5;

type WinLogicalDisk = {
    DeviceID?: string;
    DriveType?: number;
    Size?: number | string | null;
};

// Windows のドライブ一覧を WMI (Win32_LogicalDisk) から取得する。
// DriveType により CD/DVD (5) を書き込みテストなしで判別できる。
// 取得するフィールドはすべて ASCII のため出力の文字コードに依存しない。
async function queryWindowsDrives(): Promise<WinLogicalDisk[] | null> {
    // 一時ファイルの置き場は作業ディレクトリに作り、終了したら消す
    const temp = toolTempEnv();
    try {
        const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
            const child = spawn(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,Size | ConvertTo-Json -Compress',
                ],
                { windowsHide: true, ...(temp ? { env: temp.env } : {}) }
            );
            let stdout = '';
            child.stdout.setEncoding('utf-8');
            child.stdout.on('data', (chunk: string) => {
                stdout += chunk;
            });
            child.on('error', reject);
            child.on('close', code => resolve({ code, stdout }));
        });
        if (result.code !== 0) return null;
        const parsed: unknown = JSON.parse(result.stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const disks = list.filter(
            (disk): disk is WinLogicalDisk =>
                typeof disk === 'object' &&
                disk !== null &&
                typeof (disk as WinLogicalDisk).DeviceID === 'string' &&
                /^[A-Za-z]:$/.test((disk as WinLogicalDisk).DeviceID as string)
        );
        return disks.length > 0 ? disks : null;
    } catch {
        return null;
    } finally {
        if (temp) discardLater(temp.dir);
    }
}

// フォールバック: ドライブレターの存在確認で列挙する (種別判定なし)
async function enumerateDrivesByLetter(): Promise<CleanupRoot[]> {
    const roots: CleanupRoot[] = [];
    for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
        const drive = `${String.fromCharCode(code)}:\\`;
        try {
            await fs.promises.stat(drive);
        } catch {
            continue;
        }
        let sizeGb: number | null = null;
        try {
            const stat = await fs.promises.statfs(drive);
            sizeGb = Math.round((stat.bsize * stat.blocks) / 1024 ** 3);
        } catch {
            sizeGb = null;
        }
        roots.push({ id: `drive:${drive}`, kind: 'drive', path: drive, sizeGb });
    }
    return roots;
}

// macOS / Linux でマウント済みのボリュームを列挙する。
// 書き込み権限の確認のみで CD/DVD や読み取り専用のディスクイメージを除外できるため、
// 実際の書き込みテストは行わない。
async function enumerateMountedVolumes(): Promise<CleanupRoot[]> {
    const containers =
        process.platform === 'darwin'
            ? ['/Volumes']
            : ['/media', `/media/${os.userInfo().username}`, `/run/media/${os.userInfo().username}`, '/mnt'];
    const roots: CleanupRoot[] = [];
    const seen = new Set<string>();
    for (const container of containers) {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(container, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const volumePath = path.join(container, entry.name);
            if (seen.has(volumePath)) continue;
            try {
                // シンボリックリンクの場合も実体がディレクトリかどうかで判断する
                const stat = await fs.promises.stat(volumePath);
                if (!stat.isDirectory()) continue;
                // 書き込みできないボリューム (光学メディア、読み取り専用イメージ等) は除外する
                await fs.promises.access(volumePath, fs.constants.W_OK);
            } catch {
                continue;
            }
            let sizeGb: number | null = null;
            try {
                const stat = await fs.promises.statfs(volumePath);
                sizeGb = Math.round((stat.bsize * stat.blocks) / 1024 ** 3);
            } catch {
                sizeGb = null;
            }
            seen.add(volumePath);
            roots.push({ id: `volume:${volumePath}`, kind: 'drive', path: volumePath, sizeGb });
        }
    }
    return roots;
}

// 検索対象のルート一覧を返す (ホーム + ドライブ/ボリューム + カスタムディレクトリ)
export async function getCleanupRoots(): Promise<CleanupRoot[]> {
    const roots: CleanupRoot[] = [{ id: 'home', kind: 'home', path: os.homedir() }];
    if (process.platform !== 'win32') {
        // macOS / Linux はマウント済みのボリュームを列挙する
        roots.push(...(await enumerateMountedVolumes()));
    } else {
        const disks = await queryWindowsDrives();
        if (disks) {
            for (const disk of disks) {
                // CD/DVD 等の光学ドライブは書き込みできないため除外する
                if (disk.DriveType === DRIVE_TYPE_CDROM) continue;
                const drivePath = `${disk.DeviceID}\\`;
                const sizeNum = Number(disk.Size);
                const sizeGb = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.round(sizeNum / 1024 ** 3) : null;
                if (disk.DriveType === DRIVE_TYPE_REMOVABLE && sizeGb === null) {
                    // メディアの入っていないカードリーダー等はサイズ不明で列挙される
                    // 実際にアクセスできないものは除外する
                    try {
                        await fs.promises.stat(drivePath);
                    } catch {
                        continue;
                    }
                }
                roots.push({
                    id: `drive:${drivePath}`,
                    kind: 'drive',
                    path: drivePath,
                    sizeGb,
                    removable: disk.DriveType === DRIVE_TYPE_REMOVABLE,
                    network: disk.DriveType === DRIVE_TYPE_NETWORK,
                });
            }
        } else {
            // WMI が使えない環境ではドライブレター走査にフォールバック
            roots.push(...(await enumerateDrivesByLetter()));
        }
    }
    for (const customDir of getSettings().cleanup.customDirs) {
        roots.push({ id: `custom:${customDir}`, kind: 'custom', path: customDir });
    }
    return roots;
}

// macOS のフルディスクアクセス権限の有無を判定する。
// TCC で保護されたディレクトリの読み取りを試すだけで、書き込みなどの副作用はない。
export function getFullDiskAccessStatus(): boolean {
    if (process.platform !== 'darwin') return true;
    const probes = [
        path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.TCC'),
        path.join(os.homedir(), 'Library', 'Safari'),
    ];
    for (const probe of probes) {
        try {
            fs.readdirSync(probe);
            return true;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EPERM' || code === 'EACCES') return false;
            // ディレクトリが存在しない場合は判定材料にならないため次を試す
        }
    }
    // 判定できない場合は誤った警告を出さないよう権限ありとして扱う
    return true;
}

export type CleanupScanOptions = {
    roots: string[];
    targets: CleanupTargetId[];
};

// 選択されたルートを再帰走査して対象を検出する。
// 走査はディレクトリ単位で並列化する (スレッド数はアプリ設定の「探索のスレッド数」)。
// 総ディレクトリ数は事前に分からないため進捗率は出さず、走査済み件数と各スレッドの現在位置を送る。
export async function scanCleanupTargets(jobId: string, options: CleanupScanOptions): Promise<CleanupScanResult> {
    startJob(jobId);
    try {
        const result = await walkCleanupTargets({
            roots: options.roots,
            config: buildCleanupScanConfig(options.targets),
            threads: resolveSearchThreads(),
            isCancelled: () => isCancelled(jobId),
            onProgress: (visitedDirs, foundCount, workers) => {
                emitJobEvent({ jobId, kind: 'scan', scan: { visitedDirs, foundCount, workers } });
            },
        });
        // キャンセル状態は finishJob でジョブ登録が消える前に確定させる
        const cancelled = result.cancelled || isCancelled(jobId);
        return { items: result.items, cancelled, errors: result.errors };
    } finally {
        finishJob(jobId);
    }
}

// 選択された項目を削除する (通常はゴミ箱へ、ADS は直接削除)
export async function removeCleanupItems(jobId: string, items: CleanupItem[]): Promise<CleanupRemoveResult> {
    startJob(jobId);
    let deleted = 0;
    const failed: { path: string; error: string }[] = [];
    try {
        for (let i = 0; i < items.length; i++) {
            if (isCancelled(jobId)) break;
            const item = items[i];
            emitJobEvent({
                jobId,
                kind: 'progress',
                current: i + 1,
                total: items.length,
                percent: (i / items.length) * 100,
                message: item.path,
            });
            try {
                if (item.kind === 'ads') {
                    // ADS はゴミ箱へ移動できないため直接削除する (本体ファイルは残る)
                    await fs.promises.unlink(item.path);
                } else {
                    await shell.trashItem(item.path);
                }
                deleted += 1;
            } catch (error) {
                failed.push({
                    path: item.path,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    } finally {
        finishJob(jobId);
    }
    return { deleted, failed };
}
