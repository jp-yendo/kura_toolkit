import fs from 'fs';
import path from 'path';

// ドラッグ&ドロップやディレクトリ選択で渡されたパスから、対象のファイルを集める

// 拡張子の判定 (extensions は小文字・ドット無し。空配列なら全て対象)
function matchesExtension(filePath: string, extensions: Set<string>): boolean {
    if (extensions.size === 0) return true;
    return extensions.has(path.extname(filePath).slice(1).toLowerCase());
}

// ディレクトリを再帰的に走査する。読めないディレクトリは黙って飛ばし、
// シンボリックリンクは辿らない (循環と意図しない範囲の走査を避けるため)
function walkDirectory(dirPath: string, extensions: Set<string>, found: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return;
    }
    // 表示順を安定させるため名前順に処理する
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const child = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walkDirectory(child, extensions, found);
        } else if (entry.isFile() && matchesExtension(child, extensions)) {
            found.push(child);
        }
    }
}

// 渡されたパスのうち、ディレクトリは配下 (サブディレクトリを含む) を走査して展開し、
// 拡張子が一致するファイルだけを重複なく返す
export function collectFiles(paths: string[], extensions: string[]): string[] {
    const allowed = new Set(extensions.map(value => value.toLowerCase()));
    const found: string[] = [];
    for (const target of paths) {
        try {
            const stat = fs.statSync(target);
            if (stat.isDirectory()) {
                walkDirectory(target, allowed, found);
            } else if (stat.isFile() && matchesExtension(target, allowed)) {
                found.push(target);
            }
        } catch {
            // 消えている・アクセスできないパスは無視する
        }
    }
    const seen = new Set<string>();
    return found.filter(filePath => {
        const key = path.resolve(filePath);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
