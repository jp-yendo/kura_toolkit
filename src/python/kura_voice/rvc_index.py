"""Applio's index building, writing the index to a given file (run through script_runner.py).

Usage: python script_runner.py --patch applio --root <Applio> -- rvc_index.py <experiment dir> <index file>

Applio's script (rvc/train/process/extract_index.py, run in the Applio folder) writes the index
next to the features in the experiment folder, which is in the work directory. The index is part of
the finished model, so it is written straight to the model's folder instead (no copy between drives
when the work directory is on another drive).
"""

from __future__ import annotations

import os
import runpy
import sys
from typing import Any

import faiss


def main() -> int:
    experiment = sys.argv[1]
    output = sys.argv[2]
    script = os.path.join(os.getcwd(), "rvc", "train", "process", "extract_index.py")
    write_index = faiss.write_index

    # Only the script's own call (with a file path) is redirected; faiss calls write_index with a
    # writer object internally (serialize_index), which goes through unchanged.
    def write_to_output(index: Any, path: Any, *args: Any) -> Any:
        if isinstance(path, str) and not args:
            return write_index(index, output)
        return write_index(index, path, *args)

    faiss.write_index = write_to_output
    sys.argv = [script, experiment, "Auto"]
    runpy.run_path(script, run_name="__main__")
    return 0


if __name__ == "__main__":
    sys.exit(main())
