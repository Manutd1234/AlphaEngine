"""
Module A — Cross-Venue TCA & Order Book Depth Engine
=====================================================

Trading alpha
-------------
Execution slippage is a silent, compounding tax on strategy returns. A signal
with a 12 bps expected edge per trade is *unprofitable* if it routes into a book
that costs 15 bps to cross. This module maintains live L2 books from multiple
venues, prices a target order against the real ladder, and computes the
allocation that minimises blended cost.

What is live vs. mocked
-----------------------
* LIVE  — public L2 WebSocket feeds from Binance and Bybit, sequence handling,
          heartbeats and exponential-backoff reconnection.
* LIVE  — VWAP / slippage / depth analytics and the cross-venue router.
* MOCK  — order *execution* is paper-only (see ``risk_proxy``); fills are priced
          off the live ladder rather than sent to an exchange.
* MOCK  — if every feed is unreachable (offline environment) a synthetic
          random-walk book is generated so the system stays demonstrable. Every
          payload derived from it carries ``synthetic: true``.

Design note — why partial-book streams
--------------------------------------
Binance is consumed via ``<symbol>@depth20@100ms`` (a self-contained top-of-book
snapshot every 100ms) rather than the diff stream. The diff stream requires a
REST snapshot + buffered-delta reconciliation that silently corrupts the book if
a single message is dropped. For a 20-level, $100k-probe use case the partial
stream is strictly more robust. Bybit's ``orderbook.50`` *is* consumed as
snapshot + delta because it is sequence-tagged: ``u`` increments by exactly 1
per delta, and any other step is a gap that forces a resubscribe.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from config import settings
from modules.schemas import (
    BookLevel,
    ExecutionEstimate,
    RoutingLeg,
    TCAReport,
    VenueBook,
)

log = logging.getLogger("alphaengine.tca")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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


# --------------------------------------------------------------------------- #
# Book state
# --------------------------------------------------------------------------- #
@dataclass
class BookState:
    """Price -> size ladders for one (venue, symbol) pair."""

    venue: str
    symbol: str
    bids: dict[float, float] = field(default_factory=dict)
    asks: dict[float, float] = field(default_factory=dict)
    seq: int = 0
    last_update_wall: float = 0.0
    exchange_ts_ms: float | None = None
    update_count: int = 0
    _rate_window_start: float = 0.0
    _rate_window_count: int = 0
    update_rate_hz: float = 0.0
    synthetic: bool = False

    # -- mutation ------------------------------------------------------- #
    def apply_snapshot(self, bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> None:
        self.bids = {p: q for p, q in bids if q > 0}
        self.asks = {p: q for p, q in asks if q > 0}
        self._touch()

    def apply_delta(self, bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> None:
        for p, q in bids:
            if q <= 0:
                self.bids.pop(p, None)
            else:
                self.bids[p] = q
        for p, q in asks:
            if q <= 0:
                self.asks.pop(p, None)
            else:
                self.asks[p] = q
        self._touch()

    def _touch(self) -> None:
        now = time.time()
        self.last_update_wall = now
        self.update_count += 1
        if self._rate_window_start == 0.0:
            self._rate_window_start = now
        self._rate_window_count += 1
        elapsed = now - self._rate_window_start
        if elapsed >= 1.0:
            self.update_rate_hz = self._rate_window_count / elapsed
            self._rate_window_start = now
            self._rate_window_count = 0

    # -- views ---------------------------------------------------------- #
    @property
    def age_s(self) -> float:
        return time.time() - self.last_update_wall if self.last_update_wall else math.inf

    @property
    def stale(self) -> bool:
        return self.age_s > settings.venue_stale_after_s

    @property
    def has_book(self) -> bool:
        return bool(self.bids) and bool(self.asks)

    def sorted_bids(self, depth: int | None = None) -> list[tuple[float, float]]:
        out = sorted(self.bids.items(), key=lambda kv: -kv[0])
        return out[:depth] if depth else out

    def sorted_asks(self, depth: int | None = None) -> list[tuple[float, float]]:
        out = sorted(self.asks.items(), key=lambda kv: kv[0])
        return out[:depth] if depth else out

    @property
    def best_bid(self) -> float | None:
        return max(self.bids) if self.bids else None

    @property
    def best_ask(self) -> float | None:
        return min(self.asks) if self.asks else None

    @property
    def mid(self) -> float | None:
        bb, ba = self.best_bid, self.best_ask
        return (bb + ba) / 2 if bb and ba else None

    @property
    def spread_bps(self) -> float | None:
        bb, ba, m = self.best_bid, self.best_ask, self.mid
        return (ba - bb) / m * 1e4 if bb and ba and m else None

    def depth_usd(self, side: str, depth: int = 20) -> float:
        levels = self.sorted_bids(depth) if side == "bid" else self.sorted_asks(depth)
        return sum(p * q for p, q in levels)

    def imbalance(self, depth: int = 10) -> float | None:
        b = self.depth_usd("bid", depth)
        a = self.depth_usd("ask", depth)
        return (b - a) / (b + a) if (b + a) > 0 else None

    # -- execution simulation ------------------------------------------- #
    def walk(self, side: str, target_notional: float) -> ExecutionEstimate:
        """Walk the ladder for ``target_notional`` USD. side BUY consumes asks."""
        levels = self.sorted_asks() if side == "BUY" else self.sorted_bids()
        mid = self.mid
        remaining = target_notional
        filled_notional = 0.0
        filled_qty = 0.0
        consumed = 0
        worst = None

        for price, size in levels:
            level_notional = price * size
            take = min(level_notional, remaining)
            if take <= 0:
                break
            qty = take / price
            filled_notional += take
            filled_qty += qty
            remaining -= take
            consumed += 1
            worst = price
            if remaining <= 1e-9:
                break

        vwap = filled_notional / filled_qty if filled_qty > 0 else None
        slip = None
        if vwap and mid:
            slip = (vwap - mid) / mid * 1e4 if side == "BUY" else (mid - vwap) / mid * 1e4

        return ExecutionEstimate(
            venue=self.venue,
            fillable=remaining <= 1e-6,
            filled_notional=round(filled_notional, 2),
            filled_qty=filled_qty,
            vwap=vwap,
            mid=mid,
            slippage_bps=slip,
            levels_consumed=consumed,
            worst_price=worst,
        )

    def to_schema(self, connected: bool, depth: int = 20) -> VenueBook:
        mid = self.mid

        def _levels(raw: list[tuple[float, float]]) -> list[BookLevel]:
            out: list[BookLevel] = []
            cum = 0.0
            for p, q in raw:
                n = p * q
                cum += n
                out.append(BookLevel(price=p, size=q, notional=n, cum_notional=cum))
            return out

        latency = None
        if self.exchange_ts_ms:
            latency = max(0.0, self.last_update_wall * 1000 - self.exchange_ts_ms)

        return VenueBook(
            venue=self.venue,
            symbol=self.symbol,
            connected=connected,
            stale=self.stale,
            synthetic=self.synthetic,
            last_update=datetime.fromtimestamp(self.last_update_wall, tz=timezone.utc) if self.last_update_wall else None,
            latency_ms=round(latency, 1) if latency is not None else None,
            best_bid=self.best_bid,
            best_ask=self.best_ask,
            mid=mid,
            spread_bps=round(self.spread_bps, 3) if self.spread_bps is not None else None,
            bids=_levels(self.sorted_bids(depth)),
            asks=_levels(self.sorted_asks(depth)),
            depth_usd_bid=round(self.depth_usd("bid", depth), 2),
            depth_usd_ask=round(self.depth_usd("ask", depth), 2),
            imbalance=round(self.imbalance(), 4) if self.imbalance() is not None else None,
        )


# --------------------------------------------------------------------------- #
# Venue feeds
# --------------------------------------------------------------------------- #
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


# --------------------------------------------------------------------------- #
# Engine
# --------------------------------------------------------------------------- #
class TCAEngine:
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

    # -- alerting --------------------------------------------------------- #
    def add_alert_hook(self, hook) -> None:
        """Register a coroutine ``(severity, message)`` for feed transitions.

        The risk gateway has had this for kill-switch and drawdown events since
        the beginning; market data did not, so a venue could go dark and the
        only trace was a log line nobody was reading. Same shape, same
        failure-isolation rule: an alert transport must never break ingestion.
        """
        self._alert_hooks.append(hook)

    async def _alert(self, severity: str, message: str) -> None:
        for hook in self._alert_hooks:
            try:
                await hook(severity, message)
            except Exception as exc:
                log.error("feed alert hook failed: %s", exc)

    def _feed_health(self, feed: VenueFeed) -> tuple[str, str]:
        """Classify one venue as up / stale / down, with a human reason."""
        if not feed.connected:
            return "down", f"{feed.name} disconnected"
        books = [b for b in feed.books.values() if b.has_book]
        if not books:
            return "down", f"{feed.name} connected but publishing no book"
        stale = [b.symbol for b in books if b.stale]
        if len(stale) == len(books):
            return "stale", f"{feed.name} book stale for {', '.join(sorted(stale))}"
        if stale:
            return "degraded", f"{feed.name} stale on {', '.join(sorted(stale))}"
        return "up", f"{feed.name} healthy"

    async def _check_feed_health(self) -> None:
        from modules.audit import get_audit

        for name, feed in list(self.feeds.items()):
            if name == "SIM":
                continue  # the fallback's own transitions are already logged
            status, reason = self._feed_health(feed)
            previous = self._feed_state.get(name)
            if previous == status:
                continue
            self._feed_state[name] = status
            if previous is None:
                continue  # first observation is a baseline, not an incident

            recovered = status == "up"
            severity = "info" if recovered else "warning" if status == "degraded" else "critical"
            event = "feed_recovered" if recovered else "feed_degraded"
            try:
                get_audit().record_risk_event(
                    event, severity=severity, actor="feed-watchdog", detail=reason,
                    payload={"venue": name, "status": status, "previous": previous},
                )
            except Exception as exc:
                log.error("could not audit feed transition: %s", exc)

            await self._alert(
                severity,
                f"{'✅' if recovered else '📡'} {reason}."
                + ("" if recovered else " Prices from this venue are not safe to trade on."),
            )

    async def _watch(self) -> None:
        """Bring up the synthetic feed only if every real venue is dark."""
        while True:
            await asyncio.sleep(5)
            try:
                await self._check_feed_health()
            except Exception as exc:
                # Health reporting is observability; it must never be the reason
                # the synthetic-book failover below stops running.
                log.error("feed health check failed: %s", exc)
            if not settings.allow_synthetic_book:
                continue
            live = any(f.connected and any(b.has_book for b in f.books.values()) for f in self.feeds.values())
            if not live and self._synthetic is None:
                log.warning("no live venue feed after startup — enabling SYNTHETIC book (clearly tagged)")
                self._synthetic = SyntheticFeed(self.symbols)
                self.feeds["SIM"] = self._synthetic
                self._synthetic.start()
            elif live and self._synthetic is not None:
                log.info("live venue feed restored — disabling synthetic book")
                await self._synthetic.stop()
                self.feeds.pop("SIM", None)
                self._synthetic = None

    async def _snapshot_loop(self) -> None:
        from modules.audit import get_audit

        audit = get_audit()
        while True:
            await asyncio.sleep(settings.tca_snapshot_interval_s)
            try:
                for sym in self.symbols:
                    for venue, book in self._live_books(sym).items():
                        probe = settings.default_probe_notional
                        buy = book.walk("BUY", probe)
                        sell = book.walk("SELL", probe)
                        await asyncio.to_thread(
                            audit.record_tca_snapshot,
                            {
                                "symbol": sym,
                                "venue": venue,
                                "best_bid": book.best_bid,
                                "best_ask": book.best_ask,
                                "mid": book.mid,
                                "spread_bps": book.spread_bps,
                                "depth_usd_bid": book.depth_usd("bid"),
                                "depth_usd_ask": book.depth_usd("ask"),
                                "probe_notional": probe,
                                "buy_slip_bps": buy.slippage_bps,
                                "sell_slip_bps": sell.slippage_bps,
                                "synthetic": book.synthetic,
                            },
                        )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("tca snapshot failed: %s", exc)

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

    def last_price(self, symbol: str) -> float | None:
        return self.consolidated_mid(symbol.upper())

    # -- analytics -------------------------------------------------------- #
    def estimate(self, symbol: str, side: str, notional: float, venue: str | None = None) -> list[ExecutionEstimate]:
        books = self._live_books(symbol.upper())
        if venue:
            books = {k: v for k, v in books.items() if k == venue.upper()}
        return [b.walk(side.upper(), notional) for b in books.values()]

    def smart_route(self, symbol: str, side: str, notional: float) -> tuple[list[RoutingLeg], float | None]:
        """Greedy price-time allocation across the *merged* ladder.

        The consolidated book is the union of every venue's levels sorted by
        price; walking it yields the lowest achievable blended VWAP, and the
        per-venue split of that walk is the routing instruction.
        """
        symbol, side = symbol.upper(), side.upper()
        books = self._live_books(symbol)
        if not books:
            return [], None

        merged: list[tuple[float, float, str]] = []
        for name, book in books.items():
            levels = book.sorted_asks() if side == "BUY" else book.sorted_bids()
            merged.extend((p, q, name) for p, q in levels)
        merged.sort(key=lambda x: x[0], reverse=(side == "SELL"))

        remaining = notional
        per_venue: dict[str, list[float]] = {}  # venue -> [notional, qty]
        for price, size, venue in merged:
            if remaining <= 1e-9:
                break
            take = min(price * size, remaining)
            if take <= 0:
                continue
            slot = per_venue.setdefault(venue, [0.0, 0.0])
            slot[0] += take
            slot[1] += take / price
            remaining -= take

        total_notional = sum(v[0] for v in per_venue.values())
        total_qty = sum(v[1] for v in per_venue.values())
        if total_qty <= 0:
            return [], None

        legs = [
            RoutingLeg(
                venue=venue,
                notional=round(n, 2),
                qty=q,
                vwap=n / q,
                share_pct=round(n / total_notional * 100, 2),
            )
            for venue, (n, q) in sorted(per_venue.items(), key=lambda kv: -kv[1][0])
        ]
        return legs, total_notional / total_qty

    def route_estimate(self, symbol: str, side: str, notional: float) -> ExecutionEstimate | None:
        """Execution estimate for the *routed* order — the merged ladder walk.

        This is the number the risk gateway must gate on, because it is exactly
        what ``risk_proxy._paper_fill`` will execute. Gating on the best single
        venue instead would reject orders the router could actually fill, and
        would understate cost on orders it accepted.
        """
        symbol, side = symbol.upper(), side.upper()
        legs, vwap = self.smart_route(symbol, side, notional)
        if not legs or not vwap:
            return None

        filled = sum(leg.notional for leg in legs)
        qty = sum(leg.qty for leg in legs)
        mid = self.consolidated_mid(symbol)
        slip = None
        if mid:
            slip = (vwap - mid) / mid * 1e4 if side == "BUY" else (mid - vwap) / mid * 1e4

        return ExecutionEstimate(
            venue="+".join(leg.venue for leg in legs),
            fillable=filled >= notional - 1e-6,
            filled_notional=round(filled, 2),
            filled_qty=qty,
            vwap=vwap,
            mid=mid,
            slippage_bps=slip,
            levels_consumed=len(legs),
            worst_price=None,
        )

    def tca_report(self, symbol: str, side: str = "BUY", notional: float | None = None) -> TCAReport:
        symbol, side = symbol.upper(), side.upper()
        notional = notional or settings.default_probe_notional
        estimates = self.estimate(symbol, side, notional)
        legs, blended_vwap = self.smart_route(symbol, side, notional)
        cmid = self.consolidated_mid(symbol)

        blended_slip = None
        if blended_vwap and cmid:
            blended_slip = (blended_vwap - cmid) / cmid * 1e4 if side == "BUY" else (cmid - blended_vwap) / cmid * 1e4

        fillable = [e for e in estimates if e.fillable and e.vwap]
        best_venue = None
        saving_bps = saving_usd = None
        if fillable:
            best = min(fillable, key=lambda e: e.vwap) if side == "BUY" else max(fillable, key=lambda e: e.vwap)
            worst = max(fillable, key=lambda e: e.vwap) if side == "BUY" else min(fillable, key=lambda e: e.vwap)
            best_venue = best.venue
            if blended_vwap and worst.vwap:
                diff = (worst.vwap - blended_vwap) if side == "BUY" else (blended_vwap - worst.vwap)
                saving_bps = diff / worst.vwap * 1e4
                saving_usd = diff / worst.vwap * notional

        return TCAReport(
            symbol=symbol,
            side=side,
            target_notional=notional,
            generated_at=_utcnow(),
            consolidated_mid=cmid,
            per_venue=estimates,
            best_single_venue=best_venue,
            smart_route=legs,
            smart_route_vwap=blended_vwap,
            smart_route_slippage_bps=round(blended_slip, 3) if blended_slip is not None else None,
            saving_vs_worst_bps=round(saving_bps, 3) if saving_bps is not None else None,
            saving_vs_worst_usd=round(saving_usd, 2) if saving_usd is not None else None,
            venues_online=self.venues_online(symbol),
            synthetic=self.is_synthetic(symbol),
        )

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
