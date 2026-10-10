import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Trial } from './search';

// 試行の候補のうち、再現度の上位だけをファイルで持つ。
// SVG はメモリに持ち続けず、作業ごとの置き場のファイルに書いて、指標と設定とファイルの場所だけを持つ。
// 同じ SVG になった候補は 1 つにまとめ、上位から外れた候補のファイルはその場で消す

type Candidate = {
    trial: Trial;
    fidelity: number;
    // path 要素の数と SVG の大きさ (バイト)
    pathCount: number;
    bytes: number;
    // SVG の中身の要約 (同じ SVG を見分ける)
    hash: string;
    file: string;
};

// 候補の順: 再現度の高い順。同じならパスの少ない順、さらに同じなら小さい順
function compareCandidates(a: Candidate, b: Candidate): number {
    return b.fidelity - a.fidelity || a.pathCount - b.pathCount || a.bytes - b.bytes;
}

export class CandidatePool {
    private readonly candidates: Candidate[] = [];
    private written = 0;

    constructor(
        private readonly dir: string,
        private readonly capacity: number
    ) {}

    // 候補を加え、上位が変わったかを返す (同じ SVG の候補がすでにあるとき・上位に入らないときはファイルを書かない)
    async add(trial: Trial, svg: string, fidelity: number, pathCount: number): Promise<boolean> {
        const hash = crypto.createHash('sha256').update(svg).digest('hex');
        if (this.candidates.some(candidate => candidate.hash === hash)) return false;
        const bytes = Buffer.byteLength(svg);
        const entry: Omit<Candidate, 'file'> = { trial, fidelity, pathCount, bytes, hash };
        const worst = this.candidates[this.candidates.length - 1];
        if (this.candidates.length >= this.capacity && compareCandidates({ ...entry, file: '' }, worst) >= 0) {
            return false;
        }
        this.written++;
        const file = path.join(this.dir, `trial-${this.written}.svg`);
        await fs.writeFile(file, svg, 'utf-8');
        this.candidates.push({ ...entry, file });
        this.candidates.sort(compareCandidates);
        const dropped = this.candidates.splice(this.capacity);
        await Promise.all(dropped.map(candidate => fs.rm(candidate.file, { force: true })));
        return true;
    }

    // 上位の候補 (候補の順)
    ranked(): Candidate[] {
        return [...this.candidates];
    }

    // 最も高い再現度 (候補が無いときは null)
    bestFidelity(): number | null {
        return this.candidates[0]?.fidelity ?? null;
    }

    // 候補のファイルを消す
    async clear(): Promise<void> {
        await Promise.all(this.candidates.map(candidate => fs.rm(candidate.file, { force: true })));
        this.candidates.length = 0;
    }
}
