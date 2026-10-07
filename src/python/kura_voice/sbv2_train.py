"""Train a Style-Bert-VITS2 voice with the fork's repository scripts.

Usage: python sbv2_train.py --job job.json

The job lists the clips (the audio of a training set, read where it is) and the sentence each
clip reads (the transcript is the presented sentence itself;
nothing is transcribed automatically). The steps mirror the repository's Web UI: initialise,
resample, text preprocessing, BERT features, style vectors and training. Models (BERT, WavLM, the
pretrained weights) are read from the app's model directory. The training data, features and
checkpoints are written to the job folder in the work directory. The finished model (config.json /
style_vectors.npy / weights) is written straight into ``outputDir``, the model's folder being
created in the model directory.
"""

from __future__ import annotations

import concurrent.futures
import glob
import json
import os
import re
import shutil
import sys
from typing import Optional, Pattern

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kura_voice.protocol import KuraError, StandaloneContext  # noqa: E402
from kura_voice.training_common import main, run_step  # noqa: E402

EPOCH_LINE = re.compile(r"====> Epoch: (\d+), step: (\d+)")
HERE = os.path.dirname(os.path.abspath(__file__))
# Checks the transcripts the way the repository's text preprocessing reads them
CHECK_TEXT = os.path.join(HERE, "sbv2_check_text.py")
# The sample rate of the training audio (what the Web UI passes to the repository's resample.py)
SAMPLE_RATE = 44100


def write_configs(repo: str, job_dir: str, model_name: str, dataset: str, assets_root: str) -> None:
    """config.yml and configs/paths.yml, which the repository's scripts read from their cwd (the job folder).

    The training data goes under the job folder (dataset_root) and the finished model under the
    model's folder being created (assets_root; the scripts add a folder named after the model).
    """
    import yaml

    os.makedirs(os.path.join(job_dir, "configs"))
    with open(os.path.join(job_dir, "configs", "paths.yml"), "w", encoding="utf-8") as handle:
        yaml.safe_dump(
            {"dataset_root": os.path.join(job_dir, "Data"), "assets_root": assets_root},
            handle,
            allow_unicode=True,
        )
    with open(os.path.join(repo, "default_config.yml"), "r", encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    config["model_name"] = model_name
    config["dataset_path"] = dataset
    with open(os.path.join(job_dir, "config.yml"), "w", encoding="utf-8") as handle:
        yaml.safe_dump(config, handle, allow_unicode=True)


def models_dir() -> str:
    """The text to speech models in the app's model directory (BERT, WavLM, pretrained weights)."""
    return os.environ["KURA_SBV2_MODELS"]


def initialize(repo: str, dataset: str, job: dict) -> str:
    """The Web UI's step 1: the model config and the folder training writes its checkpoints to.

    Training starts from the pretrained weights; they are read where they are in the model
    directory (KURA_SBV2_PRETRAINED, see runtime.patch_sbv2_model_paths).
    """
    use_jp_extra = bool(job["useJpExtra"])
    template = os.path.join(repo, "configs", "config_jp_extra.json" if use_jp_extra else "config.json")
    with open(template, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    config["model_name"] = job["modelName"]
    config["data"]["training_files"] = os.path.join(dataset, "train.list")
    config["data"]["validation_files"] = os.path.join(dataset, "val.list")
    config["data"]["use_jp_extra"] = use_jp_extra
    config["train"]["batch_size"] = int(job["batchSize"])
    config["train"]["epochs"] = int(job["epochs"])
    # Only the final weights are needed; intermediate saves would take 200 MB+ each.
    config["train"]["eval_interval"] = 1_000_000
    config["train"]["log_interval"] = 200
    config["train"]["bf16_run"] = False
    for key in ("freeze_EN_bert", "freeze_JP_bert", "freeze_ZH_bert", "freeze_style", "freeze_decoder"):
        config["train"][key] = False
    # The WavLM discriminator (JP-Extra) is read from the model directory
    slm = config.get("model", {}).get("slm")
    if isinstance(slm, dict):
        slm["model"] = os.path.join(models_dir(), "slm", "wavlm-base-plus")
    os.makedirs(os.path.join(dataset, "models"), exist_ok=True)
    pretrained = os.path.join(models_dir(), "pretrained_jp_extra" if use_jp_extra else "pretrained")
    if not os.path.isfile(os.path.join(pretrained, "G_0.safetensors")):
        raise KuraError("TRAINING_PRETRAINED_MISSING")
    os.environ["KURA_SBV2_PRETRAINED"] = pretrained
    config_path = os.path.join(dataset, "config.json")
    with open(config_path, "w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2, ensure_ascii=False)
    return config_path


def resample_clip(source: str, dest: str) -> None:
    """The repository's resample.py for one file: read at 44.1 kHz (mono) and write a WAV."""
    import librosa
    import soundfile

    wav, sample_rate = librosa.load(source, sr=SAMPLE_RATE)
    soundfile.write(dest, wav, sample_rate)


def transcript(clip: dict) -> str:
    """The clip's transcript as written to the training list (one line; "|" separates the fields).

    It is the presented sentence (training from sample sentences) or the text given with the audio.
    """
    return str(clip["text"]).replace("|", " ").replace("\r", " ").replace("\n", " ").strip()


def check_texts(context: StandaloneContext, repo: str, job_dir: str, job: dict) -> None:
    """Stop with the labels of the transcripts that the text preprocessing or BERT features would fail on."""
    texts = os.path.join(job_dir, "texts.json")
    with open(texts, "w", encoding="utf-8") as handle:
        json.dump(
            [{"label": clip["label"], "text": transcript(clip)} for clip in job["clips"]], handle, ensure_ascii=False
        )
    run_step(
        context,
        "sbv2",
        repo,
        job_dir,
        "prepare",
        [CHECK_TEXT, texts, job["language"], str(bool(job["useJpExtra"])), job["textErrorCode"]],
    )


def prepare_dataset(dataset: str, job: dict) -> None:
    """The training list and the resampled audio, read directly from each clip.

    The clips are the audio of a training set (read where it is, never removed), so the
    repository's resample.py (which reads one folder) is replaced by the same processing per file.
    """
    wavs = os.path.join(dataset, "wavs")
    os.makedirs(wavs, exist_ok=True)
    language = {"ja": "JP", "en": "EN", "zh": "ZH"}[job["language"]]
    lines = []
    tasks = []
    for clip in job["clips"]:
        name = f"{clip['id']}.wav"
        tasks.append((clip["path"], os.path.join(wavs, name)))
        lines.append(f"{name}|{job['modelName']}|{language}|{transcript(clip)}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, int(job["cpuCores"]))) as executor:
        for future in [executor.submit(resample_clip, source, dest) for source, dest in tasks]:
            future.result()
    with open(os.path.join(dataset, "esd.list"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def train(job: dict, context: StandaloneContext, job_dir: str) -> None:
    repo = job["repoDir"]
    name = job["modelName"]
    output_dir = job["outputDir"]
    dataset = os.path.join(job_dir, "Data", name)
    # The folder the scripts write the finished model to (inside the model's folder being created)
    assets = os.path.join(output_dir, name)

    def step(stage: str, args: list, epoch_line: Optional[Pattern[str]] = None, total_epochs: int = 0) -> str:
        # The repository's scripts run in the job folder, where their config.yml is
        script = os.path.join(repo, args[0])
        return run_step(context, "sbv2", repo, job_dir, stage, [script, *args[1:]], epoch_line, total_epochs)

    context.event(kind="stage", stage="prepare")
    write_configs(repo, job_dir, name, dataset, output_dir)
    # Before the text check: it sets the folder of the pretrained weights that the patched scripts need
    config_path = initialize(repo, dataset, job)
    check_texts(context, repo, job_dir, job)
    context.event(kind="stage", stage="preprocess")
    prepare_dataset(dataset, job)
    processes = str(job["cpuCores"])

    text_args = [
        "preprocess_text.py",
        "--config-path",
        config_path,
        "--transcription-path",
        os.path.join(dataset, "esd.list"),
        "--train-path",
        os.path.join(dataset, "train.list"),
        "--val-path",
        os.path.join(dataset, "val.list"),
        "--val-per-lang",
        "0",
        "--yomi_error",
        "raise",
        "--correct_path",
    ]
    if job["useJpExtra"]:
        text_args.append("--use_jp_extra")
    step("preprocess", text_args)
    step("extract", ["bert_gen.py", "--config", config_path])
    step("extract", ["style_gen.py", "--config", config_path, "--num_processes", processes])

    trainer = "train_ms_jp_extra.py" if job["useJpExtra"] else "train_ms.py"
    epochs = int(job["epochs"])
    train_error = step(
        "train",
        [trainer, "--config", config_path, "--model", dataset, "--no_progress_bar"],
        epoch_line=EPOCH_LINE,
        total_epochs=epochs,
    )

    context.event(kind="stage", stage="finalize")
    weights = sorted(
        glob.glob(os.path.join(glob.escape(assets), f"{glob.escape(name)}_e{epochs}_s*.safetensors")),
        key=os.path.getmtime,
    )
    if not weights:
        raise KuraError("TRAINING_NO_MODEL", train_error)
    os.replace(weights[-1], os.path.join(output_dir, "model.safetensors"))
    os.replace(os.path.join(assets, "config.json"), os.path.join(output_dir, "config.json"))
    os.replace(os.path.join(assets, "style_vectors.npy"), os.path.join(output_dir, "style_vectors.npy"))
    # The scripts' own folder for the model is not part of the model's files
    shutil.rmtree(assets)


if __name__ == "__main__":
    sys.exit(main(train))
