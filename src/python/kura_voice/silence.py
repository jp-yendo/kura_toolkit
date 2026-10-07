"""Silence handling shared by the components (conversion, separation, the training audio filter and the check
before training).

Silence is where the level stays below threshold_db (relative to the peak of the whole audio) for at least
min_seconds. The level is the RMS over 20 ms, measured every 10 ms. Silent parts are either muted (the length
stays the same) or removed. Both fade over 10 ms at the edges of a silent part, inside the part, so the sound
around it is never changed and no click is made.

Files are read block by block (rpc_edit_silence reads twice: once to find the silence, once to write), so long
audio is never held in memory as a whole.
"""

from __future__ import annotations

from typing import Any, List, Tuple

_HOP_SECONDS = 0.01
_FADE_SECONDS = 0.01
_BLOCK_SECONDS = 10


def silent_runs(
    hop_energy: Any, peak: float, hop: int, count: int, threshold_db: float, min_seconds: float
) -> List[Tuple[int, int]]:
    """Silent parts as (first sample, end sample) from the energy of every hop (sum of squares of its samples)."""
    import numpy as np

    frames = len(hop_energy)
    min_hops = max(1, int(round(float(min_seconds) / _HOP_SECONDS)))
    if frames == 0:
        return []
    # All samples are 0: the whole file is silent
    if peak <= 0:
        return [(0, count)] if frames >= min_hops else []
    energy = np.asarray(hop_energy, dtype=np.float64)
    # The RMS over two hops (20 ms) starting at each hop
    window = energy + np.append(energy[1:], energy[-1])
    rms = np.sqrt(window / (2 * hop))
    silent = 20 * np.log10(np.maximum(rms, 1e-12) / peak) < float(threshold_db)
    runs: List[Tuple[int, int]] = []
    index = 0
    while index < frames:
        if not silent[index]:
            index += 1
            continue
        end = index
        while end < frames and silent[end]:
            end += 1
        # The windows index .. end - 1 are silent; the last one also covers the hop after it
        last_hop = min(end + 1, frames)
        if last_hop - index >= min_hops:
            runs.append((index * hop, min(count, last_hop * hop)))
        index = end
    return runs


def block_gain(start: int, length: int, runs: List[Tuple[int, int]], fade: int) -> Any:
    """Gain (1 = keep, 0 = silent) for the samples start .. start + length. Fades inside each silent part."""
    import numpy as np

    gain = np.ones(length, dtype=np.float32)
    stop = start + length
    for begin, end in runs:
        if end <= start or begin >= stop:
            continue
        size = end - begin
        ramp = min(fade, size // 2)
        first = max(begin, start)
        last = min(end, stop)
        # Only the part inside this block (a long silent part is never held as a whole)
        position = np.arange(first - begin, last - begin)
        part = np.zeros(len(position), dtype=np.float32)
        if ramp > 0:
            head = position < ramp
            part[head] = 1.0 - position[head] / ramp
            tail = position >= size - ramp
            part[tail] = (position[tail] - (size - ramp) + 1) / ramp
        gain[first - start : last - start] = part
    return gain


def mono_runs(mono: Any, sample_rate: int, threshold_db: float, min_seconds: float) -> List[Tuple[int, int]]:
    """Silent parts of a mono signal that is in memory already (the input of a conversion)."""
    import numpy as np

    mono = np.asarray(mono, dtype=np.float32)
    hop = max(1, int(round(sample_rate * _HOP_SECONDS)))
    usable = len(mono) // hop * hop
    energy = (mono[:usable].astype(np.float64) ** 2).reshape(-1, hop).sum(axis=1)
    peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
    return silent_runs(energy, peak, hop, len(mono), threshold_db, min_seconds)


def file_runs(path: str, threshold_db: float, min_seconds: float, progress: Any = None) -> Tuple[List[Tuple[int, int]], int]:
    """Silent parts of a file (left and right are averaged) and its sample rate."""
    import numpy as np
    import soundfile

    with soundfile.SoundFile(path) as source:
        sample_rate = source.samplerate
        count = source.frames
        hop = max(1, int(round(sample_rate * _HOP_SECONDS)))
        block = hop * int(_BLOCK_SECONDS / _HOP_SECONDS)
        energies = []
        peak = 0.0
        done = 0
        while done < count:
            data = source.read(min(block, count - done), dtype="float32", always_2d=True)
            if len(data) == 0:
                break
            mono = data.mean(axis=1)
            peak = max(peak, float(np.max(np.abs(mono))))
            padded = np.zeros(-(-len(mono) // hop) * hop, dtype=np.float64)
            padded[: len(mono)] = mono
            energies.append((padded**2).reshape(-1, hop).sum(axis=1))
            done += len(data)
            if progress:
                progress(done / max(1, count))
    energy = np.concatenate(energies) if energies else np.zeros(0)
    return silent_runs(energy, peak, hop, count, threshold_db, min_seconds), sample_rate


def rpc_edit_silence(params: dict, context: Any) -> dict:
    """Mute (mode "mute") or remove (mode "remove") the silent parts of a file. Written as 32-bit float WAV."""
    import soundfile

    remove = params["mode"] == "remove"
    context.phase("silence", 0.0)
    runs, sample_rate = file_runs(
        params["input"],
        float(params["thresholdDb"]),
        float(params["minSeconds"]),
        lambda fraction: context.phase("silence", 0.5 * fraction),
    )
    fade = max(1, int(round(sample_rate * _FADE_SECONDS)))
    written = 0
    with soundfile.SoundFile(params["input"]) as source, soundfile.SoundFile(
        params["output"], "w", samplerate=sample_rate, channels=source.channels, subtype="FLOAT"
    ) as output:
        count = source.frames
        block = sample_rate * _BLOCK_SECONDS
        done = 0
        while done < count:
            data = source.read(min(block, count - done), dtype="float32", always_2d=True)
            if len(data) == 0:
                break
            gain = block_gain(done, len(data), runs, fade)
            if remove:
                keep = gain > 0
                data = data[keep] * gain[keep][:, None]
            else:
                data = data * gain[:, None]
            output.write(data)
            written += len(data)
            done += len(gain)
            context.phase("silence", 0.5 + 0.5 * done / max(1, count))
    return {"durationSec": written / sample_rate}


def rpc_detect_silence(params: dict, context: Any) -> dict:
    """Total length of the silent parts (seconds) of each file, for the check before training."""
    paths = list(params["paths"])
    results = []
    for number, path in enumerate(paths):
        runs, sample_rate = file_runs(path, float(params["thresholdDb"]), float(params["minSeconds"]))
        results.append({"path": path, "silenceSec": sum(end - begin for begin, end in runs) / sample_rate})
        context.phase("silence", (number + 1) / max(1, len(paths)))
    return {"files": results}
