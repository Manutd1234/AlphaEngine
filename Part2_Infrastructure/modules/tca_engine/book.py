"""One venue's L2 ladder for one symbol, and the C++ mirror of it."""

from __future__ import annotations

import importlib
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from modules.schemas import BookLevel, ExecutionEstimate, VenueBook
from modules.tca_engine._runtime import settings
from modules.tca_engine.tolerance import _dust, absorbs

log = logging.getLogger("alphaengine.tca")


def _new_native_ladder():
    """A fresh C++ ``BookLadder``, or None when the extension is not built.

    Deliberately keyed on whether ``modules._decision_core`` *imports*, not on
    ``modules.decision_core.native()`` — that is, on the extension existing
    rather than on which engine ``DECISION_CORE`` selected. Those are different
    questions and conflating them is a bug the first draft of this shipped: a
    caller that forces the native engine (the parity suite does, so a build that
    quietly degraded turns CI red) would find every book unmirrored under
    ``DECISION_CORE=python`` and fall back to Python without saying so — the
    silent fall-back that suite exists to catch, caused by the mechanism meant
    to make it fast.

    A mirror nobody reads costs one ladder rebuild per feed update, which is
    ~60/s per book against a decision path that is per order. That is the right
    side to spend on.

    Resolved at first use rather than by a module-level import so the absence of
    the ``.so`` is never an import error for the whole engine.
    """
    try:
        core = importlib.import_module("modules._decision_core")
    except ImportError:
        return None  # not built for this platform; books keep no mirror
    except Exception:  # pragma: no cover - a broken extension must not break ingestion
        log.exception("native decision core unusable; books keep no mirror")
        return None
    return core.BookLadder()


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
    # Sorted views, built once per mutation rather than once per read. A
    # decision reads each side of each venue's book about five times (mark,
    # gross exposure, drawdown, the ladder walk, top of book) and every read
    # was re-sorting a 50-level dict; measured, that was ~40 of the 78 µs a
    # two-venue decision cost. The two mutation funnels below are the only
    # writers, so invalidating there is complete.
    _sorted_bids_cache: list[tuple[float, float]] | None = field(default=None, repr=False)
    _sorted_asks_cache: list[tuple[float, float]] | None = field(default=None, repr=False)
    # The C++ mirror of the two ladders, when a native decision core is the
    # active engine. Built lazily on the first mutation and refreshed in the
    # same two funnels that invalidate the caches above — which is what makes
    # "the mirror is never stale" a property of this class rather than a rule
    # every caller has to remember. The decision path then walks a ladder that
    # already exists instead of building one per order; that rebuild was ~3 µs
    # of every two-venue decision.
    #
    # Non-compared as well as non-repr, unlike the caches: a pybind object
    # compares by identity, so two books holding identical prices would
    # otherwise never compare equal.
    _native_ladder: object | None = field(default=None, repr=False, compare=False)
    _native_ladder_resolved: bool = field(default=False, repr=False, compare=False)

    # -- mutation ------------------------------------------------------- #
    def apply_snapshot(self, bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> None:
        self.bids = {p: q for p, q in bids if q > 0}
        self.asks = {p: q for p, q in asks if q > 0}
        self._sorted_bids_cache = None
        self._sorted_asks_cache = None
        self._mirror()
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
        self._sorted_bids_cache = None
        self._sorted_asks_cache = None
        self._mirror()
        self._touch()

    def _mirror(self) -> None:
        """Rebuild the native ladder from the dicts as they now stand.

        A full re-snapshot, not an incremental delta. These funnels run at the
        feed's update rate (~60/s per book) while a decision runs per order, so
        the side that stays simple is the one that runs on the cheap path — and
        a rebuild cannot drift from the dict the way a hand-maintained delta
        can. The C++ side applies the same semantics the dict comprehension
        above does (size > 0, last size per price wins) and the same sort, so
        this is a mirror rather than an approximation.
        """
        if not self._native_ladder_resolved:
            self._native_ladder_resolved = True
            self._native_ladder = _new_native_ladder()
        ladder = self._native_ladder
        if ladder is not None:
            ladder.snapshot(list(self.bids.items()), list(self.asks.items()))

    def native_ladder(self):
        """This book's C++ ladder, or None when no native core is active.

        Every caller must handle the None: the extension is optional, and a
        book that has never been mutated has no mirror yet.

        The ladder is *borrowed*, not copied, so a reader holds it only for the
        length of one synchronous call. That is safe for the same reason the
        sorted-view caches above are: the feeds and the gateway share one event
        loop, and neither the decision battery nor a funnel awaits in the middle
        of using them.
        """
        return self._native_ladder

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
        out = self._sorted_bids_cache
        if out is None:
            out = sorted(self.bids.items(), key=lambda kv: -kv[0])
            self._sorted_bids_cache = out
        return out[:depth] if depth else out

    def sorted_asks(self, depth: int | None = None) -> list[tuple[float, float]]:
        out = self._sorted_asks_cache
        if out is None:
            out = sorted(self.asks.items(), key=lambda kv: kv[0])
            self._sorted_asks_cache = out
        return out[:depth] if depth else out

    @property
    def best_bid(self) -> float | None:
        levels = self.sorted_bids()
        return levels[0][0] if levels else None

    @property
    def best_ask(self) -> float | None:
        levels = self.sorted_asks()
        return levels[0][0] if levels else None

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
        dust = _dust(target_notional)

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
            if remaining <= dust:
                break

        vwap = filled_notional / filled_qty if filled_qty > 0 else None
        slip = None
        if vwap and mid:
            slip = (vwap - mid) / mid * 1e4 if side == "BUY" else (mid - vwap) / mid * 1e4

        return ExecutionEstimate(
            venue=self.venue,
            # Judged on what the walk measured, not on the residual counter: the
            # two carry the same drift, and reading the measurement directly is
            # what keeps the reported ``filled_notional`` and the verdict in step.
            fillable=absorbs(filled_notional, target_notional),
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
