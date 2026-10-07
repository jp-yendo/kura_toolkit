import React from 'react';
import { parseError } from '../common/errorMessage';
import { currentInputGainFactor, openMicrophone } from './microphones';

// マイク録音。学習用の音声を録るため、ブラウザ側のエコーキャンセル・ノイズ抑制・自動ゲイン調整を無効にし、
// 圧縮せずに PCM のまま受け取って 16bit の WAV にする (MediaRecorder は Opus などに圧縮してしまうため使わない)。
// 録音した音声は 16bit の PCM にして 1 秒分ずつ main へ送り、main が作業ディレクトリの WAV へ追記する
// (録音全体を画面のメモリに持たないため。録音の長さに上限は設けない)。

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

// 入力レベル・経過時間の表示を更新する間隔 (ミリ秒)
const TICK_MS = 100;
// main へまとめて送る長さ (秒)。送る回数を抑えつつ、画面に溜める量は 1 秒分にとどめる
const WRITE_SECONDS = 1;

type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';

export type RecordedAudio = {
    // main が書き終えた録音 (trainingSets.addRecording に渡す)
    recordingId: string;
    durationSec: number;
};

type RecorderOptions = {
    // 書き込みに失敗して録音を途中でやめたとき
    onAbort?(): void;
};

// -1〜1 の音声に入力ゲインの倍率 (gain) をかけて、16bit の PCM (リトルエンディアン) にする。16bit にする前にかけるため、
// 小さい音を 16bit にしてから大きくするより細かさを失わない。最大を超えた分は最大に収める (音割れ)
function toPcm16(samples: Float32Array, gain: number): Int16Array {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i] * gain));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return pcm;
}

type Session = {
    context: AudioContext;
    stream: MediaStream;
    node: AudioWorkletNode;
    timer: number;
    recordingId: string;
    // まだ main へ送っていない分
    pending: Int16Array[];
    pendingSamples: number;
    samples: number;
    // main への書き込みの順番待ち (前の書き込みが終わってから次を送る)
    writes: Promise<void>;
    failure: unknown;
};

export function useRecorder(options: RecorderOptions = {}) {
    const [state, setState] = React.useState<RecorderState>('idle');
    const [level, setLevel] = React.useState(0);
    const [elapsed, setElapsed] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const session = React.useRef<Session | null>(null);
    const starting = React.useRef(false);
    const onAbort = React.useRef(options.onAbort);
    onAbort.current = options.onAbort;

    // マイクと音声処理を閉じる (録音のファイルは閉じない)
    const closeInput = React.useCallback((current: Session) => {
        window.clearInterval(current.timer);
        current.node.port.onmessage = null;
        current.node.disconnect();
        current.stream.getTracks().forEach(track => track.stop());
        void current.context.close();
    }, []);

    // 送っていない分を main へ送る
    const flush = React.useCallback((current: Session) => {
        if (current.pending.length === 0) return;
        const length = current.pending.reduce((sum, chunk) => sum + chunk.length, 0);
        const pcm = new Int16Array(length);
        let offset = 0;
        for (const chunk of current.pending) {
            pcm.set(chunk, offset);
            offset += chunk.length;
        }
        current.pending = [];
        current.pendingSamples = 0;
        const bytes = new Uint8Array(pcm.buffer);
        current.writes = current.writes.then(async () => {
            if (current.failure) return;
            try {
                await window.kuraToolkit.voice.recording.append(current.recordingId, bytes);
            } catch (caught) {
                current.failure = caught;
            }
        });
    }, []);

    // 録音をやめて、書いたファイルも片付ける
    const abandon = React.useCallback(
        (current: Session) => {
            closeInput(current);
            const id = current.recordingId;
            void current.writes.then(() => window.kuraToolkit.voice.recording.discard(id)).catch(() => undefined);
        },
        [closeInput]
    );

    // 画面を離れた後に許可の確認などの待ちが終わった場合に、マイクを開いたままにしないための印
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            const current = session.current;
            session.current = null;
            if (current) abandon(current);
        };
    }, [abandon]);

    // 録音を始める (start から呼ぶ)
    const startSession = React.useCallback(async (): Promise<boolean> => {
        setError(null);
        setState('starting');
        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;
        let recordingId: string | null = null;
        // 録音を始める前に失敗したり画面を離れたりした場合に、開いたマイクと音声処理、録音のファイルを閉じる
        const discard = () => {
            stream?.getTracks().forEach(track => track.stop());
            void context?.close();
            if (recordingId) void window.kuraToolkit.voice.recording.discard(recordingId).catch(() => undefined);
        };
        try {
            stream = await openMicrophone();
            if (!mounted.current) {
                discard();
                return false;
            }
            context = new AudioContext();
            const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
            try {
                await context.audioWorklet.addModule(moduleUrl);
            } finally {
                URL.revokeObjectURL(moduleUrl);
            }
            recordingId = await window.kuraToolkit.voice.recording.begin(context.sampleRate);
            if (!mounted.current) {
                discard();
                return false;
            }
            const sourceNode = context.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(context, 'kura-recorder');
            const current: Session = {
                context,
                stream,
                node,
                timer: 0,
                recordingId,
                pending: [],
                pendingSamples: 0,
                samples: 0,
                writes: Promise.resolve(),
                failure: null,
            };
            // 入力ゲイン (アプリの設定。録音を始めた時点の値を、録音の終わりまで使う)
            const gain = currentInputGainFactor();
            // 入力レベル (ピーク。入力ゲインをかけた後) をメーター表示に使う。音声の塊は 1 秒に数百回届くため、
            // 画面への反映と main への書き込み (1 秒分たまったとき) は下のタイマーでまとめて行う
            let peakSinceTick = 0;
            node.port.onmessage = (event: MessageEvent<Float32Array>) => {
                current.pending.push(toPcm16(event.data, gain));
                current.pendingSamples += event.data.length;
                current.samples += event.data.length;
                for (let i = 0; i < event.data.length; i++) {
                    peakSinceTick = Math.max(peakSinceTick, Math.min(1, Math.abs(event.data[i] * gain)));
                }
            };
            sourceNode.connect(node);
            // 処理を動かし続けるために出力へつなぐ (無音を出すだけでスピーカーからは鳴らさない)
            const mute = context.createGain();
            mute.gain.value = 0;
            node.connect(mute).connect(context.destination);
            const startedAt = performance.now();
            current.timer = window.setInterval(() => {
                // 書き込みに失敗した (ディスクの空きが無いなど) 場合は、その時点で録音をやめる
                if (current.failure) {
                    if (session.current === current) {
                        session.current = null;
                        setError(parseError(current.failure).raw);
                        setState('idle');
                        setLevel(0);
                        abandon(current);
                        onAbort.current?.();
                    }
                    return;
                }
                if (current.pendingSamples >= current.context.sampleRate * WRITE_SECONDS) flush(current);
                setElapsed((performance.now() - startedAt) / 1000);
                const peak = peakSinceTick;
                peakSinceTick = 0;
                setLevel(previous => Math.max(peak, previous * 0.6));
            }, TICK_MS);
            session.current = current;
            setElapsed(0);
            setState('recording');
            return true;
        } catch (caught) {
            discard();
            if (mounted.current) {
                setState('idle');
                setError(parseError(caught).raw);
            }
            return false;
        }
    }, [abandon, flush]);

    // 録音を始める。始められたら true。始めている途中 (マイクを開くまで) にもう一度呼ばれても、2 つ目を始めない
    const start = React.useCallback(async (): Promise<boolean> => {
        if (session.current || starting.current) return false;
        starting.current = true;
        try {
            return await startSession();
        } finally {
            starting.current = false;
        }
    }, [startSession]);

    // 録音を終え、main が書き終えた録音を返す。録音していない・何も録れていなければ null。
    // 書き込みに失敗した場合は失敗を返す
    const stop = React.useCallback(async (): Promise<RecordedAudio | null> => {
        const current = session.current;
        if (!current) return null;
        session.current = null;
        setState('stopping');
        setLevel(0);
        closeInput(current);
        flush(current);
        try {
            await current.writes;
            if (current.failure) throw current.failure;
            if (current.samples === 0) {
                await window.kuraToolkit.voice.recording.discard(current.recordingId);
                return null;
            }
            await window.kuraToolkit.voice.recording.finish(current.recordingId);
            return { recordingId: current.recordingId, durationSec: current.samples / current.context.sampleRate };
        } catch (caught) {
            void window.kuraToolkit.voice.recording.discard(current.recordingId).catch(() => undefined);
            if (mounted.current) setError(parseError(caught).raw);
            return null;
        } finally {
            if (mounted.current) setState('idle');
        }
    }, [closeInput, flush]);

    // 録音をやめて捨てる (録音しなかったことにする。録音のファイルも消す)
    const cancel = React.useCallback(() => {
        const current = session.current;
        if (!current) return;
        session.current = null;
        setLevel(0);
        abandon(current);
        setState('idle');
    }, [abandon]);

    return { state, level, elapsed, error, start, stop, cancel };
}
