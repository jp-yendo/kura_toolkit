// タイムコード (HH:MM:SS:FF、ドロップフレームは HH:MM:SS;FF) を秒数だけ進める

// 秒数を、フレームレートで数えたフレーム数だけタイムコードを進める。読めない場合は null
export function shiftTimecode(timecode: string, seconds: number, frameRate: number): string | null {
    const match = /^(\d{1,2}):(\d{2}):(\d{2})([:;.,])(\d{2,3})$/.exec(timecode.trim());
    if (!match || !(frameRate > 0)) return null;
    const [, hh, mm, ss, separator, ff] = match;
    // 1 秒あたりのフレーム数の呼び方 (29.97 は 30、59.94 は 60)
    const nominal = Math.round(frameRate);
    // ドロップフレームは 29.97・59.94 のときだけ (1 分ごとに先頭の番号を飛ばし、10 分ごとには飛ばさない)
    const drop =
        (separator === ';' || separator === ',') && nominal % 30 === 0 && Math.abs(frameRate - nominal) > 0.001;
    const dropped = drop ? (nominal / 30) * 2 : 0;
    const minutes = Number(hh) * 60 + Number(mm);
    let frames = (minutes * 60 + Number(ss)) * nominal + Number(ff);
    if (drop) frames -= dropped * (minutes - Math.floor(minutes / 10));
    frames += Math.round(seconds * frameRate);
    if (frames < 0) return null;

    if (drop) {
        // フレーム番号から、飛ばした番号を足し戻して表記にする
        const perTenMinutes = nominal * 600 - dropped * 9;
        const perMinute = nominal * 60 - dropped;
        const tens = Math.floor(frames / perTenMinutes);
        const rest = frames % perTenMinutes;
        frames += dropped * 9 * tens + (rest > dropped ? dropped * Math.floor((rest - dropped) / perMinute) : 0);
    }
    const pad = (value: number) => String(value).padStart(2, '0');
    const ffOut = frames % nominal;
    const totalSeconds = Math.floor(frames / nominal);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutesOut = Math.floor(totalSeconds / 60) % 60;
    return `${pad(hours)}:${pad(minutesOut)}:${pad(totalSeconds % 60)}${drop ? ';' : ':'}${pad(ffOut)}`;
}
