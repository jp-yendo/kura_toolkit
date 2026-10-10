// sRGB から CIE Lab (D65) への変換

// sRGB の値 (0-255) から線形の値 (0-1) への表
const LINEAR = new Float64Array(256);
for (let v = 0; v < 256; v++) {
    const c = v / 255;
    LINEAR[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function f(t: number): number {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

// sRGB の色 (各 0-255 の整数) の Lab を out の offset から 3 つ書く
export function labInto(r: number, g: number, b: number, out: Float32Array | Float64Array, offset: number): void {
    const R = LINEAR[r];
    const G = LINEAR[g];
    const B = LINEAR[b];
    const fx = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const fy = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const fz = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    out[offset] = 116 * fy - 16;
    out[offset + 1] = 500 * (fx - fy);
    out[offset + 2] = 200 * (fy - fz);
}

// sRGB の色 (各 0-255 の整数) の Lab
export function toLab(r: number, g: number, b: number): [number, number, number] {
    const out = new Float64Array(3);
    labInto(r, g, b, out, 0);
    return [out[0], out[1], out[2]];
}
