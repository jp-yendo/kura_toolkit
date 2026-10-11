import { resolveFfmpegPath, runTool } from './ffmpeg';

// 使っている ffmpeg のフィルタの一覧。ffmpeg のパスごとに覚える。調べられない場合 (ffmpeg が無い・一覧を得られない) は
// null を返し、覚えない (ffmpeg を直したり設定し直したりした後に、もう一度調べるため)
const filtersCache = new Map<string, Set<string>>();

export async function availableFilters(): Promise<Set<string> | null> {
    const ffmpegPath = resolveFfmpegPath();
    if (!ffmpegPath) return null;
    const cached = filtersCache.get(ffmpegPath);
    if (cached) return cached;
    let stdout: string;
    try {
        const result = await runTool(ffmpegPath, ['-hide_banner', '-filters']);
        if (result.code !== 0) return null;
        stdout = result.stdout;
    } catch {
        return null;
    }
    // 一覧の各行は「 .S zscale            V->V       説明」の形
    const filters = new Set(
        stdout
            .split(/\r?\n/)
            .map(line => /^\s*[TSC.]{2,3}\s+(\S+)\s+\S*->\S*/.exec(line)?.[1])
            .filter((name): name is string => !!name)
    );
    if (filters.size === 0) return null;
    filtersCache.set(ffmpegPath, filters);
    return filters;
}
