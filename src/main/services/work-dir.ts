import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { saveSettings } from './settings';
import {
    defaultStorageDir,
    getCacheDir,
    getLibraryDir,
    getModelDir,
    getWorkDir,
    isSameOrNested,
    isSamePath,
} from './storage';

// 作業ディレクトリ (アプリ全体の一時ファイルの置き場) の管理。
// 設定する作業ディレクトリは一時ディレクトリそのもの (既定は OS の一時ディレクトリ。Linux は ~/.kura_toolkit/temp)。
// 共用の一時ディレクトリでもよい。
// アプリはその直下へ「kura_toolkit_<ランダムな値>」のフォルダを作る (名前の接頭辞でこのアプリのものと分かるため、
// ほかのファイルと混ざらない。分類の階層は作らず、名前にも意味を持たせない)。
// - 機能の作業 (分離・変換・読み上げの画面ごと): 作業の識別子 (renderer が作るランダムな値) を名前に使う。
//   機能の中で使い続けるもの (入力・候補・試聴用の音など) を置き、別の機能へ移ったとき (作業の破棄) に消す
// - 1 回の処理の一時ファイル・外部のプロセス 1 つ分の一時ファイル (TEMP / TMPDIR の向け先): 処理・プロセスが
//   終わったら消す
// 消すものは、その時点ですぐには消さずにクリーンアップの一覧に積み、次の処理を始めるとき・機能の画面に入ったときに
// まとめて消す (終了したばかりのプロセスや再生がファイルを掴んでいて消せないことを減らすため)。消せなかったものは
// 一覧から外し、次の起動時の片付けに任せる。アプリの終了時や強制終了で残ったものも、次の起動時に裏で消す。
// ここに置くのは、その処理・機能の中で作って使い、消すものだけ。最終的に別の場所へ置くもの (ダウンロードした
// ファイル・展開する書庫など) は、ドライブをまたぐコピーを避けるため、置き場所と同じディスクに直接書く

// このアプリが作業ディレクトリに作るフォルダの名前の接頭辞
const FOLDER_PREFIX = 'kura_toolkit_';

// クリーンアップの一覧に積むときに付ける名前 (元の名前の後ろに付けて、元の名前を空ける)
const DISCARD_SUFFIX = '.kura-discard-';

// クリーンアップの一覧 (次にまとめて消すもの)
const cleanupList = new Set<string>();
// 使い続けるもの (作り直している途中・使い回しているもの)。名前を変えられずに一覧に積んだものと同じ名前でも消さない
const keptPaths = new Set<string>();
// 作っている途中の結果 (同じ結果を同時に作らないよう、作り終えるまで待たせる)
const producing = new Map<string, Promise<void>>();
// 実行中のクリーンアップ (作業ディレクトリを変える前に、消し終わるのを待つため)
const runningCleanups = new Set<Promise<void>>();

function isDefaultWorkDir(dir: string): boolean {
    return isSamePath(dir, defaultStorageDir('work'));
}

// 作業ディレクトリの変更先を確かめる (空文字は既定の場所)。今と同じ場所なら null を返す。
// 一時ディレクトリそのものを選ぶため、中にほかのファイルがあってもよい。
// ライブラリ・モデル・キャッシュディレクトリ (またはその中) は選べない
export function checkWorkDirChange(dir: string): string | null {
    const trimmed = dir.trim();
    const target = trimmed ? path.resolve(trimmed) : defaultStorageDir('work');
    if (isSamePath(target, getWorkDir())) return null;
    // 既定の場所 (Linux の ~/.kura_toolkit/temp) は、無ければ使うときに作る
    if (!fs.existsSync(target) && !isDefaultWorkDir(target)) throw new Error(`WORK_DIR_MISSING: ${target}`);
    if ([getLibraryDir(), getModelDir(), getCacheDir()].some(dir => isSameOrNested(target, dir))) {
        throw new Error('STORAGE_OVERLAP');
    }
    return target;
}

// 作業ディレクトリにある、このアプリのフォルダ
function appFolders(dir: string): string[] {
    try {
        return fs
            .readdirSync(dir)
            .filter(name => name.startsWith(FOLDER_PREFIX))
            .map(name => path.join(dir, name));
    } catch {
        return [];
    }
}

// 作業ディレクトリを変える (target は checkWorkDirChange で確かめた場所)。
// クリーンアップの一覧を消し終えてから、今の場所にこのアプリのフォルダが残っていれば (処理中・作業の結果があるとき・
// 消せなかったものがあるとき) 変えない (変えると、前の場所に残ったものを後から消せなくなるため)。
// 呼び出し側は、処理中でないことを確かめ、待機中の外部のプロセス (一時ファイルの置き場を持ち続ける) を止めてから呼ぶ
export async function changeWorkDir(target: string): Promise<void> {
    void runCleanup();
    await Promise.all(runningCleanups);
    if (appFolders(getWorkDir()).length > 0) throw new Error('WORK_DIR_IN_USE');
    saveSettings({ storage: { workDir: isDefaultWorkDir(target) ? '' : target } });
}

// 作業ディレクトリ。選んだ作業ディレクトリが無くなっている場合は作らずに止める
// (ドライブの取り外しや名前の変更で、利用者の知らない場所にフォルダを作らないため)
// 既定の場所 (Linux の ~/.kura_toolkit/temp) はアプリの場所のため、無ければ作る
function existingWorkDir(): string {
    const dir = getWorkDir();
    if (!fs.existsSync(dir)) {
        if (!isDefaultWorkDir(dir)) throw new Error(`WORK_DIR_MISSING: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function createFolder(id: string): string {
    const dir = path.join(existingWorkDir(), `${FOLDER_PREFIX}${id}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// 作業ディレクトリに、このアプリのランダムな名前のフォルダを作る。使い終わったら (成否・キャンセルを問わず)
// 呼び出し側が discardLater で消す
export function newTempDir(): string {
    return createFolder(newId());
}

// Python 以外の外部のプロセス (ffmpeg・ffprobe・nvidia-smi・PowerShell) 1 つ分の一時ファイルの置き場を作り、
// TEMP / TMP / TMPDIR をそこへ向けた環境変数を返す。プロセスが終了したら、呼び出し側が dir を discardLater で消す。
// 作業ディレクトリを使えない場合 (選んだフォルダが無いなど) は null を返し、呼び出し側は OS の一時ディレクトリのまま
// 起動する (ffmpeg の検出や音声の解析など、作業ディレクトリが無くても動く必要がある処理のため)
export function toolTempEnv(): { env: NodeJS.ProcessEnv; dir: string } | null {
    try {
        const dir = newTempDir();
        return { env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir }, dir };
    } catch {
        return null;
    }
}

// 作業の識別子は renderer が作るランダムな値で、そのままフォルダ名に使うため、パスとして安全な文字に限る
function checkWorkKey(workKey: string): string {
    if (!/^[0-9a-f]{16,32}$/.test(workKey)) throw new Error('INVALID_WORK_KEY');
    return workKey;
}

// 作業ごとの置き場
export function sessionDir(workKey: string, ...parts: string[]): string {
    const dir = path.join(createFolder(checkWorkKey(workKey)), ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// 作業ごとの置き場 (作らずに場所だけを返す)
export function sessionPath(workKey: string): string {
    return path.join(getWorkDir(), `${FOLDER_PREFIX}${checkWorkKey(workKey)}`);
}

// 作業を、作業ごと消す (別の機能へ移ったとき・新しい作業を始めるとき)
export function removeSession(workKey: string): void {
    discardLater(sessionPath(workKey));
}

// 要らなくなったファイル・フォルダを、クリーンアップの一覧に積む (次の処理を始めるときなどにまとめて消す)。
// 積む前に別の名前に変えて、元の名前をすぐに空ける (同じ名前で作り直す・使い回すものが、消す途中のものと
// 重ならないようにするため)。名前を変えられない場合 (無い・掴まれている) は、そのままの名前で積む
export function discardLater(target: string): void {
    const resolved = path.resolve(target);
    keptPaths.delete(resolved);
    const renamed = `${resolved}${DISCARD_SUFFIX}${newId()}`;
    try {
        fs.renameSync(resolved, renamed);
        cleanupList.add(renamed);
    } catch (error) {
        // 既に無いものは積まない (同じ名前で後から作るものを、次のクリーンアップで消さないため)
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupList.add(resolved);
    }
}

// 使い続けるものとして、クリーンアップで消さないようにする (名前を変えられずに一覧に積んだものを、同じ名前で
// 作り直す・使い回す場合。始まっているクリーンアップも、消す直前に確かめて消さない)
export function keepWorkFile(target: string): void {
    const resolved = path.resolve(target);
    cleanupList.delete(resolved);
    keptPaths.add(resolved);
}

// クリーンアップの一覧にあるものを消し始める。消せなかったものはエラーにせず一覧から外し、次の起動時の片付けに任せる。
// 処理を始めるときは完了を待たない (消すのに時間がかかっても処理を待たせないため)
export function runCleanup(): Promise<void> {
    const targets = [...cleanupList];
    cleanupList.clear();
    if (targets.length === 0) return Promise.resolve();
    const run = (async () => {
        for (const target of targets) {
            if (keptPaths.has(target)) continue;
            try {
                await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
            } catch (error) {
                console.warn(`failed to remove temporary files ${target}`, error);
            }
        }
    })().finally(() => runningCleanups.delete(run));
    runningCleanups.add(run);
    return run;
}

function isInside(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    // 「..cache」のような名前の子フォルダを外側と取り違えないよう、「..」の階層だけを外側とみなす
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// パスが作業ディレクトリのこのアプリのフォルダの中にあるか
function isInWorkDir(target: string): boolean {
    const dir = getWorkDir();
    const resolved = path.resolve(target);
    if (!isInside(resolved, dir)) return false;
    return path.relative(dir, resolved).split(path.sep)[0].startsWith(FOLDER_PREFIX);
}

// 結果のファイルを作る。別の名前に書いてから正式な名前にし、失敗・キャンセルしたら書きかけを消す
// (同じ結果を使い回すもの (あれば作り直さないもの) が、書きかけを完成したものと取り違えないため)。
// 一時的な名前は拡張子を保つ (ffmpeg が出力の形式を拡張子で決めるため)。
// 書きかけは、作業ディレクトリの中ならクリーンアップの一覧に積み、外 (書き出し先・モデルディレクトリなど) なら
// その場で消す (作業ディレクトリの外は起動時の片付けの対象ではないため)
export async function produceFile(output: string, produce: (target: string) => Promise<unknown>): Promise<void> {
    const extension = path.extname(output);
    const partial = `${output.slice(0, output.length - extension.length)}.kura-tmp${extension}`;
    keepWorkFile(output);
    keepWorkFile(partial);
    try {
        await produce(partial);
        await fs.promises.rename(partial, output);
    } catch (error) {
        if (isInWorkDir(partial)) {
            discardLater(partial);
        } else {
            await fs.promises
                .rm(partial, { force: true, maxRetries: 10, retryDelay: 200 })
                .catch(removeError => console.warn(`failed to remove ${partial}`, removeError));
        }
        throw error;
    } finally {
        keptPaths.delete(path.resolve(partial));
    }
}

// 同じ結果を使い回すもの (重ねた音・移調した伴奏・合成結果) を用意する。あれば使い回し、無ければ作る。
// 同じものを同時に頼まれた場合は、先に始めた方を待って使う (同じ書きかけに 2 つの処理が書かないようにするため)
export async function produceShared(output: string, produce: (target: string) => Promise<unknown>): Promise<void> {
    const resolved = path.resolve(output);
    const running = producing.get(resolved);
    if (running) return running;
    if (fs.existsSync(resolved)) {
        keepWorkFile(resolved);
        return;
    }
    const task = produceFile(resolved, produce).finally(() => producing.delete(resolved));
    producing.set(resolved, task);
    return task;
}

export function newId(): string {
    return crypto.randomBytes(8).toString('hex');
}

// 1 回の処理用の一時ファイル置き場を作り、処理が終わったら (成否・キャンセルを問わず) 消す
export async function withJobTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = newTempDir();
    try {
        return await fn(dir);
    } finally {
        discardLater(dir);
    }
}

// 起動時に、前回の起動が残したもの (終了時に作業中だった結果・強制終了で残った一時ファイル) を裏で消す。
// アプリは 1 つしか起動しないため、起動した時点で作業ディレクトリにあるこのアプリのフォルダはすべて前回の残り物。
// 新しい処理はランダムな名前のフォルダを作るため、残り物と取り違えない (起動を待たせずに消す)
export function removeLeftoverWorkFiles(): void {
    for (const target of appFolders(getWorkDir())) discardLater(target);
    void runCleanup();
}

// パスが、その作業の置き場の中にあるか (renderer から渡されたパスを使う・消すときの安全確認)
export function isInsideWork(workKey: string, target: string): boolean {
    return isInside(path.resolve(target), sessionPath(workKey));
}
