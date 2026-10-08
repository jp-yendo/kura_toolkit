"""Effects that add to the sound (EQ, compressor, chorus, delay, reverb) with pedalboard.

Shared by the components that have pedalboard (separator and converter): the worker looks up rpc_<method> in the
component's module, which imports these requests. The de-esser runs in ffmpeg (main process) between the
compressor and the chorus, so the chain may be requested in two parts.

The file is processed block by block; the effects keep their state between blocks (reset=False), so the result is
the same as processing the whole audio at once. The length does not change: the tail of a delay or reverb that
would ring past the end is cut, with a short fade-out at the end so that the cut does not click.
"""

from __future__ import annotations

from typing import Any, List

from kura_voice.protocol import Context

# The bands of the graphic EQ (the usual 10 bands of music players)
EQ_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
# About one octave per band (a graphic EQ's bands meet their neighbours)
_EQ_Q = 1.41
# pedalboard's Reverb (JUCE) multiplies the dry level by 2 and the wet level by 3 inside; the levels given by the
# app are the actual volume ratios (dry 1 keeps the original level), so they are divided by these
REVERB_DRY_SCALE = 2.0
REVERB_WET_SCALE = 3.0
_BLOCK_SECONDS = 10


def _plugins(effects: List[dict]) -> List[Any]:
    from pedalboard import Chorus, Compressor, Delay, HighpassFilter, PeakFilter, Reverb

    plugins: List[Any] = []
    for effect in effects:
        kind = effect["kind"]
        if kind == "eq":
            if float(effect["lowCutHz"]) > 0:
                plugins.append(HighpassFilter(cutoff_frequency_hz=float(effect["lowCutHz"])))
            for frequency, gain in zip(EQ_BANDS_HZ, effect["gainsDb"]):
                if float(gain) != 0:
                    plugins.append(PeakFilter(cutoff_frequency_hz=float(frequency), gain_db=float(gain), q=_EQ_Q))
        elif kind == "compressor":
            plugins.append(
                Compressor(
                    threshold_db=float(effect["thresholdDb"]),
                    ratio=float(effect["ratio"]),
                    attack_ms=float(effect["attackMs"]),
                    release_ms=float(effect["releaseMs"]),
                )
            )
        elif kind == "chorus":
            plugins.append(
                Chorus(
                    rate_hz=float(effect["rateHz"]),
                    depth=float(effect["depth"]),
                    centre_delay_ms=float(effect["centreDelayMs"]),
                    feedback=float(effect["feedback"]),
                    mix=float(effect["mix"]),
                )
            )
        elif kind == "delay":
            plugins.append(
                Delay(
                    delay_seconds=float(effect["delaySeconds"]),
                    feedback=float(effect["feedback"]),
                    mix=float(effect["mix"]),
                )
            )
        elif kind == "reverb":
            plugins.append(
                Reverb(
                    room_size=float(effect["roomSize"]),
                    damping=float(effect["damping"]),
                    wet_level=float(effect["wetLevel"]) / REVERB_WET_SCALE,
                    dry_level=float(effect["dryLevel"]) / REVERB_DRY_SCALE,
                    width=float(effect["width"]),
                    freeze_mode=0.0,
                )
            )
        else:
            raise ValueError(f"unknown effect: {kind}")
    return plugins


def rpc_apply_effects(params: dict, context: Context) -> dict:
    """Apply ``effects`` (in order) to ``input`` and write ``output`` (32-bit float WAV, same length).

    ``channels`` (optional) makes the output mono or stereo (a mono input is made stereo by copying it, so that a
    reverb or chorus can spread). ``fadeSeconds`` fades out the end (used when an effect leaves a tail).
    """
    import numpy as np
    from pedalboard import Pedalboard
    from pedalboard.io import AudioFile

    board = Pedalboard(_plugins(params["effects"]))
    with AudioFile(params["input"]) as source:
        sample_rate = int(source.samplerate)
        frames = int(source.frames)
        channels = int(params.get("channels") or min(2, source.num_channels))
        block = _BLOCK_SECONDS * sample_rate
        fade_frames = min(frames, int(round(float(params.get("fadeSeconds") or 0) * sample_rate)))
        context.phase("effects", 0.0)
        with AudioFile(params["output"], "w", samplerate=sample_rate, num_channels=channels, bit_depth=32) as output:
            done = 0
            while done < frames:
                part = source.read(min(block, frames - done)).astype(np.float32)
                if part.shape[1] == 0:
                    break
                if channels == 2 and part.shape[0] == 1:
                    part = np.vstack([part, part])
                elif channels == 1 and part.shape[0] > 1:
                    part = part.mean(axis=0, keepdims=True)
                elif part.shape[0] > 2:
                    part = part[:2]
                processed = board(part, sample_rate, reset=False)
                if fade_frames:
                    positions = np.arange(done, done + processed.shape[1])
                    processed = processed * np.minimum(1.0, (frames - positions) / fade_frames).astype(np.float32)
                output.write(processed.astype(np.float32))
                done += part.shape[1]
                context.progress(done / frames if frames else 1.0)
                context.phase("effects", done / frames if frames else 1.0)
    return {"output": params["output"]}
