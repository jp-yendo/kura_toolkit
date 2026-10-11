import type { HdrMetadata } from './probe';

// HDR のマスタリングの情報をエンコーダへ渡す引数 (書けないエンコーダでは何も渡さない)
export function hdrArgs(encoder: string, track: number, hdr: HdrMetadata | null): string[] {
    if (!hdr) return [];
    const params: string[] = [];
    const { display, light } = hdr;
    if (encoder === 'libsvtav1') {
        const xy = ([x, y]: [number, number]) => `(${x.toFixed(4)},${y.toFixed(4)})`;
        if (display) {
            params.push(
                `mastering-display=G${xy(display.green)}B${xy(display.blue)}R${xy(display.red)}WP${xy(display.white)}` +
                    `L(${display.maxLuminance.toFixed(4)},${display.minLuminance.toFixed(4)})`
            );
        }
        if (light) params.push(`content-light=${Math.round(light.maxContent)},${Math.round(light.maxAverage)}`);
        return params.length > 0 ? [`-svtav1-params:v:${track}`, params.join(':')] : [];
    }
    // x264・x265 は色度を 0.00002、明るさを 0.0001 cd/m² の整数で書く
    const xy = ([x, y]: [number, number]) => `(${Math.round(x * 50000)},${Math.round(y * 50000)})`;
    const masterDisplay = display
        ? `G${xy(display.green)}B${xy(display.blue)}R${xy(display.red)}WP${xy(display.white)}` +
          `L(${Math.round(display.maxLuminance * 10000)},${Math.round(display.minLuminance * 10000)})`
        : null;
    const contentLight = light ? `${Math.round(light.maxContent)},${Math.round(light.maxAverage)}` : null;
    if (encoder === 'libx265') {
        if (masterDisplay) params.push(`master-display=${masterDisplay}`);
        if (contentLight) params.push(`max-cll=${contentLight}`);
        if (params.length > 0) params.push('hdr10=1');
        return params.length > 0 ? [`-x265-params:v:${track}`, params.join(':')] : [];
    }
    if (encoder === 'libx264') {
        if (masterDisplay) params.push(`mastering-display=${masterDisplay}`);
        if (contentLight) params.push(`cll=${contentLight}`);
        return params.length > 0 ? [`-x264-params:v:${track}`, params.join(':')] : [];
    }
    return [];
}
