import fs from 'fs';
import path from 'path';
import type { CleanupItem, CleanupTargetId } from '../../shared/types';

// クリーンアップ対象の定義と、ディレクトリ 1 個ぶんの判定 (元: CleanSweep/clean_sweep.py)。
// 走査ワーカー (worker_threads) からも読み込むため、このモジュールは electron に依存しない。

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

const EXCLUDED_SEGMENTS = new Set((EXCLUDED_DIR_NAMES[process.platform] ?? []).map(name => name.toLowerCase()));

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

// Windows 以外では、Windows からコピーしたり書庫を解凍した際に
// 代替データストリームが "元のファイル名:Zone.Identifier" という
// 通常のファイルとして現れる (NTFS 以外では ADS を保持できないため)。
// Windows のファイル名に ":" は使えないので、この判定は全環境で安全に実行できる。
const ZONE_IDENTIFIER_SUFFIX = ':Zone.Identifier';

function isZoneIdentifierFile(name: string): boolean {
    return name.endsWith(ZONE_IDENTIFIER_SUFFIX) && name.length > ZONE_IDENTIFIER_SUFFIX.length;
}

// Windows ADS (Zone.Identifier) の存在を確認する。
// open ではなく statSync を使うのは、存在しないときでも例外も Promise も生成せず
// undefined が返るため。実測で 1 件あたり 43us -> 15us になり、走査ファイル数ぶん効く。
//
// ADS の有無をディレクトリ一覧から知る手段は Windows に無いため、ファイルごとの判定は避けられない
// (ディレクトリ列挙が返す FILE_ATTRIBUTE_* に ADS の有無を示すビットが無く、
//  ストリーム列挙 API はファイル単位。MFT の直読みは管理者権限が必要)。
// ボリューム単位で判定を省くこともできない。ファイルシステム名も GetVolumeInformation の
// FILE_NAMED_STREAMS も当てにならず、FAT32 かつ非対応と申告しながら実際には ADS を保持する
// クラウドドライブが存在する。
function hasZoneIdentifier(filePath: string): boolean {
    try {
        return fs.statSync(`${filePath}${ZONE_IDENTIFIER_SUFFIX}`, { throwIfNoEntry: false }) !== undefined;
    } catch {
        // ENOENT 以外 (権限不足など) は「無し」として扱う
        return false;
    }
}

// 走査条件。ワーカーへ postMessage するためプレーンなデータだけで構成する
export type CleanupScanConfig = {
    fileTargets: { id: CleanupTargetId; pattern: string }[];
    prefixTargets: { id: CleanupTargetId; pattern: string }[];
    dirTargets: { id: CleanupTargetId; pattern: string }[];
    wantsZoneIdentifier: boolean;
    // ADS の存在確認はファイルごとに判定するため Windows でのみ行う
    checkAds: boolean;
};

export function buildCleanupScanConfig(targets: CleanupTargetId[]): CleanupScanConfig {
    const selected = new Set(targets);
    const pick = (kind: TargetKind) =>
        TARGETS.filter(target => target.kind === kind && selected.has(target.id)).map(target => ({
            id: target.id,
            pattern: target.pattern,
        }));
    const wantsZoneIdentifier = selected.has('zoneIdentifier');
    return {
        fileTargets: pick('file'),
        prefixTargets: pick('prefix'),
        dirTargets: pick('dir'),
        wantsZoneIdentifier,
        checkAds: process.platform === 'win32' && wantsZoneIdentifier,
    };
}

export type DirectoryScanResult = {
    // 見つかった対象
    items: CleanupItem[];
    // さらに走査すべきサブディレクトリ
    subdirs: string[];
    // ADS 判定が必要なファイル (config.checkAds のときのみ集まる)。
    // 判定を呼び出し側に委ねるのは、ファイルが数万ある単一ディレクトリを
    // 複数スレッドへ分割できるようにするため
    adsCandidates: string[];
    // エントリ単位のエラー (アクセス不可など)
    errors: string[];
};

// ADS 判定をまとめて処理する単位。ファイルが数万ある単一ディレクトリでも
// この単位に切って複数スレッドへ回せるようにする
export const ADS_CHUNK_SIZE = 512;

// ADS 判定だけを行う。scanCleanupDirectory が集めた候補に対して呼ぶ
export function scanAdsCandidates(paths: string[], items: CleanupItem[]): void {
    for (const filePath of paths) {
        if (hasZoneIdentifier(filePath)) {
            items.push({
                path: `${filePath}${ZONE_IDENTIFIER_SUFFIX}`,
                targetId: 'zoneIdentifier',
                kind: 'ads',
            });
        }
    }
}

// ディレクトリ 1 個を走査して、対象と配下のサブディレクトリを out へ集める。
// 判定の順序は元実装と同一で、変えると検出結果が変わる。
// 読み取れないディレクトリは黙って飛ばす。
export function scanCleanupDirectory(dir: string, config: CleanupScanConfig, out: DirectoryScanResult): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        // アクセスできないディレクトリはスキップ
        return;
    }
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        try {
            if (entry.isSymbolicLink()) {
                // シンボリックリンクは辿らない
                continue;
            }
            if (entry.isDirectory()) {
                if (isExcludedDirName(entry.name)) {
                    continue;
                }
                const dirTarget = config.dirTargets.find(target => target.pattern === entry.name);
                if (dirTarget) {
                    // 対象ディレクトリは丸ごと削除対象とし、配下は走査しない
                    out.items.push({ path: entryPath, targetId: dirTarget.id, kind: 'dir' });
                    continue;
                }
                out.subdirs.push(entryPath);
            } else if (entry.isFile()) {
                // Windows 以外で ADS が通常のファイルとして現れたもの
                if (config.wantsZoneIdentifier && isZoneIdentifierFile(entry.name)) {
                    out.items.push({ path: entryPath, targetId: 'zoneIdentifier', kind: 'file' });
                    continue;
                }
                const fileTarget = config.fileTargets.find(target => target.pattern === entry.name);
                if (fileTarget) {
                    out.items.push({ path: entryPath, targetId: fileTarget.id, kind: 'file' });
                    continue;
                }
                const prefixTarget = config.prefixTargets.find(target => entry.name.startsWith(target.pattern));
                if (prefixTarget) {
                    out.items.push({ path: entryPath, targetId: prefixTarget.id, kind: 'file' });
                    continue;
                }
                if (config.checkAds) {
                    // 判定そのものはここでは行わない (呼び出し側が分割して並列に処理する)
                    out.adsCandidates.push(entryPath);
                }
            }
        } catch (error) {
            out.errors.push(`${entryPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
