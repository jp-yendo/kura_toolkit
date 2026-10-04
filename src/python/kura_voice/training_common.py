"""Shared parts of the training drivers (rvc_train.py, sbv2_train.py).

A driver runs the upstream scripts one by one through script_runner.py and reports its progress
as JSON lines on the protocol stream:
  {"id": 0, "event": {"kind": "stage", "stage": "train", "epoch": 3, "totalEpochs": 200}}
It ends with a "done" event, or an "error" event with a code that the app translates.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Callable, Optional, Pattern

from kura_voice.protocol import KuraError, StandaloneContext
from kura_voice.runtime import ERROR_MARKER, describe_exit_code

RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "script_runner.py")
# The last line of a Python traceback ("RuntimeError: ...", "torch.OutOfMemoryError: ...")
ERROR_LINE = re.compile(r"^[A-Za-z_][\w.]*(Error|Exception)\b")


def run_step(
    context: StandaloneContext,
    patch: str,
    root: str,
    cwd: str,
    stage: str,
    args: list,
    epoch_line: Optional[Pattern[str]] = None,
    total_epochs: int = 0,
) -> str:
    """Run one upstream script through script_runner.py with its patches (applio / sbv2).

    ``root`` is the upstream source folder (put on the import path) and ``cwd`` the folder the
    script runs in (the upstream scripts read some files relative to it).
    The script's output is copied to stderr, and lines matching ``epoch_line`` report the epoch
    reached. A KuraError the script reported (runtime.report_error) is raised again here. Otherwise
    the last error line the script printed is returned: a script can fail in a child process
    (Applio's training) and still exit normally, so the caller reports that line when the step's
    result is missing.
    """
    last_error = ""
    reported: Optional[KuraError] = None
    command = [sys.executable, "-u", RUNNER, "--patch", patch, "--root", root, "--", *[str(arg) for arg in args]]
    context.event(kind="stage", stage=stage)
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    assert process.stdout is not None
    buffer = b""
    while True:
        chunk = process.stdout.read1(4096)
        if not chunk:
            break
        buffer += chunk
        parts = re.split(rb"\r\n|\r|\n", buffer)
        buffer = parts.pop()
        for raw in parts:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            print(line, file=sys.stderr, flush=True)
            if reported is None and line.startswith(ERROR_MARKER):
                code, _, message = line[len(ERROR_MARKER) :].strip().partition(" ")
                reported = KuraError(code, message[:500])
            if ERROR_LINE.match(line):
                last_error = line[:500]
            match = epoch_line.search(line) if epoch_line is not None else None
            if match:
                context.event(kind="stage", stage=stage, epoch=int(match.group(1)), totalEpochs=total_epochs)
    code = process.wait()
    if reported is not None:
        raise reported
    if code != 0:
        raise KuraError("TRAINING_STEP_FAILED", last_error or f"{stage} exited with {describe_exit_code(code)}")
    return last_error


def main(train: Callable[[dict, StandaloneContext, str], None]) -> int:
    """A driver's entry point (``--job job.json``).

    ``train(job, context, job_dir)`` runs the training; ``job_dir`` is the folder of the job file in
    the work directory, which the main process creates for this training and removes afterwards
    (whether it succeeds, fails or is cancelled). The training data, features and checkpoints are
    written there.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    args = parser.parse_args()
    with open(args.job, "r", encoding="utf-8") as handle:
        job = json.load(handle)
    context = StandaloneContext()
    try:
        train(job, context, os.path.dirname(os.path.abspath(args.job)))
    except KuraError as error:
        context.event(kind="error", code=error.code, message=error.message)
        return 1
    except Exception as error:  # noqa: BLE001 - every failure must be reported to the app
        context.event(kind="error", code="TRAINING_FAILED", message=f"{type(error).__name__}: {error}")
        return 1
    context.event(kind="done")
    return 0
