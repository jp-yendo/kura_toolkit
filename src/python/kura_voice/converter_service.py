"""Voice conversion (RVC) with Applio, model sanitising and the final mix (pedalboard).

The worker is started with the Applio root as its working directory, because Applio resolves
its configuration and model files relative to the current directory.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from typing import Any, Dict, Tuple

from kura_voice import runtime
from kura_voice.protocol import Context, KuraError

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
    return f"{type(error).__name__}: {first_line}"[:500]


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


def rpc_convert(params: dict, context: Context) -> dict:
    output = params["output"]
    index = params["index"]
    # Applio rewrites "trained" to "added" anywhere in the index path; avoid such paths.
    if "trained" in index:
        safe_index = os.path.join(params["tempDir"], "voice.index")
        shutil.copyfile(index, safe_index)
        index = safe_index
    kwargs = dict(
        audio_input_path=params["input"],
        audio_output_path=output,
        model_path=params["model"],
        index_path=index,
        pitch=int(params["pitch"]),
        f0_method=str(params["f0Method"]),
        index_rate=float(params["indexRate"]),
        volume_envelope=float(params["volumeEnvelope"]),
        protect=float(params["protect"]),
        hop_length=128,
        split_audio=False,
        f0_autotune=False,
        f0_autotune_strength=1.0,
        embedder_model=str(params["embedder"]),
        embedder_model_custom=None,
        clean_audio=False,
        clean_strength=0.5,
        export_format="WAV",
        post_process=False,
        resample_sr=0,
        # The app always converts with the first speaker of the model
        sid=0,
        proposed_pitch=False,
        proposed_pitch_threshold=155.0,
        formant_shifting=False,
    )
    context.progress(0.05, "load")
    runtime.run_with_cpu_fallback(lambda device: _instance(device).convert_audio(**kwargs), unload)
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
        return {"safe": False, "detail": str(error)[:2000]}
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
        raise KuraError("UNSAFE_MODEL", str(error)[:2000]) from error
    weights, meta = _extract(checkpoint)
    del checkpoint
    save_file(weights, os.path.join(out_dir, "model.safetensors"))
    with open(os.path.join(out_dir, "model.json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False)
    return {"safe": safe, "meta": _public(meta)}


# --- final mix ------------------------------------------------------------------------


def _read(path: str, sample_rate: int) -> Any:
    import numpy as np
    from pedalboard.io import AudioFile

    with AudioFile(path).resampled_to(sample_rate) as handle:
        audio = handle.read(handle.frames)
    if audio.shape[0] == 1:
        audio = np.vstack([audio, audio])
    return audio[:2].astype(np.float32)


def rpc_mix(params: dict, context: Context) -> dict:
    """Vocal / accompaniment balance, reverb on the vocals and the master volume.

    The preview and the export use this same rendering, so they always sound the same.
    """
    import numpy as np
    from pedalboard import Gain, Limiter, Pedalboard, Reverb
    from pedalboard.io import AudioFile

    sample_rate = int(params["sampleRate"])
    settings = params["params"]
    reverb = settings["reverb"]
    context.progress(0.1, "read")
    vocals = _read(params["vocals"], sample_rate)
    chain = [Gain(gain_db=float(settings["vocalGainDb"]))]
    if reverb["enabled"]:
        chain.append(
            Reverb(
                room_size=float(reverb["roomSize"]),
                damping=float(reverb["damping"]),
                wet_level=float(reverb["wetLevel"]),
                dry_level=float(reverb["dryLevel"]),
                width=float(reverb["width"]),
                freeze_mode=0.0,
            )
        )
    vocals = Pedalboard(chain)(vocals, sample_rate)
    mix = vocals
    accompaniment_path = params["accompaniment"]
    if accompaniment_path:
        accompaniment = _read(accompaniment_path, sample_rate)
        accompaniment = Pedalboard([Gain(gain_db=float(settings["accompanimentGainDb"]))])(accompaniment, sample_rate)
        length = max(vocals.shape[1], accompaniment.shape[1])
        mix = np.zeros((2, length), dtype=np.float32)
        mix[:, : vocals.shape[1]] += vocals
        mix[:, : accompaniment.shape[1]] += accompaniment
    context.progress(0.6, "master")
    master = [Gain(gain_db=float(settings["masterGainDb"]))]
    if settings["limiter"]:
        master.append(Limiter(threshold_db=-1.0, release_ms=100.0))
    mix = Pedalboard(master)(mix.astype(np.float32), sample_rate)
    if int(params["channels"]) == 1:
        mix = mix.mean(axis=0, keepdims=True)
    output = params["output"]
    with AudioFile(output, "w", samplerate=sample_rate, num_channels=mix.shape[0], bit_depth=32) as handle:
        handle.write(mix.astype(np.float32))
    context.progress(1.0, "done")
    return {"path": output}


def unload() -> None:
    global _converter, _converter_device
    _converter = None
    _converter_device = ""
    runtime.release_memory()
