"""Resident helper process driven by the Electron main process.

Usage: python worker.py --component separator|converter|tts

Requests arrive on stdin as JSON lines ``{"id": 1, "method": "...", "params": {...}}`` and are
answered on the protocol stream with ``{"id": 1, "result": ...}`` or ``{"id": 1, "error": ...}``.
Progress is reported with ``{"id": 1, "event": {...}}`` while a request runs.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kura_voice.protocol import Context, KuraError, Protocol  # noqa: E402

SERVICES = {
    "separator": "kura_voice.separator_service",
    "converter": "kura_voice.converter_service",
    "tts": "kura_voice.tts_service",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--component", required=True, choices=sorted(SERVICES))
    args = parser.parse_args()

    protocol = Protocol()
    service = None

    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        request = json.loads(line)
        request_id = request.get("id")
        method = str(request.get("method", ""))
        params = request.get("params") or {}
        context = Context(protocol, request_id)
        try:
            if service is None:
                service = importlib.import_module(SERVICES[args.component])
            if method == "unload":
                service.unload()
                protocol.result(request_id, True)
                continue
            handler = getattr(service, f"rpc_{method}", None)
            if handler is None:
                raise KuraError("UNKNOWN_METHOD", method)
            protocol.result(request_id, handler(params, context))
        except KuraError as error:
            protocol.error(request_id, error.code, error.message)
        except SystemExit as error:
            # Some libraries call sys.exit() when a model cannot be loaded.
            protocol.error(request_id, "PYTHON_EXIT", f"exit code {error.code}", traceback.format_exc())
        except BaseException as error:  # noqa: BLE001 - every failure must be reported
            traceback.print_exc()
            protocol.error(request_id, "PYTHON_ERROR", f"{type(error).__name__}: {error}", traceback.format_exc())
    return 0


if __name__ == "__main__":
    sys.exit(main())
