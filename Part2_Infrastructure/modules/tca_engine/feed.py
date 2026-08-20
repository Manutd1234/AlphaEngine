"""The venue-feed base class: one WebSocket, a heartbeat and a backoff.

Each venue subclass supplies ``_run`` and nothing else — the supervision loop,
the reconnection backoff and the status view are the same for all of them,
which is why a new venue is a new file next to this one rather than a branch
inside it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time

from modules.tca_engine._runtime import settings
from modules.tca_engine.book import BookState

log = logging.getLogger("alphaengine.tca")


class VenueFeed:
    """Base class: owns one WebSocket connection with heartbeat + backoff."""

    name = "BASE"

    def __init__(self, symbols: list[str]) -> None:
        self.symbols = symbols
        self.books: dict[str, BookState] = {s: BookState(self.name, s) for s in symbols}
        self.connected = False
        self.reconnects = 0
        self.last_error: str | None = None
        self.connected_since: float | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._supervise(), name=f"feed-{self.name}")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _supervise(self) -> None:
        """Reconnect loop with exponential backoff + jitter (blueprint mitigation
        for the 'WebSocket connection drops' operational risk)."""
        delay = settings.ws_reconnect_base_s
        while not self._stop.is_set():
            try:
                await self._run()
                delay = settings.ws_reconnect_base_s  # clean exit -> reset backoff
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("[%s] feed error: %s (reconnect in %.1fs)", self.name, self.last_error, delay)
            finally:
                self.connected = False
                self.connected_since = None
            if self._stop.is_set():
                break
            self.reconnects += 1
            await asyncio.sleep(delay + random.uniform(0, delay * 0.3))
            delay = min(delay * 2, settings.ws_reconnect_max_s)

    async def _run(self) -> None:  # pragma: no cover - overridden
        raise NotImplementedError

    def _mark_connected(self) -> None:
        self.connected = True
        self.connected_since = time.time()
        self.last_error = None
        log.info("[%s] connected (%d symbols)", self.name, len(self.symbols))

    def status(self) -> dict:
        return {
            "venue": self.name,
            "connected": self.connected,
            "reconnects": self.reconnects,
            "last_error": self.last_error,
            "uptime_s": round(time.time() - self.connected_since, 1) if self.connected_since else 0.0,
            "symbols": {
                s: {
                    "age_s": round(b.age_s, 2) if b.last_update_wall else None,
                    "updates": b.update_count,
                    "rate_hz": round(b.update_rate_hz, 1),
                    "stale": b.stale,
                }
                for s, b in self.books.items()
            },
        }
