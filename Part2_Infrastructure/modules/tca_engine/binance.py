"""Binance: a self-contained top-of-book snapshot every 100ms.

Consumed via ``<symbol>@depth20@100ms`` rather than the diff stream, because
the diff stream needs a REST snapshot plus buffered-delta reconciliation that
silently corrupts the book if a single message is dropped.
"""

from __future__ import annotations

import asyncio
import json

from modules.tca_engine._runtime import settings
from modules.tca_engine.feed import VenueFeed


class BinanceFeed(VenueFeed):
    name = "BINANCE"

    async def _run(self) -> None:
        import websockets

        depth = 20 if settings.book_depth > 10 else 10
        streams = "/".join(f"{s.lower()}@depth{depth}@100ms" for s in self.symbols)
        url = f"{settings.binance_ws_url}?streams={streams}"

        async with websockets.connect(url, ping_interval=20, ping_timeout=20, close_timeout=5) as ws:
            self._mark_connected()
            while not self._stop.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=45)
                msg = json.loads(raw)
                stream = msg.get("stream", "")
                data = msg.get("data", msg)
                sym = stream.split("@")[0].upper()
                book = self.books.get(sym)
                if not book or "bids" not in data:
                    continue
                book.apply_snapshot(
                    [(float(p), float(q)) for p, q in data["bids"]],
                    [(float(p), float(q)) for p, q in data["asks"]],
                )
                book.seq = int(data.get("lastUpdateId", 0))
