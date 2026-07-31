import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { getSettings } from './settings';
import { emitJobEvent, finishJob, isCancelled, startJob } from './job-manager';
import type {
    CleanupItem,
    CleanupRemoveResult,
    CleanupRoot,
    CleanupScanResult,
    CleanupTargetId,
} from '../../shared/types';

// 不要ファイルのクリーンアップ (元: CleanSweep/clean_sweep.py)

type TargetKind = 'ads' | 'file' | 'prefix' | 'dir';

type TargetDef = {
    id: CleanupTargetId;
    kind: TargetKind;
    pattern: string;
};

// クリーンアップ対象の定義 (検出パターンは元実装と同一)
const TARGETS: TargetDef[] = [
    { id: 'zoneIdentifier', kind: 'ads', pattern: 'Zone.Identifier' },
    { id: 'thumbsDb', kind: 'file', pattern: 'Thumbs.db' },
    { id: 'dsStore', kind: 'file', pattern: '.DS_Store' },
    { id: 'dotUnderscore', kind: 'prefix', pattern: '._' },
    { id: 'appleDouble', kind: 'dir', pattern: '.AppleDouble' },
    { id: 'fseventsd', kind: 'dir', pattern: '.fseventsd' },
    { id: 'spotlight', kind: 'dir', pattern: '.Spotlight-V100' },
    { id: 'appleDb', kind: 'dir', pattern: '.AppleDB' },
    { id: 'appleDesktop', kind: 'dir', pattern: '.AppleDesktop' },
    { id: 'temporaryItems', kind: 'dir', pattern: '.TemporaryItems' },
    { id: 'networkTrash', kind: 'dir', pattern: 'Network Trash Folder' },
];

// システムディレクトリの除外パターン (ディレクトリ名で判定、大文字小文字無視)
const EXCLUDED_DIR_NAMES: Record<string, string[]> = {
    win32: [
        'Program Files',
        'Program Files (x86)',
        'Windows',
        'AppData',
        'ProgramData',
        'Recovery',
        '$Recycle.Bin',
        'System Volume Information',
    ],
    // macOS: ~/Library は巨大で走査が長時間化するため除外する。
    // システム領域と既にゴミ箱へ入れたものも対象外とする。
    darwin: [
        'Library',
        'Applications',
        'System',
        'private',
        '.Trash',
        '.DocumentRevisions-V100',
        '.MobileBackups',
        '.PKInstallSandboxManager',
        '.PKInstallSandboxManager-SystemSoftware',
    ],
    linux: ['proc', 'sys', 'dev', 'run', 'boot', 'lost+found', '.Trash', '.Trash-1000'],
};

const EXCLUDED_SEGMENTS = new Set(
    (EXCLUDED_DIR_NAMES[process.platform] ?? []).map(name => name.toLowerCase())
);

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
                { windowsHide: true }
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

function isExcludedDirName(name: string): boolean {
    if (EXCLUDED_SEGMENTS.has(name.toLowerCase())) return true;
    // macOS のアプリケーションバンドルは内部を書き換えると署名が壊れるため走査しない
    if (process.platform === 'darwin' && name.endsWith('.app')) return true;
    return false;
}

// クリーンアップ対象の一覧を返す。一覧は OS によらず共通で、
// Zone.Identifier も Windows では代替データストリーム、それ以外では
// 通常のファイルとして検出するため、いずれの環境でも対象になる。
// (renderer 側で一覧を二重定義しないよう、ここを唯一の定義元とする)
export function getAvailableCleanupTargets(): CleanupTargetId[] {
    return TARGETS.map(target => target.id);
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

// Windows 以外では、Windows からコピーしたり書庫を解凍した際に
// 代替データストリームが "元のファイル名:Zone.Identifier" という
// 通常のファイルとして現れる (NTFS 以外では ADS を保持できないため)。
// Windows のファイル名に ":" は使えないので、この判定は全環境で安全に実行できる。
const ZONE_IDENTIFIER_SUFFIX = ':Zone.Identifier';

export function isZoneIdentifierFile(name: string): boolean {
    return name.endsWith(ZONE_IDENTIFIER_SUFFIX) && name.length > ZONE_IDENTIFIER_SUFFIX.length;
}

// Windows ADS (Zone.Identifier) の存在を open の成否で確認する
async function hasZoneIdentifier(filePath: string): Promise<boolean> {
    try {
        const handle = await fs.promises.open(`${filePath}:Zone.Identifier`, 'r');
        await handle.close();
        return true;
    } catch {
        return false;
    }
}

export type CleanupScanOptions = {
    roots: string[];
    targets: CleanupTargetId[];
};

// 選択されたルートを再帰走査して対象を検出する
export async function scanCleanupTargets(jobId: string, options: CleanupScanOptions): Promise<CleanupScanResult> {
    startJob(jobId);
    const selected = new Set(options.targets);
    const fileTargets = TARGETS.filter(target => target.kind === 'file' && selected.has(target.id));
    const prefixTargets = TARGETS.filter(target => target.kind === 'prefix' && selected.has(target.id));
    const dirTargets = TARGETS.filter(target => target.kind === 'dir' && selected.has(target.id));
    const wantsZoneIdentifier = selected.has('zoneIdentifier');
    // ADS の存在確認はファイルごとに open を試すため Windows でのみ行う
    const checkAds = process.platform === 'win32' && wantsZoneIdentifier;

    const items: CleanupItem[] = [];
    const errors: string[] = [];
    let cancelled = false;
    let visitedDirs = 0;

    const pushItem = (item: CleanupItem) => {
        items.push(item);
        emitJobEvent({ jobId, kind: 'item', payload: item });
    };

    try {
        for (const root of options.roots) {
            if (isCancelled(jobId)) {
                cancelled = true;
                break;
            }
            const stack: string[] = [root];
            while (stack.length > 0) {
                if (isCancelled(jobId)) {
                    cancelled = true;
                    break;
                }
                const current = stack.pop() as string;
                visitedDirs += 1;
                if (visitedDirs % 100 === 0) {
                    emitJobEvent({ jobId, kind: 'log', message: current });
                }
                let entries: fs.Dirent[];
                try {
                    entries = await fs.promises.readdir(current, { withFileTypes: true });
                } catch {
                    // アクセスできないディレクトリはスキップ
                    continue;
                }
                for (const entry of entries) {
                    const entryPath = path.join(current, entry.name);
                    try {
                        if (entry.isSymbolicLink()) {
                            // シンボリックリンクは辿らない
                            continue;
                        }
                        if (entry.isDirectory()) {
                            if (isExcludedDirName(entry.name)) {
                                continue;
                            }
                            const dirTarget = dirTargets.find(target => target.pattern === entry.name);
                            if (dirTarget) {
                                // 対象ディレクトリは丸ごと削除対象とし、配下は走査しない
                                pushItem({ path: entryPath, targetId: dirTarget.id, kind: 'dir' });
                                continue;
                            }
                            stack.push(entryPath);
                        } else if (entry.isFile()) {
                            // Windows 以外で ADS が通常のファイルとして現れたもの
                            if (wantsZoneIdentifier && isZoneIdentifierFile(entry.name)) {
                                pushItem({ path: entryPath, targetId: 'zoneIdentifier', kind: 'file' });
                                continue;
                            }
                            const fileTarget = fileTargets.find(target => target.pattern === entry.name);
                            if (fileTarget) {
                                pushItem({ path: entryPath, targetId: fileTarget.id, kind: 'file' });
                                continue;
                            }
                            const prefixTarget = prefixTargets.find(target => entry.name.startsWith(target.pattern));
                            if (prefixTarget) {
                                pushItem({ path: entryPath, targetId: prefixTarget.id, kind: 'file' });
                                continue;
                            }
                            if (checkAds && (await hasZoneIdentifier(entryPath))) {
                                pushItem({
                                    path: `${entryPath}:Zone.Identifier`,
                                    targetId: 'zoneIdentifier',
                                    kind: 'ads',
                                });
                            }
                        }
                    } catch (error) {
                        if (errors.length < 100) {
                            errors.push(`${entryPath}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                }
            }
            if (cancelled) break;
        }
    } finally {
        finishJob(jobId);
    }
    return { items, cancelled: cancelled || isCancelled(jobId), errors };
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
