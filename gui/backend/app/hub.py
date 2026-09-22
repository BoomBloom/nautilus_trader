import threading


class EventHub:
    """Thread-safe message queue: nautilus engine thread pushes, asyncio broadcaster drains."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queue: list[dict] = []

    def push(self, msg: dict) -> None:
        with self._lock:
            self._queue.append(msg)

    def drain(self) -> list[dict]:
        with self._lock:
            out, self._queue = self._queue, []
            return out


hub = EventHub()
