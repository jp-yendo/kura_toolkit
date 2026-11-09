// source の要素を target の末尾へ足す。
// push(...source) は要素を引数として渡すため、要素が十数万を超えると RangeError になる。件数に上限の無い配列にはこちらを使う
export function appendAll<T>(target: T[], source: readonly T[]): void {
    for (const value of source) target.push(value);
}
