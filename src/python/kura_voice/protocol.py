"""Line-delimited JSON protocol between the Electron main process and the Python helpers.

The real stdout is reserved for protocol messages. Everything that libraries print (Python
``print`` calls as well as C level writes) is redirected to stderr, which the main process
only logs.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any, Optional


class KuraError(Exception):
    """An error with a machine readable code that the renderer translates.

    The message is an optional detail shown with the translated text; it is empty when there is none.
    """

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


class Protocol:
    def __init__(self) -> None:
        sys.stdout.flush()
        # Keep a private handle to the original stdout, then point fd 1 at stderr so that
        # C extensions writing to stdout cannot corrupt the protocol stream.
        protocol_fd = os.dup(1)
        os.dup2(2, 1)
        if os.name == "nt":
            # C runtimes that write through the Win32 standard handle bypass fd 1.
            import ctypes
            import msvcrt

            ctypes.windll.kernel32.SetStdHandle(-11, msvcrt.get_osfhandle(2))
        self._out = os.fdopen(protocol_fd, "w", encoding="utf-8", newline="\n", buffering=1)
        sys.stdout = sys.stderr
        self._lock = threading.Lock()

    def send(self, message: dict) -> None:
        line = json.dumps(message, ensure_ascii=False)
        with self._lock:
            self._out.write(line + "\n")
            self._out.flush()

    def result(self, request_id: Any, result: Any) -> None:
        self.send({"id": request_id, "result": result})

    def error(self, request_id: Any, code: str, message: str, detail: str = "") -> None:
        self.send({"id": request_id, "error": {"code": code, "message": message, "detail": detail}})

    def event(self, request_id: Any, payload: dict) -> None:
        self.send({"id": request_id, "event": payload})


class Context:
    """Per request helper handed to the service functions."""

    def __init__(self, protocol: Protocol, request_id: Any) -> None:
        self._protocol = protocol
        self._request_id = request_id

    def event(self, **payload: Any) -> None:
        self._protocol.event(self._request_id, payload)

    def progress(self, fraction: float, message: str = "") -> None:
        fraction = max(0.0, min(1.0, float(fraction)))
        self.event(kind="progress", fraction=fraction, message=message)

    def phase(self, name: str, fraction: Optional[float] = None) -> None:
        """The current step (shown as "doing ..." with the time left estimated from ``fraction`` within the step)."""
        payload: dict = {"kind": "phase", "phase": name}
        if fraction is not None:
            payload["fraction"] = max(0.0, min(1.0, float(fraction)))
        self.event(**payload)


class StandaloneContext(Context):
    """Context for scripts that run as their own process (training drivers).

    Events are written as JSON lines to the protocol stream with a fixed id of 0.
    """

    def __init__(self) -> None:
        super().__init__(Protocol(), 0)
