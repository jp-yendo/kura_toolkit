"""Voice conversion (RVC) with Applio, model sanitising, the final mix and the effects (pedalboard).

The worker is started with the Applio root as its working directory, because Applio resolves
its configuration and model files relative to the current directory.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, Tuple

from kura_voice import runtime
from kura_voice.protocol import Context, KuraError
# The silence handling requests are shared by every component (the worker looks up rpc_<method> in this module)
from kura_voice.silence import rpc_detect_silence, rpc_edit_silence  # noqa: F401
# The effects are shared by the components that have pedalboard
from kura_voice.effects import rpc_apply_effects  # noqa: F401

APPLIO_ROOT = os.getcwd()
if APPLIO_ROOT not in sys.path:
    sys.path.insert(0, APPLIO_ROOT)

SUPPORTED_VERSIONS = ("v1", "v2")
SUPPORTED_VOCODERS = ("HiFi-GAN", "MRF HiFi-GAN", "RefineGAN")

_converter: Any = None
_converter_device = ""


class UnsafeModel(Exception):
    """The checkpoint contains data that the restricted (weights only) loader refuses."""


_ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_UNSUPPORTED_GLOBAL = re.compile(r"Unsupported global: GLOBAL ([\w.]+)")


def _unsafe_reason(error: Exception) -> str:
    """A short reason for the import dialog.

    PyTorch's message is several paragraphs of advice for developers with terminal colour codes;
    the useful part is the object the file asks to load (for example ``builtins.exec``).
    """
    text = _ANSI_ESCAPE.sub("", str(error))
    names = sorted(set(_UNSUPPORTED_GLOBAL.findall(text)))
    if names:
        return f"{type(error).__name__}: Unsupported global: {', '.join(names)}"
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return f"{type(error).__name__}: {first_line}"


def _instance(device: str) -> Any:
    """Applio's converter on the device, made again when the device changes.

    Every converter reads the device from Applio's configuration, which is shared (a singleton),
    so only one converter is kept.
    """
    global _converter, _converter_device
    if _converter is not None:
        if _converter_device == device:
            return _converter
        unload()
    runtime.patch_faiss_unicode_paths()
    runtime.block_wget_downloads()
    runtime.patch_applio_model_paths()
    runtime.write_wav_as_float()
    from rvc.configs.config import Config
    from rvc.infer.infer import VoiceConverter

    class StoredModelConverter(VoiceConverter):  # type: ignore[misc, valid-type]
        """Applio's converter reading the app's stored model.

        Applio loads a model from a .pth file (torch.load). The app stores the weights as
        safetensors with the settings in JSON, and the same checkpoint is built from them in memory.
        """

        def load_model(self, weight_root: str) -> None:
            self.cpt = _stored_checkpoint(weight_root)

    # Applio itself only picks CUDA or the CPU; setting the device also covers MPS and the CPU retry.
    Config().device = device
    _converter = StoredModelConverter()
    _converter_device = device
    return _converter


# The conversion is done in chunks of about this length (seconds), cut at the quietest point near each boundary.
# Each chunk is converted with this much real audio before and after it (seconds), which is cut off again at exact
# sample positions, so the kept parts of the chunks follow each other without a gap (the joins are crossfaded, below).
#
# Applio's own splitting (pipeline() for long input) is not used: a chunk can come back one feature frame (10 ms)
# short, which drops the end of that chunk and moves everything after it 10 ms earlier. Here a short result only
# loses part of the context that is cut off anyway. Applio's scaling of the whole result when its peak exceeds 0.99
# is not done either (the app matches the loudness of the result to the input afterwards).
_CHUNK_SECONDS = 20
_CHUNK_CONTEXT_SECONDS = 1
_CHUNK_SEARCH_SECONDS = 2
# At each boundary the result passes from one chunk to the next over this length (seconds). Both chunks cover it
# (the previous one with its context), so the two renderings of the same audio are crossfaded instead of being
# butted together, which would leave a step in the waveform (a click).
_CHUNK_CROSSFADE_SECONDS = 0.02


def _chunk_bounds(audio: Any, sample_rate: int, window: int) -> list:
    """Chunks as (start, end) sample pairs, cut at the quietest frames near every _CHUNK_SECONDS.

    The cuts are multiples of the frame size; the last chunk ends at the end of the audio.
    """
    import numpy as np

    frames = len(audio) // window
    energy = np.square(audio[: frames * window].reshape(frames, window)).sum(axis=1)
    bounds = [0]
    step = _CHUNK_SECONDS * sample_rate // window
    search = _CHUNK_SEARCH_SECONDS * sample_rate // window
    target = step
    while target + search < frames:
        lo, hi = target - search, target + search
        cut = lo + int(np.argmin(energy[lo:hi]))
        bounds.append(cut * window)
        target = cut + step
    bounds.append(len(audio))
    return list(zip(bounds[:-1], bounds[1:]))


def _convert_chunk(vc: Any, models: dict, audio: Any, params: dict) -> Any:
    """Convert one chunk (16 kHz) the way Applio's pipeline() converts one segment, without rescaling the result."""
    import numpy as np
    import torch
    from rvc.infer.pipeline import AudioProcessor, ah, bh
    from scipy import signal

    audio = signal.filtfilt(bh, ah, audio)
    audio_pad = np.pad(audio, (vc.t_pad, vc.t_pad), mode="reflect")
    p_len = audio_pad.shape[0] // vc.window
    pitch = pitchf = None
    if models["pitchGuidance"]:
        pitch, pitchf = vc.get_f0(audio_pad, p_len, str(params["f0Method"]), int(params["pitch"]), False, 1.0, False, 155.0)
        pitch = torch.tensor(pitch[:p_len], device=vc.device).unsqueeze(0).long()
        pitchf = torch.tensor(np.asarray(pitchf[:p_len], dtype=np.float32), device=vc.device).unsqueeze(0).float()
    converted = vc.voice_conversion(
        models["hubert"], models["netG"], models["sid"], audio_pad, pitch, pitchf, models["index"], models["bigNpy"],
        float(params["indexRate"]), models["version"], float(params["protect"]),
    )[vc.t_pad_tgt : -vc.t_pad_tgt]
    volume_envelope = float(params["volumeEnvelope"])
    if volume_envelope != 1:
        converted = AudioProcessor.change_rms(audio, vc.sample_rate, converted, vc.tgt_sr, volume_envelope)
    return converted


def rpc_convert(params: dict, context: Context) -> dict:
    """Convert the voice in chunks and write the result as it is made (model's sampling rate, mono, 32-bit float)."""
    output = params["output"]
    index_path = params["index"]
    embedder = str(params["embedder"])
    context.progress(0.05, "load")

    def convert(device: str) -> None:
        import numpy as np
        import soundfile
        import torch
        from rvc.lib.utils import load_audio_infer

        context.phase("loadModel")

        converter = _instance(device)
        # The app always converts with the first speaker of the model
        converter.get_vc(params["model"], 0)
        if not converter.hubert_model or embedder != converter.last_embedder_model:
            converter.load_hubert(embedder, None)
            converter.last_embedder_model = embedder
        vc = converter.vc
        index = big_npy = None
        if index_path and os.path.exists(index_path) and float(params["indexRate"]) > 0:
            import faiss

            index = faiss.read_index(index_path)
            big_npy = index.reconstruct_n(0, index.ntotal)
        models = {
            "hubert": converter.hubert_model,
            "netG": converter.net_g,
            "sid": torch.tensor(0, device=vc.device).unsqueeze(0).long(),
            "index": index,
            "bigNpy": big_npy,
            "version": converter.version,
            "pitchGuidance": converter.use_f0,
        }
        audio = load_audio_infer(params["input"], vc.sample_rate)
        # As Applio does for the whole input: keep the input below full scale
        peak = np.abs(audio).max() / 0.95
        if peak > 1:
            audio = audio / peak
        ratio = vc.tgt_sr / vc.sample_rate
        context_samples = _CHUNK_CONTEXT_SECONDS * vc.sample_rate
        chunks = _chunk_bounds(audio, vc.sample_rate, vc.window)
        crossfade = max(1, round(_CHUNK_CROSSFADE_SECONDS * vc.tgt_sr))
        # The length of the input at the model's sampling rate. The input is read at 16 kHz, which rounds its length up
        # to whole 16 kHz samples, so the result can run past the end of the input; that part is not written
        source = soundfile.info(params["input"])
        total = round(source.frames * vc.tgt_sr / source.samplerate)
        written = 0
        # The previous chunk's result just after its end (overlaps the start of the next chunk)
        carry = None
        context.phase("convert", 0.0)
        with soundfile.SoundFile(output, "w", samplerate=vc.tgt_sr, channels=1, subtype="FLOAT") as out:
            for number, (start, end) in enumerate(chunks):
                begin = max(0, start - context_samples)
                piece = audio[begin : end + context_samples]
                # After the end of the input, silence stands in for the context
                missing = end + context_samples - min(len(audio), end + context_samples)
                if missing > 0:
                    piece = np.concatenate([piece, np.zeros(missing, dtype=piece.dtype)])
                converted = _convert_chunk(vc, models, piece, params)
                first = round((start - begin) * ratio)
                length = round(end * ratio) - round(start * ratio)
                kept = np.array(converted[first : first + length], dtype=np.float32)
                if len(kept) < length:
                    raise KuraError("CONVERSION_FAILED", f"chunk {number + 1}: {len(kept)} < {length} samples")
                if carry is not None:
                    count = min(len(carry), len(kept))
                    fade = np.linspace(0.0, 1.0, count, endpoint=False, dtype=np.float32)
                    kept[:count] = carry[:count] * (1.0 - fade) + kept[:count] * fade
                carry = np.asarray(converted[first + length : first + length + crossfade], dtype=np.float32)
                kept = kept[: max(0, total - written)]
                out.write(kept)
                written += len(kept)
                context.progress(0.05 + 0.95 * (number + 1) / len(chunks), "convert")
                context.phase("convert", (number + 1) / len(chunks))

    runtime.run_with_cpu_fallback(convert, unload)
    if not os.path.exists(output) or os.path.getsize(output) <= 44:
        raise KuraError("CONVERSION_FAILED")
    context.progress(1.0, "done")
    return {"path": output}


# --- model inspection and sanitising --------------------------------------------------


def _plain(value: Any) -> Any:
    """Only keep JSON compatible values (rejects anything executable or exotic)."""
    if isinstance(value, bool) or value is None or isinstance(value, (int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    raise KuraError("INVALID_RVC_MODEL", f"unsupported value type {type(value).__name__}")


def _load_checkpoint(path: str, allow_unsafe: bool) -> Tuple[Any, bool]:
    import torch

    try:
        # Restricted loading: tensors and a few basic types only, no module imports.
        return torch.load(path, map_location="cpu", weights_only=True), True
    except Exception as error:  # pickle.UnpicklingError / RuntimeError depending on torch
        if not allow_unsafe:
            raise UnsafeModel(_unsafe_reason(error)) from error
    # The user accepted the risk: the full pickle loader can run code contained in the file.
    return torch.load(path, map_location="cpu", weights_only=False), False


def _extract(checkpoint: Any) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    import torch

    if not isinstance(checkpoint, dict) or "weight" not in checkpoint or "config" not in checkpoint:
        raise KuraError("INVALID_RVC_MODEL", "weight / config not found")
    weights = checkpoint["weight"]
    if not isinstance(weights, dict) or not weights:
        raise KuraError("INVALID_RVC_MODEL", "weight is not a tensor dictionary")
    clean: Dict[str, Any] = {}
    for key, tensor in weights.items():
        if not isinstance(tensor, torch.Tensor):
            raise KuraError("INVALID_RVC_MODEL", f"weight {key} is not a tensor")
        clean[str(key)] = tensor.detach().cpu().contiguous()
    config = _plain(checkpoint["config"])
    if not isinstance(config, list) or not config:
        raise KuraError("INVALID_RVC_MODEL", "config is not a list")
    # Models made with other RVC tools may lack these settings (or store None as the embedder);
    # they get the defaults that Applio also uses for such models.
    version = str(checkpoint.get("version", "v1"))
    vocoder = str(checkpoint.get("vocoder", "HiFi-GAN"))
    embedder = checkpoint.get("embedder_model")
    if embedder is not None and not isinstance(embedder, str):
        raise KuraError("INVALID_RVC_MODEL", "embedder_model is not a string")
    embedder = embedder or "contentvec"
    if version not in SUPPORTED_VERSIONS:
        raise KuraError("RVC_VERSION_UNSUPPORTED", version)
    if vocoder not in SUPPORTED_VOCODERS:
        raise KuraError("RVC_VOCODER_UNSUPPORTED", vocoder)
    if embedder not in runtime.APPLIO_EMBEDDERS:
        raise KuraError("EMBEDDER_UNSUPPORTED", embedder)
    sample_rate = config[-1]
    if not isinstance(sample_rate, int):
        raise KuraError("INVALID_RVC_MODEL", "sample rate is not an integer")
    speakers = int(clean["emb_g.weight"].shape[0]) if "emb_g.weight" in clean else 1
    meta = {
        "config": config,
        "f0": int(bool(checkpoint.get("f0", 1))),
        "version": version,
        "vocoder": vocoder,
        "sr": sample_rate,
        "embedder_model": embedder,
        "speakers": speakers,
        "model_name": str(checkpoint.get("model_name") or ""),
    }
    return clean, meta


def _public(meta: Dict[str, Any]) -> dict:
    return {
        "version": meta["version"],
        "sampleRate": meta["sr"],
        "f0": bool(meta["f0"]),
        "vocoder": meta["vocoder"],
        "embedder": meta["embedder_model"],
        "speakers": meta["speakers"],
        "modelName": meta["model_name"],
    }


def _stored_checkpoint(weights_path: str) -> Dict[str, Any]:
    """The checkpoint Applio's converter uses, built from a stored model.

    ``weights_path`` is the model's model.safetensors; its settings are model.json in the same folder.
    """
    from safetensors.torch import load_file

    with open(os.path.join(os.path.dirname(weights_path), "model.json"), "r", encoding="utf-8") as handle:
        meta = _plain(json.load(handle))
    keys = ("config", "f0", "version", "vocoder", "sr", "embedder_model")
    missing = [key for key in keys if key not in meta]
    if missing:
        raise KuraError("INVALID_RVC_MODEL", f"{', '.join(missing)} missing")
    return {"weight": load_file(weights_path), **{key: meta[key] for key in keys}}


def rpc_inspect_model(params: dict, context: Context) -> dict:
    try:
        checkpoint, _safe = _load_checkpoint(params["path"], allow_unsafe=False)
    except UnsafeModel as error:
        return {"safe": False, "detail": str(error)}
    _weights, meta = _extract(checkpoint)
    return {"safe": True, "meta": _public(meta)}


def rpc_sanitize_model(params: dict, context: Context) -> dict:
    """Keep only the weights and settings, stored as safetensors + JSON."""
    from safetensors.torch import save_file

    out_dir = params["outDir"]
    os.makedirs(out_dir, exist_ok=True)
    try:
        checkpoint, safe = _load_checkpoint(params["path"], allow_unsafe=bool(params["allowUnsafe"]))
    except UnsafeModel as error:
        raise KuraError("UNSAFE_MODEL", str(error)) from error
    weights, meta = _extract(checkpoint)
    del checkpoint
    save_file(weights, os.path.join(out_dir, "model.safetensors"))
    with open(os.path.join(out_dir, "model.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False)
    return {"safe": safe, "meta": _public(meta)}


def rpc_export_model(params: dict, context: Context) -> dict:
    """Write a stored model as a standard RVC model file (.pth), as Applio writes a trained model.

    The file holds only the weights and the settings (tensors, numbers and strings), so it loads with the
    restricted loader as well, and RVC tools (Applio, RVC WebUI) read it as their own models.
    """
    import torch
    from safetensors.torch import load_file

    weights_path = params["weights"]
    with open(os.path.join(os.path.dirname(weights_path), "model.json"), "r", encoding="utf-8") as handle:
        meta = _plain(json.load(handle))
    sample_rate = int(meta["sr"])
    checkpoint = {
        "weight": load_file(weights_path),
        "config": meta["config"],
        # Written as RVC WebUI writes it ("40k" and so on)
        "sr": f"{sample_rate // 1000}k" if sample_rate % 1000 == 0 else str(sample_rate),
        "f0": int(meta["f0"]),
        "version": meta["version"],
        "vocoder": meta["vocoder"],
        "embedder_model": meta["embedder_model"],
        "model_name": str(params.get("name") or meta.get("model_name") or ""),
    }
    torch.save(checkpoint, params["output"])
    return {"path": params["output"]}


# --- final mix ------------------------------------------------------------------------


# Length of one block when mixing (seconds). The audio is read, processed and written block by block, so only
# one block of each input is held in memory regardless of the length of the song.
_MIX_BLOCK_SECONDS = 10

# Upper limit of the sample peak of the mix (dBFS). When the mix goes over it, the whole mix is lowered by one
# constant gain, so the balance between quiet and loud parts is kept.
_MIX_PEAK_LIMIT_DB = -1.0

def _stereo(block: Any) -> Any:
    import numpy as np

    if block.shape[0] == 1:
        block = np.vstack([block, block])
    return block[:2].astype(np.float32)


def rpc_mix(params: dict, context: Context) -> dict:
    """Vocal / accompaniment balance and the master volume.

    The mix shown in the app and the export use this same rendering, so they always sound the same. The vocals
    layered on the accompaniment on the conversion step use it too, with the volumes unchanged. A reverb on the
    vocals is an effect of the candidate (applied before the mix), not of the mix. The vocals may be mono or stereo.
    Processed block by block; the gains keep their state between blocks (reset=False), so the result is the
    same as processing the whole audio at once. When the peak of the mix goes over _MIX_PEAK_LIMIT_DB, the
    written file is lowered by one constant gain in a second pass.
    """
    import os

    import numpy as np
    from pedalboard import Gain, Pedalboard
    from pedalboard.io import AudioFile

    sample_rate = int(params["sampleRate"])
    settings = params["params"]
    vocal_board = Pedalboard([Gain(gain_db=float(settings["vocalGainDb"]))])
    accompaniment_board = Pedalboard([Gain(gain_db=float(settings["accompanimentGainDb"]))])
    master_board = Pedalboard([Gain(gain_db=float(settings["masterGainDb"]))])
    channels = 1 if int(params["channels"]) == 1 else 2
    block = _MIX_BLOCK_SECONDS * sample_rate

    vocals = AudioFile(params["vocals"]).resampled_to(sample_rate)
    accompaniment = (
        AudioFile(params["accompaniment"]).resampled_to(sample_rate) if params["accompaniment"] else None
    )
    try:
        total = max(vocals.frames, accompaniment.frames if accompaniment else 0)
        output = params["output"]
        peak = 0.0
        with AudioFile(output, "w", samplerate=sample_rate, num_channels=channels, bit_depth=32) as handle:
            done = 0
            while done < total:
                size = min(block, total - done)
                mix = np.zeros((2, size), dtype=np.float32)
                # When the lengths differ, the shorter input is silent after it ends.
                if vocals.tell() < vocals.frames:
                    part = _stereo(vocals.read(min(size, vocals.frames - vocals.tell())))
                    mix[:, : part.shape[1]] += vocal_board(part, sample_rate, reset=False)
                if accompaniment and accompaniment.tell() < accompaniment.frames:
                    part = _stereo(accompaniment.read(min(size, accompaniment.frames - accompaniment.tell())))
                    mix[:, : part.shape[1]] += accompaniment_board(part, sample_rate, reset=False)
                mix = master_board(mix, sample_rate, reset=False)
                if channels == 1:
                    mix = mix.mean(axis=0, keepdims=True)
                if mix.size:
                    peak = max(peak, float(np.max(np.abs(mix))))
                handle.write(mix.astype(np.float32))
                done += size
                # The first pass is 0-0.8 of the phase, the second pass (only when lowering) 0.8-1
                context.progress(0.8 * done / total, "mix")
                context.phase("mix", 0.8 * done / total)
    finally:
        vocals.close()
        if accompaniment:
            accompaniment.close()

    limit = 10 ** (_MIX_PEAK_LIMIT_DB / 20)
    gain_db = 0.0
    if peak > limit:
        scale = limit / peak
        gain_db = float(20 * np.log10(scale))
        # Same directory and extension as the output, so the format is the same and the replace stays on one drive
        scaled = os.path.join(os.path.dirname(output), ".scaled-" + os.path.basename(output))
        try:
            with AudioFile(output) as source, AudioFile(
                scaled, "w", samplerate=sample_rate, num_channels=channels, bit_depth=32
            ) as handle:
                while source.tell() < source.frames:
                    handle.write((source.read(min(block, source.frames - source.tell())) * scale).astype(np.float32))
                    context.progress(0.8 + 0.2 * source.tell() / max(1, source.frames), "mix")
                    context.phase("mix", 0.8 + 0.2 * source.tell() / max(1, source.frames))
            os.replace(scaled, output)
        finally:
            if os.path.exists(scaled):
                os.remove(scaled)
    context.phase("mix", 1.0)
    return {"path": output, "gainDb": gain_db}


def unload() -> None:
    global _converter, _converter_device
    _converter = None
    _converter_device = ""
    runtime.release_memory()
