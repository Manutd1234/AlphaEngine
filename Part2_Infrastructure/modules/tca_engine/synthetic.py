"""The offline fallback book, tagged so nothing can mistake it for market data."""

from __future__ import annotations

import asyncio
import math
import random

from modules.tca_engine._runtime import settings
from modules.tca_engine.feed import VenueFeed


class SyntheticFeed(VenueFeed):
    """Offline fallback. Generates a plausible correlated random-walk ladder.

    Only activated when every real feed is down and ALLOW_SYNTHETIC_BOOK=1.
    All downstream payloads are tagged ``synthetic=True`` so nothing derived
    from it can be mistaken for live market data.
    """

    name = "SIM"
    _ANCHORS = {"BTCUSDT": 68000.0, "ETHUSDT": 3500.0, "SOLUSDT": 160.0}

    def __init__(self, symbols: list[str]) -> None:
        super().__init__(symbols)
        for book in self.books.values():
            book.synthetic = True
        self._px = {s: self._ANCHORS.get(s, 100.0) for s in symbols}
        self._rng = random.Random(7)

    async def _run(self) -> None:
        self._mark_connected()
        while not self._stop.is_set():
            for sym in self.symbols:
                px = self._px[sym] * math.exp(self._rng.gauss(0, 0.0004))
                self._px[sym] = px
                tick = max(px * 1e-5, 10 ** math.floor(math.log10(px * 1e-5)))
                half = tick * self._rng.uniform(1.0, 2.5)
                bids, asks = [], []
                for i in range(settings.book_depth):
                    depth_scale = 1.0 + i * 0.35
                    size = max(px, 3000.0) / px * self._rng.uniform(0.4, 1.6) * depth_scale
                    bids.append((round(px - half - i * tick, 8), round(size, 6)))
                    asks.append((round(px + half + i * tick, 8), round(size, 6)))
                self.books[sym].apply_snapshot(bids, asks)
            await asyncio.sleep(0.25)
