"""The engine that owns the feeds and is asked the questions.

Composed rather than monolithic: the feed watchdog lives in
``supervision.py`` and the cost analytics in ``analytics.py``, so what remains
here is the engine's own identity — what it holds, how it starts and stops, and
which books it will let a caller see.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from modules.schemas import VenueBook
from modules.tca_engine._runtime import settings
from modules.tca_engine.analytics import EngineAnalytics
from modules.tca_engine.binance import BinanceFeed
from modules.tca_engine.book import BookState
from modules.tca_engine.bybit import BybitFeed
from modules.tca_engine.feed import VenueFeed
from modules.tca_engine.supervision import FeedSupervision
from modules.tca_engine.synthetic import SyntheticFeed

log = logging.getLogger("alphaengine.tca")


class TCAEngine(FeedSupervision, EngineAnalytics):
    """Owns all venue feeds and answers execution-cost questions about them."""

    def __init__(self, symbols: list[str] | None = None, venues: list[str] | None = None) -> None:
        self.symbols = [s.upper() for s in (symbols or settings.symbols)]
        self.venue_names = [v.upper() for v in (venues or settings.venues)]
        self.feeds: dict[str, VenueFeed] = {}
        self._synthetic: SyntheticFeed | None = None
        self._watchdog: asyncio.Task | None = None
        self._snapshotter: asyncio.Task | None = None
        self.started_at: float | None = None
        self._alert_hooks: list = []
        # Last announced health per venue, so alerts fire on the *transition*.
        # Re-announcing "still down" every five seconds trains an operator to
        # ignore the channel, which is worse than not alerting at all.
        self._feed_state: dict[str, str] = {}

    # -- lifecycle -------------------------------------------------------- #
    async def start(self) -> None:
        if not settings.enable_market_data:
            log.warning("market data disabled by ENABLE_MARKET_DATA=0")
            return
        builders = {"BINANCE": BinanceFeed, "BYBIT": BybitFeed, "SIM": SyntheticFeed}
        for name in self.venue_names:
            cls = builders.get(name)
            if not cls:
                log.warning("unknown venue %s — skipped", name)
                continue
            feed = cls(self.symbols)
            self.feeds[name] = feed
            feed.start()
        self.started_at = time.time()
        self._watchdog = asyncio.create_task(self._watch(), name="tca-watchdog")
        if settings.tca_snapshot_interval_s > 0:
            self._snapshotter = asyncio.create_task(self._snapshot_loop(), name="tca-snapshotter")

    async def stop(self) -> None:
        for task in (self._watchdog, self._snapshotter):
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        await asyncio.gather(*(f.stop() for f in self.feeds.values()), return_exceptions=True)

    # -- accessors -------------------------------------------------------- #
    def _live_books(self, symbol: str) -> dict[str, BookState]:
        out = {}
        for name, feed in self.feeds.items():
            book = feed.books.get(symbol)
            if book and book.has_book and not book.stale:
                out[name] = book
            elif book and book.has_book and book.synthetic:
                out[name] = book
        return out

    def venues_online(self, symbol: str) -> list[str]:
        return sorted(self._live_books(symbol).keys())

    def is_synthetic(self, symbol: str) -> bool:
        books = self._live_books(symbol)
        return bool(books) and all(b.synthetic for b in books.values())

    def get_books(self, symbol: str, depth: int = 20) -> list[VenueBook]:
        symbol = symbol.upper()
        out = []
        for feed in self.feeds.values():
            book = feed.books.get(symbol)
            if book is None:
                continue
            out.append(book.to_schema(connected=feed.connected, depth=depth))
        return out

    def consolidated_mid(self, symbol: str) -> float | None:
        """Depth-weighted mid across venues — a more stable reference than any
        single venue's mid when one feed is thin or momentarily crossed."""
        books = self._live_books(symbol)
        num = den = 0.0
        for book in books.values():
            mid = book.mid
            if mid is None:
                continue
            w = book.depth_usd("bid", 5) + book.depth_usd("ask", 5)
            w = max(w, 1.0)
            num += mid * w
            den += w
        return num / den if den else None

    def top_of_book(
        self, symbol: str,
    ) -> tuple[float | None, str | None, float | None, str | None]:
        """The consolidated touch: ``(best_bid, bid_venue, best_ask, ask_venue)``.

        ``consolidated_mid`` is depth-weighted and is deliberately not a touch —
        it is a stable *reference*, which is the wrong thing to fill a resting
        order against. A limit order crosses when somebody is actually showing a
        price through it, and that is the best bid or offer anyone is displaying.

        Built from ``_live_books``, so a stale venue cannot fill a resting order
        for the same reason it cannot price a route.
        """
        best_bid = best_ask = None
        bid_venue = ask_venue = None
        for name, book in self._live_books(symbol).items():
            bid, ask = book.best_bid, book.best_ask
            if bid is not None and (best_bid is None or bid > best_bid):
                best_bid, bid_venue = bid, name
            if ask is not None and (best_ask is None or ask < best_ask):
                best_ask, ask_venue = ask, name
        return best_bid, bid_venue, best_ask, ask_venue

    def last_price(self, symbol: str) -> float | None:
        return self.consolidated_mid(symbol.upper())

    def health(self) -> dict:
        return {
            "enabled": settings.enable_market_data,
            "uptime_s": round(time.time() - self.started_at, 1) if self.started_at else 0.0,
            "symbols": self.symbols,
            "synthetic_active": self._synthetic is not None,
            "feeds": [f.status() for f in self.feeds.values()],
        }


_engine: TCAEngine | None = None


def get_engine() -> TCAEngine:
    global _engine
    if _engine is None:
        _engine = TCAEngine()
    return _engine
