"""Shared runtime helpers: device selection, progress capture and safety patches."""

from __future__ import annotations

import gc
import os
import platform
import sys
from typing import Any, Callable, Iterable, List, Optional, TypeVar

from kura_voice.protocol import KuraError

T = TypeVar("T")

# Windows status codes of crashed processes (NTSTATUS), shown with their meaning in error details
_CRASH_CODES = {
    0xC0000005: "access violation",
    0xC00000FD: "stack overflow",
    0xC0000409: "stack buffer overrun",
}


def describe_exit_code(code: int) -> str:
    """An exit status for error details: crash codes in hex with their meaning, signals by number."""
    if code < 0:
        return f"signal {-code}"
    if code >= 0x80000000:
        meaning = _CRASH_CODES.get(code)
        return f"0x{code:08X} ({meaning})" if meaning else f"0x{code:08X}"
    return str(code)


def is_apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


def preferred_device() -> str:
    """CUDA on Windows (NVIDIA), MPS on Apple Silicon, otherwise CPU."""
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if is_apple_silicon() and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def release_memory() -> None:
    """Collect unreachable objects and return the GPU memory PyTorch keeps cached."""
    gc.collect()
    try:
        import torch
    except ImportError:
        # The separator environment without PyTorch (Intel Macs, macOS earlier than 14) holds no GPU memory
        return

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if is_apple_silicon() and torch.backends.mps.is_available():
        torch.mps.empty_cache()


# Messages of the errors PyTorch raises for the GPU itself (CUDA, cuDNN and cuBLAS on NVIDIA GPUs,
# MPS on Apple Silicon), as opposed to errors caused by the input or the model
_GPU_ERROR_MARKERS = (
    "CUDA error",
    "CUDA out of memory",
    "CUDA driver",
    "cuDNN",
    "CUBLAS",
    "MPS backend out of memory",
    # NotImplementedError: "The operator ... is not currently implemented for the MPS device"
    "MPS device",
    # TypeError: "Cannot convert a MPS Tensor to float64 dtype as the MPS framework doesn't support float64"
    "MPS framework",
)


def is_gpu_failure(error: BaseException) -> bool:
    """Whether the error comes from the GPU (out of memory, a driver error or an unsupported operation)."""
    import torch

    # torch.cuda.OutOfMemoryError is the same class
    if isinstance(error, torch.OutOfMemoryError):
        return True
    # NotImplementedError is a RuntimeError
    if not isinstance(error, (RuntimeError, TypeError)):
        return False
    message = str(error)
    return any(marker in message for marker in _GPU_ERROR_MARKERS)


def run_with_cpu_fallback(run: Callable[[str], T], release: Callable[[], None]) -> T:
    """Run on the preferred device and, when the GPU fails (is_gpu_failure), once more on the CPU.

    ``run`` receives the device name. ``release`` frees what the service keeps on the GPU and the
    memory caches (the service's ``unload``). It is called after the except block, because the tensors
    of the failed attempt stay referenced from the traceback until then. Every call starts on the
    preferred device, so a request after a CPU retry uses the GPU again.
    """
    device = preferred_device()
    try:
        return run(device)
    except Exception as error:
        if device == "cpu" or not is_gpu_failure(error):
            raise
        print(f"{device} failed ({type(error).__name__}: {error}); retrying on the CPU", file=sys.stderr, flush=True)
    release()
    return run("cpu")


class TqdmBridge:
    """Forwards tqdm progress bars to a callback.

    Libraries create bars with ``from tqdm import tqdm`` at import time, so the module level
    names are replaced with a subclass that reports ``n / total`` on every update.

    A library can run several bars in turn for one task. When the bars to come are known (``expect``), each bar has
    a weight: the bars of equal work are reported as one progress from 0 to 1, and the bars of weight 0 (short
    preparation) only report that they run (``on_light``), without moving the progress. When they are not known,
    each bar reports from its own start, and from the second bar on the bar's number is passed as ``repeat`` (so
    that the progress going back to 0 is shown as the next pass, not as a restart).
    """

    def __init__(
        self,
        callback: Callable[[float, Optional[int]], None],
        on_light: Optional[Callable[[], None]] = None,
    ) -> None:
        import tqdm as tqdm_module

        base = tqdm_module.tqdm
        bridge = self

        # A bar iterated in a loop calls update() only every mininterval (0.1 s), so a short bar may never call it.
        # The bar is also reported when it is made (its start) and when it is closed (tqdm sets the final count
        # before closing), so that every bar is seen and ends at its total.
        class ReportingTqdm(base):  # type: ignore[misc, valid-type]
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                super().__init__(*args, **kwargs)
                bridge._report(self)

            def update(self, n: float = 1) -> Any:
                result = super().update(n)
                bridge._report(self)
                return result

            def close(self) -> None:
                if not getattr(self, "_kura_closed", False):
                    self._kura_closed = True
                    bridge._report(self)
                super().close()

        self._callback = callback
        self._on_light = on_light
        self.cls = ReportingTqdm
        self._bar: Any = None
        self._last = -1.0
        self._index = -1
        self._plan: Optional[List[float]] = None

    def expect(self, weights: Optional[List[float]]) -> None:
        """Set the weights of the bars to come (None: not known), counting the bars from the next one."""
        self._plan = list(weights) if weights is not None else None
        self._bar = None
        self._index = -1
        self._last = -1.0

    def _report(self, bar: Any) -> None:
        total = getattr(bar, "total", None)
        if not total:
            return
        new_bar = bar is not self._bar
        if new_bar:
            # A bar seen before that reports again after the next one started (closed late) is not a new bar
            if getattr(bar, "_kura_seen", False):
                return
            bar._kura_seen = True
            self._bar = bar
            self._index += 1
            if self._plan is None:
                self._last = -1.0
        fraction = min(1.0, float(bar.n) / float(total))
        repeat: Optional[int] = None
        if self._plan is not None:
            weight = self._plan[self._index] if self._index < len(self._plan) else 0.0
            if weight <= 0:
                # A short step: show that it runs, keep the progress where it is
                if new_bar and self._on_light is not None:
                    self._on_light()
                return
            done = sum(item for item in self._plan[: self._index] if item > 0)
            whole = sum(item for item in self._plan if item > 0)
            fraction = min(1.0, (done + weight * fraction) / whole)
            if new_bar:
                # Continue from where the previous bars ended (a bar may stop short of its total)
                self._last = min(self._last, fraction)
        elif self._index > 0:
            repeat = self._index + 1
        # Avoid flooding the protocol: report in steps of 1%.
        if not new_bar and fraction - self._last < 0.01 and fraction < 1.0:
            return
        self._last = fraction
        self._callback(fraction, repeat)

    def install(self, modules: Iterable[Any]) -> None:
        """Replace the module level ``tqdm`` name of the modules that have one."""
        for module in modules:
            if hasattr(module, "tqdm"):
                module.tqdm = self.cls


def block_wget_downloads() -> None:
    """Applio downloads a missing embedder with wget when it is used; the app downloads it instead.

    Applio uses wget only for the embedders (rvc/lib/utils.py), so a blocked download is reported as
    a missing embedder, named by the folder in the URL.
    """
    import wget

    def blocked(url: str, *args: Any, **kwargs: Any) -> Any:
        raise KuraError("EMBEDDER_MISSING", url.rstrip("/").split("/")[-2] if "/" in url else url)

    wget.download = blocked


def patch_faiss_unicode_paths() -> None:
    """faiss opens files with C stdio, which cannot open non-ASCII paths on Windows.

    Reading and writing through Python file objects and (de)serialisation works for any path.
    """
    import faiss
    import numpy as np

    if getattr(faiss, "_kura_patched", False):
        return
    original_read = faiss.read_index
    original_write = faiss.write_index

    def read_index(path: Any, *args: Any) -> Any:
        if isinstance(path, str) and not args:
            with open(path, "rb") as handle:
                data = np.frombuffer(handle.read(), dtype=np.uint8)
            return faiss.deserialize_index(data)
        return original_read(path, *args)

    def write_index(index: Any, path: Any, *args: Any) -> Any:
        if isinstance(path, str) and not args:
            data = faiss.serialize_index(index)
            with open(path, "wb") as handle:
                handle.write(data.tobytes())
            return None
        return original_write(index, path, *args)

    faiss.read_index = read_index
    faiss.write_index = write_index
    faiss._kura_patched = True


# Applio's embedders: the name Applio uses and the folder holding the files
APPLIO_EMBEDDERS = {
    "contentvec": "contentvec",
    "spin": "spin",
    "spin-v2": "spin-v2",
    "chinese-hubert-base": "chinese_hubert_base",
    "japanese-hubert-base": "japanese_hubert_base",
    "korean-hubert-base": "korean_hubert_base",
}


def applio_model_path(path: Any) -> Any:
    """Applio reads its models from rvc/models/<kind>/ under its own folder (the working directory).

    The app keeps them in the model directory (KURA_APPLIO_MODELS), so such paths are rewritten to
    the same file there. Any other path is returned unchanged.
    """
    if not isinstance(path, (str, os.PathLike)):
        return path
    root = os.path.normcase(os.path.join(os.getcwd(), "rvc", "models"))
    full = os.path.abspath(os.fspath(path))
    if os.path.normcase(full).startswith(root + os.sep):
        return os.path.join(os.environ["KURA_APPLIO_MODELS"], full[len(root) + 1 :])
    return path


def patch_applio_model_paths() -> None:
    """Make Applio read the F0 predictors (RMVPE / FCPE) and the embedders from the model directory.

    Call it before importing the Applio modules that use them (rvc.lib.predictors.f0,
    rvc.infer.infer, rvc.train.extract.extract), since they import the names when loaded.
    """
    import torchfcpe
    from rvc.lib import utils as applio_utils
    from rvc.lib.predictors import RMVPE as rmvpe_module

    base = os.environ["KURA_APPLIO_MODELS"]
    if getattr(rmvpe_module, "_kura_patched", False):
        return
    original_predictor = rmvpe_module.RMVPE0Predictor

    class RMVPE0Predictor(original_predictor):  # type: ignore[misc, valid-type]
        def __init__(self, model_path: Any, *args: Any, **kwargs: Any) -> None:
            super().__init__(applio_model_path(model_path), *args, **kwargs)

    rmvpe_module.RMVPE0Predictor = RMVPE0Predictor
    rmvpe_module._kura_patched = True

    original_spawn = torchfcpe.spawn_infer_model_from_pt

    def spawn_infer_model_from_pt(pt_path: Any, *args: Any, **kwargs: Any) -> Any:
        return original_spawn(applio_model_path(pt_path), *args, **kwargs)

    torchfcpe.spawn_infer_model_from_pt = spawn_infer_model_from_pt

    original_load = applio_utils.load_embedding

    def load_embedding(embedder_model: Any, custom_embedder: Any = None) -> Any:
        folder = APPLIO_EMBEDDERS.get(embedder_model)
        if folder is None:
            return original_load(embedder_model, custom_embedder)
        path = os.path.join(base, "embedders", folder)
        if not os.path.exists(os.path.join(path, "pytorch_model.bin")):
            raise KuraError("EMBEDDER_MISSING", folder)
        # Applio's own way of loading an embedder from a given folder
        return original_load("custom", path)

    applio_utils.load_embedding = load_embedding


def patch_nltk_zip_lookup() -> None:
    """Let NLTK find the app's extracted data when asked for the zip archive.

    g2p_en (English pronunciation) checks for "taggers/averaged_perceptron_tagger.zip" and "corpora/cmudict.zip"
    when it is imported and downloads them when they are missing. The app's download extracts these archives into
    folders (as NLTK reads them), so the zip names are looked up as the extracted folders as well.
    """
    import nltk

    if getattr(nltk.data.find, "_kura_zip_lookup", False):
        return
    original = nltk.data.find

    def find(resource_name: str, *args: Any, **kwargs: Any) -> Any:
        try:
            return original(resource_name, *args, **kwargs)
        except LookupError:
            if not resource_name.endswith(".zip"):
                raise
            return original(resource_name[: -len(".zip")], *args, **kwargs)

    find._kura_zip_lookup = True  # type: ignore[attr-defined]
    nltk.data.find = find


def write_wav_as_float() -> None:
    """Make every WAV file written with soundfile.write in this process 32-bit float.

    The libraries write their results with soundfile and pick 16-bit PCM in places: Applio saves the converted
    voice with the default WAV format, and audio-separator writes 16-bit for float input with the VR models and for
    ensembles. The app keeps intermediate audio as 32-bit float, so the subtype is replaced for WAV files
    (whether given or not). Other formats are passed through unchanged.
    """
    import soundfile

    if getattr(soundfile.write, "_kura_float_wav", False):
        return
    original = soundfile.write

    def write(file: Any, data: Any, samplerate: int, subtype: Any = None, endian: Any = None, format: Any = None,
              *args: Any, **kwargs: Any) -> Any:
        file_format = format or os.path.splitext(str(file))[1].lstrip(".")
        if str(file_format).lower() == "wav":
            subtype = "FLOAT"
        return original(file, data, samplerate, subtype, endian, format, *args, **kwargs)

    write._kura_float_wav = True  # type: ignore[attr-defined]
    soundfile.write = write


# Start of the line with which a script run by script_runner.py reports a KuraError to the training
# driver that started it (training_common.run_step raises it again with the same code and message)
ERROR_MARKER = "KURA_ERROR:"


def report_error(error: KuraError) -> None:
    """Print a KuraError as one marker line for the training driver."""
    message = " ".join(error.message.split())
    print(f"{ERROR_MARKER} {error.code} {message}".rstrip(), file=sys.stderr, flush=True)


class PretrainedLoadError(BaseException):
    """The pretrained weights for training could not be loaded.

    A BaseException on purpose: the repository's training script catches every Exception here and
    silently trains from scratch, which makes a useless model from a few minutes of audio.
    """


def patch_sbv2_model_paths() -> None:
    """Make Style-Bert-VITS2's repository scripts read models from the model directory.

    The BERT models are looked up in fixed folders inside the repository (KURA_SBV2_MODELS points to
    the app's copy instead). Training starts from G_0 / D_0 / DUR_0 / WD_0, which the script looks for
    in the training folder; they are read from the pretrained models (KURA_SBV2_PRETRAINED) instead.
    If they cannot be loaded, training stops (PretrainedLoadError) instead of starting from scratch.
    """
    from pathlib import Path

    from style_bert_vits2.constants import DEFAULT_BERT_MODEL_PATHS, Languages
    from style_bert_vits2.models.utils import safetensors as sbv2_safetensors

    models = Path(os.environ["KURA_SBV2_MODELS"])
    pretrained = os.environ["KURA_SBV2_PRETRAINED"]
    DEFAULT_BERT_MODEL_PATHS[Languages.JP] = models / "bert" / "deberta-v2-large-japanese-char-wwm"
    DEFAULT_BERT_MODEL_PATHS[Languages.EN] = models / "bert" / "deberta-v3-large"
    DEFAULT_BERT_MODEL_PATHS[Languages.ZH] = models / "bert" / "chinese-roberta-wwm-ext-large"

    original = sbv2_safetensors.load_safetensors
    initial = {"G_0.safetensors", "D_0.safetensors", "DUR_0.safetensors", "WD_0.safetensors"}

    def load_safetensors(path: Any, *args: Any, **kwargs: Any) -> Any:
        name = os.path.basename(os.fspath(path))
        if name not in initial:
            return original(path, *args, **kwargs)
        try:
            return original(os.path.join(pretrained, name), *args, **kwargs)
        except Exception as error:
            report_error(KuraError("TRAINING_PRETRAINED_UNREADABLE", f"{name}: {error}"))
            raise PretrainedLoadError(f"{name}: {error}") from error

    sbv2_safetensors.load_safetensors = load_safetensors
