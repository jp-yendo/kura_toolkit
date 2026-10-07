import React from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { MIC_INPUT_GAIN_DB } from '@shared/types';

// 録音に使うマイク (アプリの設定の voice.microphoneId)。空文字は OS の既定のマイクを表す。
// 設定したマイクが今つながっていない場合は、録音でも設定画面でも OS の既定のマイクとして扱う (設定の値は書き換えない
// ため、つなぎ直せばそのマイクに戻る)

export type Microphone = { deviceId: string; label: string };

// OS の既定のマイク
export const DEFAULT_MICROPHONE = '';

// つながっているマイク。Chromium が加える「既定」「通信」の項目 (OS の既定のマイクの別名) は除く
// (OS の既定のマイクは DEFAULT_MICROPHONE で選ぶため)
export async function listMicrophones(): Promise<Microphone[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
        .filter(
            device =>
                device.kind === 'audioinput' &&
                device.deviceId !== '' &&
                device.deviceId !== 'default' &&
                device.deviceId !== 'communications'
        )
        .map(device => ({ deviceId: device.deviceId, label: device.label }));
}

// 設定のマイクを、今つながっているマイクに当てはめる (つながっていなければ OS の既定のマイク)
export function resolveMicrophone(deviceId: string, microphones: Microphone[]): string {
    return deviceId !== DEFAULT_MICROPHONE && microphones.some(item => item.deviceId === deviceId)
        ? deviceId
        : DEFAULT_MICROPHONE;
}

// つながっているマイクの一覧 (抜き差しで読み直す)。読み終えるまでは null
export function useMicrophones(): Microphone[] | null {
    const [microphones, setMicrophones] = React.useState<Microphone[] | null>(null);
    React.useEffect(() => {
        let cancelled = false;
        const load = () => {
            listMicrophones()
                .then(items => {
                    if (!cancelled) setMicrophones(items);
                })
                .catch(() => {
                    if (!cancelled) setMicrophones([]);
                });
        };
        load();
        navigator.mediaDevices.addEventListener('devicechange', load);
        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener('devicechange', load);
        };
    }, []);
    return microphones;
}

// 録音のマイクを開く。アプリの設定のマイクを使い、つながっていなければ OS の既定のマイクを使う (開く直前に
// 外された場合も、OS の既定のマイクで開き直す)。エコーキャンセル・ノイズ抑制・自動ゲイン調整は無効にする
export async function openMicrophone(): Promise<MediaStream> {
    const base: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
    };
    const configured = useSettingsStore.getState().settings?.voice.microphoneId ?? DEFAULT_MICROPHONE;
    // マイクの一覧を得られない場合は、OS の既定のマイクで録音する
    const microphones = configured ? await listMicrophones().catch(() => []) : [];
    const deviceId = configured ? resolveMicrophone(configured, microphones) : DEFAULT_MICROPHONE;
    if (!deviceId) return navigator.mediaDevices.getUserMedia({ audio: base });
    try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } });
    } catch (error) {
        const name = (error as DOMException | null)?.name;
        if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw error;
        return navigator.mediaDevices.getUserMedia({ audio: base });
    }
}

// 設定の入力ゲイン (dB。範囲外は範囲に収める)
export function inputGainDbOf(value: unknown): number {
    const db = typeof value === 'number' && Number.isFinite(value) ? value : MIC_INPUT_GAIN_DB.default;
    return Math.min(MIC_INPUT_GAIN_DB.max, Math.max(MIC_INPUT_GAIN_DB.min, db));
}

// 入力ゲイン (dB) を倍率にする
export function inputGainFactor(db: number): number {
    return 10 ** (inputGainDbOf(db) / 20);
}

// 今の設定の入力ゲインの倍率
export function currentInputGainFactor(): number {
    return inputGainFactor(inputGainDbOf(useSettingsStore.getState().settings?.voice.inputGainDb));
}

// 表示を更新する間隔 (ミリ秒)
const TEST_TICK_MS = 100;

// マイクテスト: active の間、設定のマイクを開いて入力レベル (ピーク。入力ゲイン gainDb をかけた後) を返す。
// 録音はしない。止めたとき・画面を離れたときはマイクを閉じる。マイクの設定が変わったら開き直す
export function useMicrophoneTest(active: boolean, microphoneId: string, gainDb: number) {
    const [level, setLevel] = React.useState(0);
    const [error, setError] = React.useState<unknown>(null);
    const gain = React.useRef(inputGainFactor(gainDb));
    gain.current = inputGainFactor(gainDb);
    React.useEffect(() => {
        if (!active) {
            setLevel(0);
            // 止めたら前のエラーを消す (表示の言語を変えたときなどに、同じエラーをもう一度知らせないため)
            setError(null);
            return;
        }
        let stopped = false;
        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;
        let timer = 0;
        setError(null);
        (async () => {
            try {
                // macOS ではマイクの利用を OS に許可してもらう必要がある
                if (!(await window.kuraToolkit.voice.requestMicrophone())) throw new Error('MICROPHONE_DENIED');
                const opened = await openMicrophone();
                // 開いている間に止めた場合は、すぐに閉じる
                if (stopped) {
                    opened.getTracks().forEach(track => track.stop());
                    return;
                }
                stream = opened;
                context = new AudioContext();
                const analyser = context.createAnalyser();
                // 表示の間隔 (100 ms) より長い分を読み、間のピークを取りこぼさない
                analyser.fftSize = 8192;
                context.createMediaStreamSource(stream).connect(analyser);
                const samples = new Float32Array(analyser.fftSize);
                timer = window.setInterval(() => {
                    analyser.getFloatTimeDomainData(samples);
                    let peak = 0;
                    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
                    const scaled = Math.min(1, peak * gain.current);
                    setLevel(previous => Math.max(scaled, previous * 0.6));
                }, TEST_TICK_MS);
            } catch (caught) {
                if (!stopped) setError(caught);
            }
        })();
        return () => {
            stopped = true;
            window.clearInterval(timer);
            stream?.getTracks().forEach(track => track.stop());
            void context?.close();
            setLevel(0);
        };
    }, [active, microphoneId]);
    return { level, error };
}
