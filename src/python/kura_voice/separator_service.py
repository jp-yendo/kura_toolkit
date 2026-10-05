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
from typing import Any, Dict, List, Tuple

from kura_voice import runtime
from kura_voice.protocol import Context, KuraError

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


def _install_progress(context: Context, start: float, span: float) -> None:
    """Report the library's progress bars as progress between ``start`` and ``start + span``."""
    from audio_separator.separator import separator as separator_module
    from audio_separator.separator.architectures import (
        demucs_separator,
        mdx_separator,
        mdxc_separator,
        vr_separator,
    )
    from audio_separator.separator.uvr_lib_v5.demucs import apply as demucs_apply

    bridge = runtime.TqdmBridge(lambda fraction: context.progress(start + span * fraction))
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
    # "noise" alone is not used: "Instrumental Fullness Noisy" is an instrumental model.
    if re.search(r"reverb|echo|de-?verb|de-?noise|crowd|aspiration|breath|\bdry\b", text) or any(
        re.search(r"reverb|echo|noise|\bdry\b|crowd", stem) for stem in lower
    ):
        return "cleanup"
    real_stems = [stem for stem in lower if stem != "unknown"]
    if (
        len(real_stems) >= 3
        or re.search(r"demucs|drumsep|[46]stem|roformer[ _-]sw\b", text)
        or any(re.search(r"drum|bass|guitar|piano", stem) for stem in real_stems)
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
            "segments_enabled": bool(demucs["segmentsEnabled"]),
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
        # Keep the original level: stems are only scaled down when they would clip.
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
    separator = Separator(**kwargs)
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
        _install_progress(context, 0.05, 0.9)
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
