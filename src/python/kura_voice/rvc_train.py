"""Train an RVC voice model with Applio's training scripts.

Usage: python rvc_train.py --job job.json

The job lists the audio files to train on (``files``: files the user picked, read where they are,
and recordings in the work directory), the Applio folder and the pretrained models in the app's
model directory. Progress is reported as JSON lines on the protocol stream (see training_common.py).
The training data, features and checkpoints are written to the job folder in the work directory.
The finished model (model.safetensors / model.json / model.index) is written straight
into ``outputDir``, the model's folder being created in the model directory.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kura_voice.protocol import KuraError, StandaloneContext  # noqa: E402
from kura_voice.training_common import main, run_step  # noqa: E402

EPOCH_LINE = re.compile(r"\|\s*epoch=(\d+)\s*\|\s*step=(\d+)")
HERE = os.path.dirname(os.path.abspath(__file__))
# Applio's preprocessing, feature extraction and index building for the app's file list and folders
PREPROCESS = os.path.join(HERE, "rvc_preprocess.py")
EXTRACT = os.path.join(HERE, "rvc_extract.py")
INDEX = os.path.join(HERE, "rvc_index.py")


def write_precision(applio: str, job_dir: str) -> None:
    """Applio's training script reads the precision setting from assets/config.json in its cwd."""
    with open(os.path.join(applio, "assets", "config.json"), "r", encoding="utf-8") as handle:
        precision = json.load(handle)["precision"]
    os.makedirs(os.path.join(job_dir, "assets"))
    with open(os.path.join(job_dir, "assets", "config.json"), "w", encoding="utf-8") as handle:
        json.dump({"precision": precision}, handle)


def train(job: dict, context: StandaloneContext, job_dir: str) -> None:
    applio = job["applioDir"]
    name = job["modelName"]
    sample_rate = str(job["sampleRate"])
    epochs = int(job["epochs"])
    save_every = int(job["saveEvery"])
    output_dir = job["outputDir"]
    # Applio's training script keeps its files in <cwd>/logs/<name> and runs in the job folder.
    # The other steps run in the Applio folder (they read its configs and silence samples by
    # relative paths) and are given this folder explicitly.
    experiment = os.path.join(job_dir, "logs", name)

    files_list = os.path.join(job_dir, "files.json")
    with open(files_list, "w", encoding="utf-8") as handle:
        json.dump(job["files"], handle, ensure_ascii=False)
    run_step(
        context,
        "applio",
        applio,
        applio,
        "preprocess",
        [PREPROCESS, experiment, files_list, sample_rate, job["cpuCores"]],
    )
    sliced = glob.glob(os.path.join(experiment, "sliced_audios", "*.wav"))
    if not sliced:
        raise KuraError("TRAINING_NO_AUDIO")

    device = "cpu" if job["extractGpu"] == "-" else f"cuda:{job['extractGpu']}"
    run_step(context, "applio", applio, applio, "extract", [EXTRACT, experiment, device, job["cpuCores"], sample_rate])
    if not glob.glob(os.path.join(experiment, "extracted", "*.npy")):
        raise KuraError("TRAINING_EXTRACT_FAILED")

    write_precision(applio, job_dir)
    train_error = run_step(
        context,
        "applio",
        applio,
        job_dir,
        "train",
        [
            os.path.join(applio, "rvc", "train", "train.py"),
            name,
            save_every,
            epochs,
            job["pretrainedG"],
            job["pretrainedD"],
            job["trainGpu"],
            job["batchSize"],
            sample_rate,
            "True",
            "False",
            "False",
            "False",
            "HiFi-GAN",
            "False",
        ],
        epoch_line=EPOCH_LINE,
        total_epochs=epochs,
    )
    weights = sorted(glob.glob(os.path.join(experiment, f"{name}_{epochs}e_*s.pth")))
    if not weights:
        raise KuraError("TRAINING_NO_MODEL", train_error)

    index = os.path.join(output_dir, "model.index")
    index_error = run_step(context, "applio", applio, applio, "index", [INDEX, experiment, index])
    if not os.path.exists(index):
        raise KuraError("TRAINING_NO_INDEX", index_error)

    context.event(kind="stage", stage="finalize")
    from kura_voice import converter_service

    converter_service.rpc_sanitize_model({"path": weights[-1], "outDir": output_dir, "allowUnsafe": False}, context)


if __name__ == "__main__":
    sys.exit(main(train))
