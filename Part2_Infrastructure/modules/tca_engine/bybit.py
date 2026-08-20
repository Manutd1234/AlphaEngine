"""Bybit: ``orderbook.50`` as snapshot plus sequence-tagged deltas.

Unlike Binance this venue *is* consumed incrementally, because ``u`` increments
by exactly one per delta and so a dropped frame is detectable. Detecting it is
the whole reason the incremental path is safe here, which is why the predicate
that does it lives beside the feed that depends on it.
"""

from __future__ import annotations

import asyncio
import contextlib
import json

from modules.tca_engine._runtime import settings
from modules.tca_engine.feed import VenueFeed


def is_sequence_gap(prev_seq: int, new_seq: int) -> bool:
    """Did a Bybit delta go missing between ``prev_seq`` and ``new_seq``?

    Bybit's ``u`` increments by exactly 1 per delta, so anything other than
    ``prev + 1`` means a frame was lost. The obvious-looking test
    ``new_seq < prev_seq`` catches only a *backward* jump, which ordered TCP
    delivery makes impossible — it never fires, while a real forward gap sails
    through and gets applied.

    That matters because deltas carry every level *removal*. Drop one and a
    filled bid stays in the ladder forever, sitting above the true ask: a
    permanently crossed book that the UI reports as a cross-venue arbitrage
    which does not exist.

    Returns False when either sequence is 0 (no baseline yet, or the venue
    omitted the field) so a fresh subscription is never treated as a gap.
    """
    if not prev_seq or not new_seq:
        return False
    return new_seq != prev_seq + 1



class BybitFeed(VenueFeed):
    name = "BYBIT"

    async def _run(self) -> None:
        import websockets

        depth = 50 if settings.book_depth > 25 else 25
        async with websockets.connect(settings.bybit_ws_url, ping_interval=None, close_timeout=5) as ws:
            await ws.send(json.dumps({"op": "subscribe", "args": [f"orderbook.{depth}.{s}" for s in self.symbols]}))
            self._mark_connected()

            async def heartbeat() -> None:
                # Bybit expects an application-level ping every <30s.
                while not self._stop.is_set():
                    await asyncio.sleep(20)
                    await ws.send(json.dumps({"op": "ping"}))

            hb = asyncio.create_task(heartbeat())
            try:
                while not self._stop.is_set():
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=45))
                    topic = msg.get("topic", "")
                    if not topic.startswith("orderbook."):
                        continue
                    data = msg.get("data") or {}
                    sym = (data.get("s") or topic.split(".")[-1]).upper()
                    book = self.books.get(sym)
                    if not book:
                        continue
                    bids = [(float(p), float(q)) for p, q in data.get("b", [])]
                    asks = [(float(p), float(q)) for p, q in data.get("a", [])]
                    seq = int(data.get("u", 0))

                    if msg.get("type") == "snapshot":
                        book.apply_snapshot(bids, asks)
                    else:
                        # A gap means the local book can no longer be trusted ->
                        # drop the connection and force a fresh snapshot.
                        if is_sequence_gap(book.seq, seq):
                            raise RuntimeError(
                                f"bybit sequence gap on {sym}: {book.seq} -> {seq}"
                            )
                        book.apply_delta(bids, asks)
                    book.seq = seq or book.seq
                    if msg.get("ts"):
                        book.exchange_ts_ms = float(msg["ts"])
            finally:
                hb.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await hb
