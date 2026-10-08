"""Audio separation with audio-separator (UVR models: MDX-Net, VR Arch, Demucs, MDXC/Roformer).

Models are downloaded by the main process after the user confirmed it. This module never
downloads anything: the library's single network entry point is replaced so that a missing
file is reported instead of being fetched.
"""

from __future__ import annotations

import json
import logging
import os
import re
import types
from importlib import resources
from typing import Any, Dict, List, Optional, Tuple

from kura_voice import runtime
from kura_voice.protocol import Context, KuraError
# The silence handling requests are shared by every component (the worker looks up rpc_<method> in this module)
from kura_voice.silence import rpc_detect_silence, rpc_edit_silence  # noqa: F401
# The effects are shared by the components that have pedalboard
from kura_voice.effects import rpc_apply_effects  # noqa: F401

UVR_PUBLIC = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models"
AS_REPO = "https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs"

SAMPLE_RATE = 44100
STEM_PATTERN = re.compile(r"_\(([^)]+)\)")

_patched = False


def _patch_library() -> None:
    """Turn the library's downloader into an existence check."""
    global _patched
    if _patched:
        return
    from audio_separator.separator import Separator

    def offline_download(self: Any, url: str, output_path: str) -> None:
        if os.path.isfile(output_path):
            return
        # FileNotFoundError avoids the library's fallback attempt (it retries on RuntimeError).
        raise FileNotFoundError(f"MODEL_FILE_MISSING: {os.path.basename(output_path)}")

    Separator.download_file_if_not_exists = offline_download
    _patched = True


# The progress bridge of the separation being run (one request at a time), read by the patched architectures
_PASS_BRIDGE: Dict[str, Any] = {"bridge": None}
_passes_patched = False


def _patch_passes() -> None:
    """Tell the progress bridge which bars an architecture runs for one model, before it runs them.

    Demucs predicts once per model of its bag and per shift (all equal work), so these passes are shown as one
    progress. VR reads the bands and gathers the patches (short) before predicting, and predicts twice with TTA;
    only the predictions move the progress. The other architectures run one bar per model.
    """
    global _passes_patched
    if _passes_patched:
        return
    from audio_separator.separator.architectures.demucs_separator import DemucsSeparator
    from audio_separator.separator.architectures.vr_separator import VRSeparator

    original_demix = DemucsSeparator.demix_demucs

    def demix_demucs(self: Any, mix: Any) -> Any:
        bridge = _PASS_BRIDGE["bridge"]
        if bridge is not None:
            models = getattr(self.demucs_model_instance, "models", None)
            passes = (len(models) if models else 1) * max(1, int(self.shifts or 0))
            # Without segments, Demucs shows no bar
            bridge.expect([1.0] * passes if self.segments_enabled else None)
        return original_demix(self, mix)

    original_vr_separate = VRSeparator.separate

    def vr_separate(self: Any, *args: Any, **kwargs: Any) -> Any:
        bridge = _PASS_BRIDGE["bridge"]
        if bridge is not None:
            # Bands, patches, prediction (TTA: patches and prediction again)
            bridge.expect([0.0, 0.0, 1.0] + ([0.0, 1.0] if self.enable_tta else []))
        return original_vr_separate(self, *args, **kwargs)

    DemucsSeparator.demix_demucs = demix_demucs
    VRSeparator.separate = vr_separate
    _passes_patched = True


def _install_progress(context: Context, start: float, span: float, separator: Any) -> None:
    """Report the library's progress bars as progress between ``start`` and ``start + span``.

    An ensemble runs its models one after another, and each model reports its own bars from 0. How long each
    model takes is not known in advance, so no overall share is made up: the progress runs from 0 to the end for
    each model, and the step is reported with the model's number ("(1 / 3)") so that the progress and the time left
    are read as those of the model being run. Within a model, the bars are combined as known for its architecture
    (``_patch_passes``); short steps only change the message, and bars not known in advance are shown with their
    number ("(2nd pass)") instead of starting the progress again silently.
    """
    from audio_separator.separator import separator as separator_module
    from audio_separator.separator.architectures import (
        demucs_separator,
        mdx_separator,
        mdxc_separator,
        vr_separator,
    )
    from audio_separator.separator.uvr_lib_v5.demucs import apply as demucs_apply

    count = max(1, len(separator.model_filenames or []))
    # The model being run (the library separates the input once per model)
    state = {"index": 0}

    def report(fraction: float, repeat: Optional[int]) -> None:
        index = min(state["index"], count - 1)
        context.progress(start + span * fraction)
        if repeat is not None:
            # A bar not known in advance: the pass number tells that the progress starts again
            context.phase("separatePass", fraction, current=repeat, total=repeat)
        elif count > 1:
            context.phase("separate", fraction, current=index + 1, total=count)
        else:
            context.phase("separate", fraction)

    def report_light() -> None:
        context.phase("prepare")

    bridge = runtime.TqdmBridge(report, on_light=report_light)
    _patch_passes()
    _PASS_BRIDGE["bridge"] = bridge

    separate_file = separator._separate_file
    runs = {"count": 0}

    def counted_separate_file(*args: Any, **kwargs: Any) -> Any:
        state["index"] = runs["count"]
        runs["count"] += 1
        # Each model reports its own bars (the architecture sets what it runs once the model is loaded)
        bridge.expect(None)
        return separate_file(*args, **kwargs)

    separator._separate_file = counted_separate_file

    bridge.install([separator_module, mdx_separator, vr_separator, mdxc_separator, demucs_separator])
    # Demucs uses the module ("import tqdm" and "tqdm.tqdm(...)") rather than the class
    demucs_apply.tqdm = types.SimpleNamespace(tqdm=bridge.cls)


def _logger() -> None:
    # A handler on the parent logger stops the library from adding its own (both go to stderr).
    logger = logging.getLogger("audio_separator")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)


def _categorize(friendly: str, filename: str, stems: List[str]) -> str:
    """Kind of separation, from the output stems and the model name.

    Many Roformer models list no stems before their configuration is downloaded, so well known model
    families are recognised by name as well (Kim FT and Big Beta are vocal models).
    """
    text = f"{friendly} {filename}".lower()
    lower = [stem.lower() for stem in stems if stem]
    if re.search(r"karaoke|\bkara\b|_kara|bve|backing|lead", text):
        return "karaoke"
    # Breath separation is neither noise removal nor reverb removal
    if re.search(r"aspiration|breath", text):
        return "other"
    # Noise removal (crowd noise included). "noise" alone is not used in the name: "Instrumental Fullness Noisy"
    # is an instrumental model.
    if re.search(r"de-?noise|crowd", text) or any(re.search(r"noise|crowd", stem) for stem in lower):
        return "denoise"
    if re.search(r"reverb|echo|de-?verb|\bdry\b", text) or any(re.search(r"reverb|echo|\bdry\b", stem) for stem in lower):
        return "dereverb"
    real_stems = [stem for stem in lower if stem != "unknown"]
    if (
        len(real_stems) >= 3
        or re.search(r"demucs|drumsep|[46]stem|roformer[ _-]sw\b", text)
        or any(re.search(r"drum|bass|guitar|piano|wind", stem) for stem in real_stems)
        # "other" / "no other": the instruments other than vocals, drums and bass
        or ("other" in real_stems and "no other" in real_stems)
    ):
        return "multi"
    if any("vocal" in stem for stem in real_stems) or any(stem in ("instrumental", "inst") for stem in real_stems):
        return "vocals"
    if re.search(r"vocal|\bvoc|inst|kim[ _-]?ft|big[ _-]?beta", text):
        return "vocals"
    return "other"


def _supported(model_dir: str) -> Dict[str, Dict[str, dict]]:
    _patch_library()
    _logger()
    from audio_separator.separator import Separator

    separator = Separator(info_only=True, model_file_dir=model_dir, output_dir=model_dir, log_level=logging.WARNING)
    return separator.list_supported_model_files()


def _plan_for(arch: str, info: dict) -> List[Tuple[str, List[str]]]:
    """(local file name, candidate urls) for every file a model needs. Mirrors the library."""
    plan: List[Tuple[str, List[str]]] = []
    for item in info.get("download_files", []):
        if item.startswith("http"):
            plan.append((item.split("/")[-1], [item]))
        elif arch == "MDXC" and item.endswith(".yaml"):
            plan.append((item, [f"{UVR_PUBLIC}/mdx_model_data/mdx_c_configs/{item}", f"{AS_REPO}/{item}"]))
        else:
            plan.append((item, [f"{UVR_PUBLIC}/{item}", f"{AS_REPO}/{item}"]))
    return plan


def rpc_list_models(params: dict, context: Context) -> dict:
    """Every supported model with its files (for the download screen) and the verified ensembles."""
    model_dir = params["modelDir"]
    supported = _supported(model_dir)
    models = []
    for arch, entries in supported.items():
        for friendly, info in entries.items():
            # VIP models are meant for the UVR developer's paying supporters; do not offer them.
            if "VIP" in friendly:
                continue
            stems = [str(stem) for stem in info.get("stems") or []]
            scores = info.get("scores") or {}
            sdr = {}
            for stem_name, values in scores.items():
                if isinstance(values, dict):
                    sdr[str(stem_name)] = values.get("SDR")
            models.append(
                {
                    "filename": info["filename"],
                    "name": friendly,
                    "arch": arch,
                    "category": _categorize(friendly, info["filename"], stems),
                    "stems": stems,
                    "targetStem": info.get("target_stem"),
                    "sdr": sdr,
                    "files": [{"name": name, "urls": urls} for name, urls in _plan_for(arch, info)],
                }
            )
    ensembles = []
    with resources.files("audio_separator").joinpath("ensemble_presets.json").open("r", encoding="utf-8") as handle:
        ensemble_data = json.load(handle)
    # the library calls these "presets"; the app calls them verified ensembles
    for ensemble_id, ensemble in (ensemble_data.get("presets") or {}).items():
        category = "karaoke" if "karaoke" in ensemble_id else "vocals"
        ensembles.append(
            {
                "id": ensemble_id,
                "name": ensemble.get("name", ensemble_id),
                "models": list(ensemble.get("models") or []),
                "algorithm": ensemble.get("algorithm") or "avg_wave",
                "category": category,
            }
        )
    return {"models": models, "ensembles": ensembles}


def _arch_params(params: dict) -> dict:
    mdx = params["mdx"]
    vr = params["vr"]
    demucs = params["demucs"]
    mdxc = params["mdxc"]
    return {
        "mdx_params": {
            "hop_length": int(mdx["hopLength"]),
            "segment_size": int(mdx["segmentSize"]),
            "overlap": float(mdx["overlap"]),
            "batch_size": int(mdx["batchSize"]),
            "enable_denoise": bool(mdx["enableDenoise"]),
        },
        "vr_params": {
            "batch_size": int(vr["batchSize"]),
            "window_size": int(vr["windowSize"]),
            "aggression": int(vr["aggression"]),
            "enable_tta": bool(vr["enableTta"]),
            "enable_post_process": bool(vr["enablePostProcess"]),
            "post_process_threshold": float(vr["postProcessThreshold"]),
            "high_end_process": bool(vr["highEndProcess"]),
        },
        "demucs_params": {
            "segment_size": "Default" if demucs["segmentSize"] is None else str(int(demucs["segmentSize"])),
            "shifts": int(demucs["shifts"]),
            "overlap": float(demucs["overlap"]),
            # Always in segments: without them htdemucs fails on audio longer than its training length (about
            # 7.8 s) and shows no progress
            "segments_enabled": True,
        },
        "mdxc_params": {
            "segment_size": int(mdxc["segmentSize"]),
            "override_model_segment_size": bool(mdxc["overrideModelSegmentSize"]),
            "batch_size": None if mdxc["batchSize"] is None else int(mdxc["batchSize"]),
            "overlap": None if mdxc["overlap"] is None else int(mdxc["overlap"]),
            "pitch_shift": int(mdxc["pitchShift"]),
        },
    }


def _run(params: dict, context: Context, device: str) -> List[dict]:
    _patch_library()
    _logger()
    from audio_separator.separator import Separator

    model_dir = params["modelDir"]
    output_dir = os.path.abspath(params["outputDir"])
    method = params["method"]
    os.makedirs(output_dir, exist_ok=True)

    kwargs: Dict[str, Any] = dict(
        log_level=logging.INFO,
        model_file_dir=model_dir,
        output_dir=output_dir,
        output_format="WAV",
        # Replaced below (the library only accepts values up to 1).
        normalization_threshold=1.0,
        # Write float data directly instead of going through pydub (16-bit) and ffmpeg.
        use_soundfile=True,
        sample_rate=SAMPLE_RATE,
        **_arch_params(params["params"]),
    )
    if method["kind"] == "verifiedEnsemble":
        kwargs["ensemble_preset"] = method["ensembleId"]
    elif method["kind"] == "ensemble":
        kwargs["ensemble_algorithm"] = method["algorithm"]

    context.progress(0.02, "load")
    context.phase("loadModel")
    runtime.write_wav_as_float()
    separator = Separator(**kwargs)
    # Keep the level of the stems as they come out of the model. The output is 32-bit float, so a peak above 1
    # does not clip, and scaling a stem down would change its level against the source and the other stems.
    # Read when a model is loaded, so it is set before load_model.
    separator.normalization_threshold = float("inf")
    if device == "cpu":
        import torch

        # The library uses a GPU when there is one; the models loaded below take their devices from here.
        separator.torch_device = torch.device("cpu")
        separator.torch_device_mps = None
        separator.onnx_execution_provider = ["CPUExecutionProvider"]
    try:
        if method["kind"] == "model":
            separator.load_model(model_filename=method["filename"])
        elif method["kind"] == "ensemble":
            separator.load_model(model_filename=list(method["filenames"]))
        else:
            separator.load_model()
        _install_progress(context, 0.05, 0.9, separator)
        outputs = separator.separate(params["input"])
    finally:
        del separator
        runtime.release_memory()

    stems = []
    for output in outputs:
        path = output if os.path.isabs(output) else os.path.join(output_dir, output)
        match = STEM_PATTERN.search(os.path.basename(path))
        stems.append({"name": match.group(1) if match else os.path.splitext(os.path.basename(path))[0], "path": path})
    if not stems:
        raise KuraError("SEPARATION_NO_OUTPUT")
    return stems


def rpc_separate(params: dict, context: Context) -> dict:
    try:
        stems = runtime.run_with_cpu_fallback(lambda device: _run(params, context, device), unload)
    except FileNotFoundError as error:
        if "MODEL_FILE_MISSING" in str(error):
            raise KuraError("MODEL_FILE_MISSING", str(error).split(":", 1)[-1].strip()) from error
        raise
    context.progress(1.0, "done")
    return {"stems": stems}


def unload() -> None:
    runtime.release_memory()
