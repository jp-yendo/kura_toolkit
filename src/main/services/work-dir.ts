import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { saveSettings } from './settings';
import { defaultStorageDir, getLibraryDir, getModelDir, getWorkDir, isSameOrNested, isSamePath } from './storage';

// 作業ディレクトリ (アプリ全体の一時ファイルの置き場) の管理。
// 作業ディレクトリは選んだフォルダをそのまま使う (アプリは 1 つしか起動しないため、中を分けない)。
// 既定の場所 (OS の一時ディレクトリの中のこのアプリ用のフォルダ) はアプリが作り、空になったら消す。
// 中のものはすべて、必要になった時点で作り、不要になった時点で (成功・エラー・キャンセルを問わず) その場で消す。
// 消した結果空になったフォルダも、その場で消す。
// <作業ディレクトリ>/session/<作業>/...  作業の結果 (候補など)。候補・作業を破棄したときに消す。
//                                         作りかけの結果は、失敗・キャンセルした時点で消す
// <作業ディレクトリ>/jobs/<ID>/          1 回の処理の一時ファイル。完了・エラー・キャンセルのいずれでも消す
// <作業ディレクトリ>/tmp/<ID>/           外部のプロセス 1 つ分の一時ファイル (TEMP / TMPDIR の向け先)。プロセスの終了時に消す
// <作業ディレクトリ>/recordings/          学習用の録音。学習が終わった時点と破棄した時点で消す
// アプリの終了時や強制終了で残ったものは、次の起動時に裏で消す (終了を待たせないため、終了時には消さない)。
// ここに置くのは、その処理の中で作って使い、消すものだけ (中間ファイル・外部のプロセスの作業場所など)。
// 最終的に別の場所へ置くもの (ダウンロードしたファイル・展開する書庫など) は、ドライブをまたぐコピーを
// 避けるため、置き場所と同じディスクに直接書く

// 作業ディレクトリの中でこのアプリが作るフォルダ (起動時の片付けはこれだけを消す)
const WORK_SUBDIRS = ['session', 'jobs', 'tmp', 'recordings'];
// 起動時の片付けで、消す前に前回の残り物を移しておく名前の接頭辞
const LEFTOVER_PREFIX = '.leftover-';

// 消している途中の一時ファイル (作業ディレクトリを変える前に、消し終わるのを待つため)
const pendingRemovals = new Set<Promise<void>>();

function isDefaultWorkDir(dir: string): boolean {
    return isSamePath(dir, defaultStorageDir('work'));
}

// 選んだフォルダが空か。フォルダが無い場合は WORK_DIR_MISSING で失敗させる
// (選んだものは既にあるフォルダのため、無いのは選んだ後に取り外し・名前の変更があった場合)
function isEmptyDir(dir: string): boolean {
    try {
        return fs.readdirSync(dir).length === 0;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`WORK_DIR_MISSING: ${dir}`);
        throw error;
    }
}

// 作業ディレクトリの変更先を確かめる (空文字は既定の場所)。今と同じ場所なら null を返す。
// 他のファイルと混ざらないよう空のフォルダに限り、ライブラリ・モデルディレクトリと重なる場所は選べない
export function checkWorkDirChange(dir: string): string | null {
    const trimmed = dir.trim();
    const target = trimmed ? path.resolve(trimmed) : defaultStorageDir('work');
    if (isSamePath(target, getWorkDir())) return null;
    if (isSameOrNested(target, getLibraryDir()) || isSameOrNested(target, getModelDir())) {
        throw new Error('STORAGE_OVERLAP');
    }
    if (!isDefaultWorkDir(target) && !isEmptyDir(target)) {
        throw new Error(`STORAGE_TARGET_NOT_EMPTY: ${target}`);
    }
    return target;
}

// 今の作業ディレクトリに、このアプリのフォルダ (names のいずれか) があるか
function hasWorkFiles(names: string[]): boolean {
    const current = getWorkDir();
    return names.some(name => fs.existsSync(path.join(current, name)));
}

// 作業ディレクトリを変えられる状態か (処理中のものや作業の結果が無いか) を確かめる。
// 外部のプロセスの一時ファイル (tmp) は、待機中のプロセスを止めれば消えるため、ここでは見ない
export async function checkWorkDirIdle(): Promise<void> {
    // 破棄した結果を消している途中なら、消し終わるのを待ってから確かめる
    await Promise.all(pendingRemovals);
    if (hasWorkFiles(['session', 'jobs', 'recordings'])) throw new Error('WORK_DIR_IN_USE');
}

// 作業ディレクトリを変える (target は checkWorkDirChange で確かめた場所)。選んだフォルダをそのまま使う。
// 今の場所にこのアプリのファイルが残っている間 (処理中・作業の結果があるとき) は変えない
// (変えると、前の場所に残ったものを後から消せなくなるため)。
// 呼び出し側は、処理中でないことを確かめ、待機中の外部のプロセス (一時ファイルの置き場を持ち続ける) を
// 止めてから呼ぶ
export async function changeWorkDir(target: string): Promise<void> {
    const current = getWorkDir();
    await Promise.all(pendingRemovals);
    if (hasWorkFiles(WORK_SUBDIRS)) throw new Error('WORK_DIR_IN_USE');
    saveSettings({ storage: { workDir: isDefaultWorkDir(target) ? '' : target } });
    if (isDefaultWorkDir(current)) await removeEmptyDir(current);
}

// 作業ディレクトリ。既定の場所は無ければ作る。選んだフォルダが無くなっている場合は作らずに止める
// (ドライブの取り外しや名前の変更で、利用者の知らない場所にフォルダを作らないため)
export function workRoot(): string {
    const dir = getWorkDir();
    if (isDefaultWorkDir(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    } else if (!fs.existsSync(dir)) {
        throw new Error(`WORK_DIR_MISSING: ${dir}`);
    }
    return dir;
}

function workSubdir(...parts: string[]): string {
    const dir = path.join(workRoot(), ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// 作業の識別子は renderer が作るため、パスとして安全な文字に限る
function checkWorkKey(workKey: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(workKey)) throw new Error('INVALID_WORK_KEY');
    return workKey;
}

// 作業ごとの結果の置き場
export function sessionDir(workKey: string, ...parts: string[]): string {
    return workSubdir('session', checkWorkKey(workKey), ...parts);
}

// 作業ごとの結果の置き場 (作らずに場所だけを返す)
export function sessionPath(workKey: string): string {
    return path.join(getWorkDir(), 'session', checkWorkKey(workKey));
}

// 作業ごとの結果を、作業ごと消す (作業を破棄したとき)
export function removeSession(workKey: string): Promise<void> {
    return removeTemp(sessionPath(workKey));
}

// 外部のプロセス 1 つ分の一時ファイルの置き場 (TEMP / TMP / TMPDIR の向け先)。プロセスが終了したら消す
export function processTempDir(): string {
    return workSubdir('tmp', newId());
}

// 一時ファイル・フォルダを消す。終了したばかりのプロセスがまだファイルを掴んでいる場合 (Windows) に備えて
// 少し待ちながら再試行する。作業ディレクトリの中のものなら、空になった親フォルダも消す
export function removeTemp(target: string): Promise<void> {
    const removal = removeAndPrune(target).finally(() => pendingRemovals.delete(removal));
    pendingRemovals.add(removal);
    return removal;
}

async function removeAndPrune(target: string): Promise<void> {
    try {
        await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
        console.warn(`failed to remove temporary files ${target}`, error);
        return;
    }
    await pruneEmptyParents(target);
}

function isInside(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    // 「..cache」のような名前の子フォルダを外側と取り違えないよう、「..」の階層だけを外側とみなす
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function removeEmptyDir(dir: string): Promise<boolean> {
    try {
        await fs.promises.rmdir(dir);
        return true;
    } catch {
        // 空でない (別の処理が使っている) か、既に無い
        return false;
    }
}

// 消したものの親から上へ、空になったフォルダを作業ディレクトリの手前まで消す。
// 作業ディレクトリ自体は、既定の場所 (このアプリ用のフォルダ) の場合だけ空なら消す (選んだフォルダは残す)。
// 別の処理が使っているフォルダは空でないため消えない
async function pruneEmptyParents(target: string): Promise<void> {
    const workDir = getWorkDir();
    let dir = path.dirname(path.resolve(target));
    if (!isInside(dir, workDir) && !isSamePath(dir, workDir)) return;
    while (isInside(dir, workDir)) {
        if (!(await removeEmptyDir(dir))) return;
        dir = path.dirname(dir);
    }
    if (isDefaultWorkDir(workDir)) await removeEmptyDir(workDir);
}

// 結果のファイルを作る。別の名前に書いてから正式な名前にし、失敗・キャンセルしたら書きかけを消す
// (同じ結果を使い回すもの (あれば作り直さないもの) が、書きかけを完成したものと取り違えないため)。
// 一時的な名前は拡張子を保つ (ffmpeg が出力の形式を拡張子で決めるため)
export async function produceFile(output: string, produce: (target: string) => Promise<unknown>): Promise<void> {
    const extension = path.extname(output);
    const partial = `${output.slice(0, output.length - extension.length)}.kura-tmp${extension}`;
    try {
        await produce(partial);
        await fs.promises.rename(partial, output);
    } catch (error) {
        await removeTemp(partial);
        throw error;
    }
}

export function newId(): string {
    return crypto.randomBytes(8).toString('hex');
}

// 1 回の処理用の一時ファイル置き場を作る。処理が終わったら (成否・キャンセルを問わず) 呼び出し側が removeTemp で消す
export function newJobTempDir(label: string): string {
    return workSubdir('jobs', `${label}-${newId()}`);
}

// 1 回の処理用の一時ファイル置き場を作り、処理が終わったら (成否・キャンセルを問わず) 消す
export async function withJobTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = workSubdir('jobs', newId());
    try {
        return await fn(dir);
    } finally {
        await removeTemp(dir);
    }
}

// 起動時に、前回の起動が残したもの (終了時に作業中だった結果・強制終了で残った一時ファイル) を裏で消す。
// アプリは 1 つしか起動しないため、作業ディレクトリの中のこのアプリのフォルダはすべて前回の残り物。
// 新しい処理が同じ名前のフォルダを使い始める前に、残り物を別の名前へ移してから消す
// (名前の変更だけをその場で行い、削除は起動を待たせずに行う)
export function removeLeftoverWorkFiles(): void {
    const dir = getWorkDir();
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return;
    }
    const targets: string[] = [];
    for (const name of names) {
        const full = path.join(dir, name);
        if (name.startsWith(LEFTOVER_PREFIX)) {
            targets.push(full);
        } else if (WORK_SUBDIRS.includes(name)) {
            const moved = path.join(dir, `${LEFTOVER_PREFIX}${newId()}`);
            try {
                fs.renameSync(full, moved);
                targets.push(moved);
            } catch (error) {
                console.warn(`failed to set aside leftover work files ${full}`, error);
            }
        }
    }
    void (async () => {
        for (const target of targets) {
            try {
                await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
            } catch (error) {
                console.warn(`failed to remove leftover work files ${target}`, error);
            }
        }
        if (isDefaultWorkDir(dir)) await removeEmptyDir(dir);
    })();
}

// パスが作業ディレクトリの中にあるか (renderer から渡されたパスを使う・消すときの安全確認)
export function isInsideWorkRoot(target: string): boolean {
    return isInside(path.resolve(target), getWorkDir());
}
