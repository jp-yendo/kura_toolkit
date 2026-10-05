"""Applio's dataset preprocessing for a given list of audio files (run through script_runner.py).

Usage: python script_runner.py --patch applio --root <Applio> -- rvc_preprocess.py <experiment dir> <files.json> <sample rate> <processes>

Applio's own script collects the audio files of one folder. The app trains on the audio of a
training set (stored in the model directory), so the list is given explicitly; each file is
processed by Applio's own per-file code.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import sys

from rvc.train.preprocess.preprocess import PreProcess, process_audio_wrapper, save_dataset_duration

# cut_preprocess, process_effects, noise_reduction, reduction_strength, chunk_len, overlap_len,
# normalization_mode (Applio's defaults for training)
SETTINGS = ("Automatic", False, False, 0.7, 3.0, 0.3, "post")


def main() -> int:
    # Imported here: the worker processes run this file again without the kura_voice package on their
    # import path (only this process raises the error, and script_runner.py has imported it already).
    from kura_voice.protocol import KuraError

    experiment = sys.argv[1]
    with open(sys.argv[2], "r", encoding="utf-8") as handle:
        paths = json.load(handle)
    sample_rate = int(sys.argv[3])
    processes = max(1, int(sys.argv[4]))
    preprocessor = PreProcess(sample_rate, experiment)
    # (path, index, speaker id): one speaker
    files = [(path, index, 0) for index, path in enumerate(paths)]
    total = 0.0
    with concurrent.futures.ProcessPoolExecutor(max_workers=processes) as executor:
        futures = {executor.submit(process_audio_wrapper, (preprocessor, file, *SETTINGS)): file[0] for file in files}
        for future in concurrent.futures.as_completed(futures):
            duration = future.result()
            # Applio reports 0 seconds for a file it could not read (and prints the reason)
            if not duration:
                raise KuraError("TRAINING_FILE_UNREADABLE", os.path.basename(futures[future]))
            total += duration
    save_dataset_duration(os.path.join(experiment, "model_info.json"), dataset_duration=total)
    print(f"Preprocess completed on {total:.1f} seconds of audio.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
