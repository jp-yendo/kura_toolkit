"""Applio's feature extraction (F0 and embeddings) run in this process (through script_runner.py).

Usage: python script_runner.py --patch applio --root <Applio> -- rvc_extract.py <experiment dir> <device> <threads> <sample rate>

Applio's own script runs each step in a worker process per device. Those processes would not see
the patches that make Applio read the predictor and the embedder from the app's model directory,
and the app trains on one device, so Applio's per-device functions run here directly.
"""

from __future__ import annotations

import glob
import json
import os
import sys

from rvc.train.extract.extract import process_file_embedding, process_files
from rvc.train.extract.preparing_files import generate_config, generate_filelist

# The embedder recorded in the trained model (the app's patch loads it from the model directory)
EMBEDDER = "contentvec"


def main() -> int:
    experiment = sys.argv[1]
    device = sys.argv[2]
    threads = max(1, int(sys.argv[3]))
    sample_rate = sys.argv[4]

    sliced = os.path.join(experiment, "sliced_audios")
    for name in ("f0", "f0_voiced", "extracted"):
        os.makedirs(os.path.join(experiment, name), exist_ok=True)
    # Written by rvc_preprocess.py
    info_path = os.path.join(experiment, "model_info.json")
    with open(info_path, "r", encoding="utf-8") as handle:
        info = json.load(handle)
    info["embedder_model"] = EMBEDDER
    with open(info_path, "w", encoding="utf-8") as handle:
        json.dump(info, handle, indent=4)

    files = []
    for path in glob.glob(os.path.join(sliced, "*.wav")):
        name = os.path.basename(path)
        files.append(
            [
                path,
                os.path.join(experiment, "f0", name + ".npy"),
                os.path.join(experiment, "f0_voiced", name + ".npy"),
                os.path.join(experiment, "extracted", name.replace("wav", "npy")),
            ]
        )
    if not files:
        print(f"Sliced audios not found at {sliced}.", file=sys.stderr)
        return 1

    process_files(files, "rmvpe", device, threads)
    process_file_embedding(files, EMBEDDER, None, 0, device, threads)
    generate_config(sample_rate, experiment)
    # Applio writes the training list with paths relative to the cwd (the Applio folder). The training
    # step runs in the job folder, which can be on another drive, so the list holds absolute paths.
    relpath = os.path.relpath
    os.path.relpath = lambda path, start=None: os.path.abspath(path)
    try:
        generate_filelist(experiment, sample_rate, 2)
    finally:
        os.path.relpath = relpath
    return 0


if __name__ == "__main__":
    sys.exit(main())
