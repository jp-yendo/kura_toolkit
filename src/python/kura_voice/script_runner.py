"""Run an upstream script (Applio / Style-Bert-VITS2) after applying Kura Toolkit's patches.

Usage: python script_runner.py --patch applio|sbv2 --root <upstream source> -- path/to/script.py [args...]

The patches keep every download behind the app's download screen, make the scripts read models
from the app's model directory, and work around file I/O that cannot handle non-ASCII paths.
The script runs as ``__main__`` in this process, exactly as if it had been started directly.
A KuraError raised by the script is printed as one marker line (runtime.report_error) for the
training driver that started this process.
"""

from __future__ import annotations

import argparse
import os
import runpy
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kura_voice import runtime  # noqa: E402
from kura_voice.protocol import KuraError  # noqa: E402


def _free_port() -> int:
    """A local TCP port that the OS hands out as free."""
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _patch_distributed_port() -> None:
    """PyTorch's distributed training (used even with one GPU) listens on a local TCP port.

    Applio picks it with ``randint(20000, 55555)`` and Style-Bert-VITS2 uses a fixed port from its
    config. On Windows, ranges of such ports are often reserved by Hyper-V / WinNAT and binding
    fails with WSAEACCES, so a port the OS reports as free is used instead.
    """
    import random

    port = _free_port()
    # Style-Bert-VITS2 only fills MASTER_PORT from its config when it is not set yet.
    os.environ["MASTER_PORT"] = str(port)
    original = random.randint

    def randint(a: int, b: int) -> int:
        if (a, b) == (20000, 55555):
            return port
        return original(a, b)

    random.randint = randint  # type: ignore[assignment]


def _patch_single_process_ddp() -> None:
    """Train without DistributedDataParallel (the app trains with a single process).

    Style-Bert-VITS2 wraps its models in DDP even for a single GPU (Applio only does so for
    several GPUs). On Windows, the gloo backend crashes the process (access violation) when it
    all-reduces CUDA gradients (seen with PyTorch 2.11), and with one process the all-reduce has
    nothing to combine anyway. The replacement keeps DDP's shape (``.module`` and the ``module.``
    prefix in ``state_dict``), so the training scripts and their checkpoints work unchanged.
    """
    import torch

    class SingleProcessDDP(torch.nn.Module):
        def __init__(self, module: torch.nn.Module, *args: object, **kwargs: object) -> None:
            super().__init__()
            self.module = module

        def forward(self, *args: object, **kwargs: object) -> object:
            return self.module(*args, **kwargs)

    torch.nn.parallel.DistributedDataParallel = SingleProcessDDP  # type: ignore[misc]


def _patch_wespeaker() -> None:
    """style_gen.py loads the speaker embedding model by its Hugging Face name; use the app's copy."""
    from pyannote.audio import Model

    wespeaker = os.environ["KURA_WESPEAKER"]
    original = Model.from_pretrained.__func__  # type: ignore[attr-defined]

    def from_pretrained(cls: type, checkpoint: object, *args: object, **kwargs: object) -> object:
        if checkpoint == "pyannote/wespeaker-voxceleb-resnet34-LM":
            checkpoint = wespeaker
        return original(cls, checkpoint, *args, **kwargs)

    Model.from_pretrained = classmethod(from_pretrained)  # type: ignore[assignment]


def _patch_pyopenjtalk() -> None:
    """Keep the text preprocessing's pyopenjtalk worker and user dictionary inside this job.

    preprocess_text.py and bert_gen.py start a pyopenjtalk worker on a fixed port (7861), and would
    connect to any other process already listening there, so the worker gets a port the OS reports
    as free. They then compile the user dictionary to ``dict_data/user.dic`` in the upstream source;
    it is compiled into the cwd (the job folder in the work directory) instead, and the worker loads
    it from there. The scripts look both functions up after these replacements (``from ... import``
    and ``pyopenjtalk_worker.initialize_worker`` run when the script runs).
    """
    import functools
    from pathlib import Path

    from style_bert_vits2.nlp.japanese import pyopenjtalk_worker, user_dict

    pyopenjtalk_worker.initialize_worker = functools.partial(  # type: ignore[assignment]
        pyopenjtalk_worker.initialize_worker, port=_free_port()
    )
    user_dict.update_dict = functools.partial(  # type: ignore[assignment]
        user_dict.update_dict, compiled_dict_path=Path(os.getcwd(), "user.dic")
    )


def _patch_applio() -> None:
    _patch_distributed_port()
    runtime.patch_faiss_unicode_paths()
    runtime.block_wget_downloads()
    # Models are read from the app's model directory (Applio looks for them under its own folder)
    runtime.patch_applio_model_paths()


def _patch_sbv2(script: str) -> None:
    import nltk

    _patch_distributed_port()
    name = os.path.basename(script)
    if name in ("train_ms.py", "train_ms_jp_extra.py"):
        _patch_single_process_ddp()
    if name == "style_gen.py":
        _patch_wespeaker()
    if name in ("preprocess_text.py", "bert_gen.py"):
        _patch_pyopenjtalk()
    # BERT and the pretrained weights are read from the app's model directory
    runtime.patch_sbv2_model_paths()

    def blocked(*args: object, **kwargs: object) -> bool:
        raise RuntimeError("NLTK download blocked by Kura Toolkit")

    nltk.download = blocked
    runtime.patch_nltk_zip_lookup()


def main() -> int:
    separator = sys.argv.index("--")
    parser = argparse.ArgumentParser()
    parser.add_argument("--patch", choices=["applio", "sbv2"], required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args(sys.argv[1:separator])
    script = os.path.abspath(sys.argv[separator + 1])
    # Same import environment as running the script directly (its directory first), plus the upstream
    # source: the patches import its modules before the script runs, and a script running in another
    # folder (Applio's training runs in the work directory) still finds its packages.
    sys.argv = [script, *sys.argv[separator + 2 :]]
    sys.path[0] = os.path.dirname(script)
    if args.root not in sys.path:
        sys.path.insert(1, args.root)
    if args.patch == "applio":
        _patch_applio()
    else:
        _patch_sbv2(script)
    try:
        runpy.run_path(script, run_name="__main__")
    except KuraError as error:
        runtime.report_error(error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
