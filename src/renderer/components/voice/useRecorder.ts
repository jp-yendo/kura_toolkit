import React from 'react';

// マイク録音。学習用の音声を録るため、ブラウザ側のエコーキャンセル・ノイズ抑制・自動ゲイン調整を無効にし、
// 圧縮せずに PCM のまま受け取って 16bit の WAV にする (MediaRecorder は Opus などに圧縮してしまうため使わない)。

const WORKLET_SOURCE = `
class KuraRecorderProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
            // 1ch 目だけを送る (学習は 1ch で行うため)
            this.port.postMessage(input[0].slice(0));
        }
        return true;
    }
}
registerProcessor('kura-recorder', KuraRecorderProcessor);
`;

type RecorderState = 'idle' | 'starting' | 'recording';

export type RecordedAudio = {
    // 16bit PCM の WAV
    wav: Uint8Array;
    durationSec: number;
};

function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    let offset = 44;
    for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
            const sample = Math.max(-1, Math.min(1, chunk[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Uint8Array(buffer);
}

export function useRecorder() {
    const [state, setState] = React.useState<RecorderState>('idle');
    const [level, setLevel] = React.useState(0);
    const [elapsed, setElapsed] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const session = React.useRef<{
        context: AudioContext;
        stream: MediaStream;
        node: AudioWorkletNode;
        chunks: Float32Array[];
        timer: number;
    } | null>(null);

    const release = React.useCallback(() => {
        const current = session.current;
        if (!current) return;
        session.current = null;
        window.clearInterval(current.timer);
        current.node.port.onmessage = null;
        current.node.disconnect();
        current.stream.getTracks().forEach(track => track.stop());
        void current.context.close();
    }, []);

    React.useEffect(() => release, [release]);

    const start = React.useCallback(async () => {
        if (session.current) return;
        setError(null);
        setState('starting');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 1,
                },
            });
            const context = new AudioContext();
            const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
            try {
                await context.audioWorklet.addModule(moduleUrl);
            } finally {
                URL.revokeObjectURL(moduleUrl);
            }
            const sourceNode = context.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(context, 'kura-recorder');
            const chunks: Float32Array[] = [];
            // 入力レベル (ピーク) をメーター表示に使う。音声の塊は 1 秒に数百回届くため、
            // 画面への反映は下のタイマー (0.1 秒ごと) でまとめて行う
            let peakSinceTick = 0;
            node.port.onmessage = (event: MessageEvent<Float32Array>) => {
                chunks.push(event.data);
                for (let i = 0; i < event.data.length; i++) {
                    peakSinceTick = Math.max(peakSinceTick, Math.abs(event.data[i]));
                }
            };
            sourceNode.connect(node);
            // 処理を動かし続けるために出力へつなぐ (無音を出すだけでスピーカーからは鳴らさない)
            const mute = context.createGain();
            mute.gain.value = 0;
            node.connect(mute).connect(context.destination);
            const startedAt = performance.now();
            const timer = window.setInterval(() => {
                setElapsed((performance.now() - startedAt) / 1000);
                const peak = peakSinceTick;
                peakSinceTick = 0;
                setLevel(previous => Math.max(peak, previous * 0.6));
            }, 100);
            session.current = { context, stream, node, chunks, timer };
            setElapsed(0);
            setState('recording');
        } catch (caught) {
            release();
            setState('idle');
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    }, [release]);

    // 録音を終えて WAV を返す。録音していなければ null
    const stop = React.useCallback((): RecordedAudio | null => {
        const current = session.current;
        if (!current) return null;
        const sampleRate = current.context.sampleRate;
        const chunks = current.chunks;
        release();
        setState('idle');
        setLevel(0);
        const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (samples === 0) return null;
        return { wav: encodeWav(chunks, sampleRate), durationSec: samples / sampleRate };
    }, [release]);

    return { state, level, elapsed, error, start, stop };
}
