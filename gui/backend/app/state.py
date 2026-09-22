"""Thread-safe shared state between the Nautilus core thread and the FastAPI layer."""

from __future__ import annotations

import queue
import threading
from typing import Any


class CommandQueue:
    """Order/strategy commands pushed by REST handlers, drained by the GUI agent timer."""

    def __init__(self) -> None:
        self._q: queue.Queue[dict] = queue.Queue()

    def push(self, cmd: dict) -> None:
        self._q.put(cmd)

    def drain(self, limit: int = 50) -> list[dict]:
        out: list[dict] = []
        for _ in range(limit):
            try:
                out.append(self._q.get_nowait())
            except queue.Empty:
                break
        return out

    def clear(self) -> None:
        while True:
            try:
                self._q.get_nowait()
            except queue.Empty:
                break


class LiveStore:
    """Latest live-session state published by the GUI agent on the core thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._snapshot: dict[str, Any] | None = None
        self._node_status: dict[str, Any] = {
            "mode": "replay",
            "running": False,
            "state": "STOPPED",
            "trader_id": None,
            "error": None,
        }

    def set_snapshot(self, snap: dict[str, Any]) -> None:
        with self._lock:
            self._snapshot = snap

    def get_snapshot(self) -> dict[str, Any] | None:
        with self._lock:
            return self._snapshot

    def clear_snapshot(self) -> None:
        with self._lock:
            self._snapshot = None

    def set_node_status(self, **kwargs: Any) -> None:
        with self._lock:
            self._node_status.update(kwargs)

    def get_node_status(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._node_status)


commands = CommandQueue()
live_store = LiveStore()
