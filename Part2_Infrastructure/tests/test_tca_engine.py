"""Module A — book maintenance, VWAP/slippage arithmetic and smart routing.

The book walk is deliberately tested against a hand-computed ladder: if the
slippage model is wrong, every downstream number (the risk gateway's liquidity
check, the paper fill price, the TCA saving) is wrong with it.
"""

from __future__ import annotations

import pytest

from modules.tca_engine import BookState, TCAEngine


def make_book(venue="TEST", symbol="BTCUSDT") -> BookState:
    b = BookState(venue, symbol)
    b.apply_snapshot(
        bids=[(100.0, 10.0), (99.0, 20.0), (98.0, 30.0)],
        asks=[(101.0, 10.0), (102.0, 20.0), (103.0, 30.0)],
    )
    return b


class TestBookState:
    def test_top_of_book(self):
        b = make_book()
        assert b.best_bid == 100.0
        assert b.best_ask == 101.0
        assert b.mid == 100.5
        assert b.spread_bps == pytest.approx(1 / 100.5 * 1e4)

    def test_delta_removes_level_on_zero_size(self):
        b = make_book()
        b.apply_delta(bids=[(100.0, 0.0)], asks=[])
        assert b.best_bid == 99.0

    def test_delta_updates_and_inserts(self):
        b = make_book()
        b.apply_delta(bids=[(99.5, 5.0), (99.0, 1.0)], asks=[])
        assert b.bids[99.5] == 5.0
        assert b.bids[99.0] == 1.0

    def test_sorted_views_are_cached_and_invalidated_by_every_mutation(self):
        # The sorted ladders are built once per mutation, not once per read: a
        # decision reads each side ~5 times and used to re-sort a 50-level dict
        # every time. The cache is only correct if BOTH mutation funnels drop it
        # and the cached view equals a fresh sort of the dict.
        b = make_book()
        first = b.sorted_bids()
        assert b.sorted_bids() is first, "a second read must reuse the cached view"
        assert first == sorted(b.bids.items(), key=lambda kv: -kv[0])

        b.apply_delta(bids=[(99.5, 5.0)], asks=[(102.5, 1.0)])
        after_delta = b.sorted_bids()
        assert after_delta is not first, "apply_delta must invalidate the bid cache"
        assert after_delta == sorted(b.bids.items(), key=lambda kv: -kv[0])
        assert b.sorted_asks() == sorted(b.asks.items(), key=lambda kv: kv[0])
        assert b.best_bid == 100.0 and b.best_ask == 101.0

        b.apply_snapshot(bids=[(50.0, 1.0)], asks=[(51.0, 1.0)])
        assert b.sorted_bids() == [(50.0, 1.0)], "apply_snapshot must invalidate the bid cache"
        assert b.sorted_asks() == [(51.0, 1.0)], "apply_snapshot must invalidate the ask cache"
        assert b.best_bid == 50.0 and b.best_ask == 51.0

    def test_depth_slices_never_return_the_cached_list_itself(self):
        # A caller that mutates a depth-limited slice must not corrupt the cache.
        b = make_book()
        top = b.sorted_bids(2)
        top.append((0.0, 0.0))
        assert b.sorted_bids()[-1] != (0.0, 0.0)

    def test_walk_single_level(self):
        # $505 buys 5 units at 101 exactly.
        est = make_book().walk("BUY", 505.0)
        assert est.fillable
        assert est.vwap == pytest.approx(101.0)
        assert est.filled_qty == pytest.approx(5.0)
        assert est.levels_consumed == 1
        # slippage vs mid 100.5 = 0.5/100.5 * 1e4
        assert est.slippage_bps == pytest.approx(0.5 / 100.5 * 1e4)

    def test_walk_multiple_levels_vwap(self):
        # 101*10 = 1010 consumes level 1; remaining 1020 buys 10 @ 102.
        est = make_book().walk("BUY", 2030.0)
        assert est.fillable
        assert est.levels_consumed == 2
        assert est.filled_qty == pytest.approx(20.0)
        assert est.vwap == pytest.approx(2030.0 / 20.0)

    def test_walk_unfillable(self):
        est = make_book().walk("BUY", 1_000_000.0)
        assert not est.fillable
        assert est.filled_notional == pytest.approx(101 * 10 + 102 * 20 + 103 * 30)

    def test_sell_walks_bids_and_slippage_sign(self):
        est = make_book().walk("SELL", 1000.0)
        assert est.vwap == pytest.approx(100.0)
        # selling below mid is positive (adverse) slippage
        assert est.slippage_bps > 0

    def test_depth_and_imbalance(self):
        b = BookState("T", "S")
        b.apply_snapshot(bids=[(100.0, 30.0)], asks=[(101.0, 10.0)])
        assert b.depth_usd("bid") == pytest.approx(3000.0)
        assert b.imbalance() > 0  # bid-heavy


class TestSmartRouting:
    def _engine(self) -> TCAEngine:
        eng = TCAEngine(symbols=["BTCUSDT"], venues=[])

        class _Feed:
            def __init__(self, book):
                self.connected = True
                self.books = {"BTCUSDT": book}

        cheap = BookState("CHEAP", "BTCUSDT")
        cheap.apply_snapshot(bids=[(99.0, 100.0)], asks=[(100.0, 5.0), (105.0, 100.0)])
        rich = BookState("RICH", "BTCUSDT")
        rich.apply_snapshot(bids=[(98.0, 100.0)], asks=[(101.0, 100.0)])

        eng.feeds = {"CHEAP": _Feed(cheap), "RICH": _Feed(rich)}
        return eng

    def test_router_sweeps_best_prices_across_venues(self):
        eng = self._engine()
        legs, vwap = eng.smart_route("BTCUSDT", "BUY", 1000.0)
        venues = {leg.venue: leg for leg in legs}
        # 500 available at 100 on CHEAP, remainder at 101 on RICH — never 105.
        assert venues["CHEAP"].notional == pytest.approx(500.0)
        assert venues["RICH"].notional == pytest.approx(500.0)
        assert vwap == pytest.approx(1000.0 / (5.0 + 500.0 / 101.0))
        assert sum(leg.share_pct for leg in legs) == pytest.approx(100.0, abs=0.05)

    def test_route_beats_worst_single_venue(self):
        eng = self._engine()
        report = eng.tca_report("BTCUSDT", "BUY", 1000.0)
        single = {e.venue: e.vwap for e in report.per_venue if e.fillable}
        assert report.smart_route_vwap <= max(single.values())
        assert report.saving_vs_worst_usd > 0

    def test_consolidated_mid_is_depth_weighted(self):
        eng = self._engine()
        mid = eng.consolidated_mid("BTCUSDT")
        assert 99.0 < mid < 100.0  # between the two venue mids (99.5 and 99.5-ish)

    def test_stale_venue_is_excluded(self):
        eng = self._engine()
        eng.feeds["RICH"].books["BTCUSDT"].last_update_wall = 0.0  # ancient
        assert eng.venues_online("BTCUSDT") == ["CHEAP"]


class TestRouteEstimate:
    """``route_estimate`` must describe the order that will actually be sent —
    the merged-book walk — not the best single venue."""

    def _split_liquidity_engine(self) -> TCAEngine:
        """$600 on each venue; neither alone can fill $1000, together they can."""
        eng = TCAEngine(symbols=["BTCUSDT"], venues=[])

        class _Feed:
            def __init__(self, book):
                self.connected = True
                self.books = {"BTCUSDT": book}

        a = BookState("A", "BTCUSDT")
        a.apply_snapshot(bids=[(99.0, 6.0606)], asks=[(100.0, 6.0)])
        b = BookState("B", "BTCUSDT")
        b.apply_snapshot(bids=[(99.0, 6.0606)], asks=[(100.0, 6.0)])
        eng.feeds = {"A": _Feed(a), "B": _Feed(b)}
        return eng

    def test_order_no_single_venue_can_fill_is_routable(self):
        eng = self._split_liquidity_engine()
        assert all(not e.fillable for e in eng.estimate("BTCUSDT", "BUY", 1000.0))
        routed = eng.route_estimate("BTCUSDT", "BUY", 1000.0)
        assert routed is not None
        assert routed.fillable                       # the regression this guards
        assert routed.filled_notional == pytest.approx(1000.0)
        assert set(routed.venue.split("+")) == {"A", "B"}

    def test_unroutable_size_reports_partial_fill(self):
        eng = self._split_liquidity_engine()
        routed = eng.route_estimate("BTCUSDT", "BUY", 5_000.0)
        assert not routed.fillable
        assert routed.filled_notional == pytest.approx(1200.0)

    def test_route_estimate_matches_smart_route_vwap(self):
        eng = self._split_liquidity_engine()
        _, vwap = eng.smart_route("BTCUSDT", "BUY", 900.0)
        assert eng.route_estimate("BTCUSDT", "BUY", 900.0).vwap == pytest.approx(vwap)

    def test_no_book_returns_none(self):
        assert TCAEngine(symbols=["BTCUSDT"], venues=[]).route_estimate("BTCUSDT", "BUY", 100.0) is None


class TestFillTolerance:
    """``fillable`` is a pre-trade risk gate, so it has to survive the arithmetic.

    The reported failure: a SELL of 99.95002498750625 at a limit of 101 against a
    deep book was rejected with ``only $10,095 of $10,095 routable`` — the two
    figures identical to the dollar — while the same order at a quantity of
    exactly 99.95 was accepted. Two defects stacked. The router quantised each
    leg to cents and then compared that sum against a request which was not on a
    cent boundary, and the comparison used a fixed $1e-6 epsilon, three orders of
    magnitude smaller than the rounding it had to absorb.

    Every test below pins one half of the fix: orders the book *can* absorb are
    accepted, and orders it *cannot* are still refused. The second half is the
    one that matters — widening this tolerance until it hides a genuine partial
    fill releases an order into a book that cannot fill it.
    """

    LADDER_LEVELS = 50
    LEVEL_SIZE = 5000.0

    def _deep_book(self) -> BookState:
        """50 levels a cent apart, 5000 units each — the reported book."""
        b = BookState("TEST", "BTCUSDT")
        b.apply_snapshot(
            bids=[(99.95 - i * 0.01, self.LEVEL_SIZE) for i in range(self.LADDER_LEVELS)],
            asks=[(100.05 + i * 0.01, self.LEVEL_SIZE) for i in range(self.LADDER_LEVELS)],
        )
        return b

    def _deep_engine(self) -> TCAEngine:
        eng = TCAEngine(symbols=["BTCUSDT"], venues=[])

        class _Feed:
            def __init__(self, book):
                self.connected = True
                self.books = {"BTCUSDT": book}

        eng.feeds = {"TEST": _Feed(self._deep_book())}
        return eng

    def _bid_depth(self) -> float:
        return sum(p * q for p, q in self._deep_book().sorted_bids())

    # -- the reported order ------------------------------------------------ #
    def test_reported_order_is_fillable(self):
        """The exact reproduction. 99.95002498750625 at 101 is one level deep in
        a book holding ~$25M; nothing about it is unfillable."""
        notional = 99.95002498750625 * 101.0
        assert self._deep_book().walk("SELL", notional).fillable
        assert self._deep_engine().route_estimate("BTCUSDT", "SELL", notional).fillable

    def test_rounded_quantity_and_ragged_quantity_agree(self):
        """99.95 was accepted and 99.95002498750625 was not. A quantity a
        thousandth of a cent apart must not flip a risk verdict."""
        rounded = self._deep_engine().route_estimate("BTCUSDT", "SELL", 99.95 * 101.0)
        ragged = self._deep_engine().route_estimate("BTCUSDT", "SELL", 99.95002498750625 * 101.0)
        assert rounded.fillable == ragged.fillable is True

    # -- orders the book genuinely cannot absorb --------------------------- #
    def test_order_larger_than_the_book_is_still_unfillable(self):
        oversized = self._bid_depth() * 10
        walked = self._deep_book().walk("SELL", oversized)
        routed = self._deep_engine().route_estimate("BTCUSDT", "SELL", oversized)
        assert not walked.fillable
        assert not routed.fillable

    def test_exactly_the_whole_book_is_fillable(self):
        depth = self._bid_depth()
        assert self._deep_book().walk("SELL", depth).fillable
        assert self._deep_engine().route_estimate("BTCUSDT", "SELL", depth).fillable

    def test_one_meaningful_unit_past_the_whole_book_is_not(self):
        """$1 short on a $25M book is 4e-8 of the order — far below any absolute
        epsilon you would pick, and still a real shortfall the gate must catch."""
        depth = self._bid_depth()
        assert not self._deep_book().walk("SELL", depth + 1.0).fillable
        assert not self._deep_engine().route_estimate("BTCUSDT", "SELL", depth + 1.0).fillable

    # -- the measurement stays honest -------------------------------------- #
    def test_filled_notional_is_the_measured_walk_not_the_request(self):
        """The cheap way to make the comparison pass is to clamp the measurement
        to the request. That would silently turn a partial fill into a full one."""
        depth = self._bid_depth()
        walked = self._deep_book().walk("SELL", depth * 10)
        routed = self._deep_engine().route_estimate("BTCUSDT", "SELL", depth * 10)
        assert walked.filled_notional == pytest.approx(depth)
        assert routed.filled_notional == pytest.approx(depth)
        assert routed.filled_notional < depth * 10

    def test_a_fillable_walk_reports_what_it_took_not_what_was_asked(self):
        notional = 99.95002498750625 * 101.0
        est = self._deep_book().walk("SELL", notional)
        # Equal to the cent because the walk really did take it, not because the
        # request was copied over the measurement.
        assert est.filled_notional == pytest.approx(notional, abs=0.005)
        assert est.levels_consumed == 1

    # -- the mechanism ------------------------------------------------------ #
    def test_cent_rounded_legs_are_not_the_fill_decision(self):
        """The router's legs quantise to cents for display. Summing them loses up
        to half a cent per leg, which is why a three-venue route for a request off
        the cent boundary reported less routable than it had routed."""
        eng = TCAEngine(symbols=["BTCUSDT"], venues=[])

        class _Feed:
            def __init__(self, book):
                self.connected = True
                self.books = {"BTCUSDT": book}

        feeds = {}
        for i, name in enumerate(("A", "B", "C")):
            b = BookState(name, "BTCUSDT")
            b.apply_snapshot(bids=[(100.0 - i * 0.01, 3.0)], asks=[(101.0 + i * 0.01, 3.0)])
            feeds[name] = _Feed(b)
        eng.feeds = feeds

        notional = 899.0 + 1 / 3  # inside a $899.91 book, and not on a cent
        legs, _ = eng.smart_route("BTCUSDT", "SELL", notional)
        assert len(legs) == 3
        assert sum(leg.notional for leg in legs) < notional, "the rounding this guards against"
        assert eng.route_estimate("BTCUSDT", "SELL", notional).fillable

    def test_tolerance_scales_with_the_order_not_the_dollar(self):
        """A cent-scale instrument. Half a cent short would vanish inside any
        absolute epsilon generous enough for a $25M block, but here it is half a
        percent of the order and must be refused."""
        penny = BookState("T", "PENNYUSDT")
        penny.apply_snapshot(bids=[(0.01, 100.0)], asks=[(0.011, 100.0)])  # $1.00 of bids
        assert penny.walk("SELL", 1.0).fillable
        assert not penny.walk("SELL", 1.005).fillable


class TestSequenceGapDetection:
    """Bybit deltas carry every level removal, so a dropped frame silently
    corrupts the book. The check has to test the right direction."""

    def test_consecutive_updates_are_not_a_gap(self):
        from modules.tca_engine import is_sequence_gap

        assert not is_sequence_gap(100, 101)
        assert not is_sequence_gap(1, 2)

    def test_forward_gap_is_detected(self):
        """The case the original `seq < book.seq` test missed entirely."""
        from modules.tca_engine import is_sequence_gap

        assert is_sequence_gap(100, 102)
        assert is_sequence_gap(100, 500)

    def test_backward_jump_is_also_a_gap(self):
        from modules.tca_engine import is_sequence_gap

        assert is_sequence_gap(100, 99)

    def test_repeated_sequence_is_a_gap(self):
        from modules.tca_engine import is_sequence_gap

        assert is_sequence_gap(100, 100)

    def test_no_baseline_is_never_a_gap(self):
        """A fresh subscribe, or a venue that omits `u`, must not trigger a
        reconnect loop."""
        from modules.tca_engine import is_sequence_gap

        assert not is_sequence_gap(0, 1)
        assert not is_sequence_gap(100, 0)
        assert not is_sequence_gap(0, 0)

    def test_a_dropped_delta_would_leave_the_book_crossed(self):
        """Why the check matters: without it, a missed removal strands a bid
        above the ask and the UI renders it as cross-venue arbitrage."""
        book = BookState("BYBIT", "BTCUSDT")
        book.apply_snapshot(bids=[(100.0, 5.0)], asks=[(101.0, 5.0)])
        # The delta that removes the 100.0 bid is the frame that goes missing.
        book.apply_delta(bids=[], asks=[(99.0, 5.0)])  # new ask below the stale bid
        assert book.best_bid == 100.0
        assert book.best_ask == 99.0
        assert book.spread_bps < 0, "a dropped removal leaves the book crossed"


@pytest.mark.asyncio
class TestFeedHealthAlerts:
    """A venue going dark is a trading condition, not just a log line.

    Detection already existed — staleness clocks, connection flags, sequence-gap
    resubscribes — but nothing announced it, so a trader kept sizing against a
    book that had stopped updating. These tests pin the announcement, and
    specifically that it fires on the *transition*: an alert repeated every five
    seconds is one an operator learns to ignore.
    """

    def _engine(self, monkeypatch, tmp_path) -> TCAEngine:
        from modules import audit as audit_module
        from modules.audit import AuditLog
        from modules.tca_engine import VenueFeed

        store = AuditLog(tmp_path / "feed.duckdb")
        monkeypatch.setattr(audit_module, "get_audit", lambda: store)

        engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
        feed = VenueFeed(["BTCUSDT"])
        feed.name = "BINANCE"
        feed.books = {"BTCUSDT": make_book("BINANCE")}
        feed.connected = True
        engine.feeds = {"BINANCE": feed}
        engine.audit_store = store
        return engine

    async def test_first_observation_is_a_baseline_not_an_incident(self, monkeypatch, tmp_path):
        engine = self._engine(monkeypatch, tmp_path)
        alerts: list[tuple[str, str]] = []
        engine.add_alert_hook(lambda severity, message: alerts.append((severity, message)))

        await engine._check_feed_health()
        assert alerts == [], "starting up healthy is not an event worth waking anyone for"

    async def test_disconnect_then_recovery_each_alert_once(self, monkeypatch, tmp_path):
        engine = self._engine(monkeypatch, tmp_path)
        alerts: list[tuple[str, str]] = []

        async def hook(severity, message):
            alerts.append((severity, message))

        engine.add_alert_hook(hook)
        await engine._check_feed_health()  # baseline: up

        engine.feeds["BINANCE"].connected = False
        await engine._check_feed_health()
        await engine._check_feed_health()  # still down — must stay quiet
        assert len(alerts) == 1
        assert alerts[0][0] == "critical"
        assert "BINANCE" in alerts[0][1]

        engine.feeds["BINANCE"].connected = True
        await engine._check_feed_health()
        assert len(alerts) == 2
        assert alerts[1][0] == "info"

    async def test_transitions_are_audited_with_the_venue_named(self, monkeypatch, tmp_path):
        engine = self._engine(monkeypatch, tmp_path)
        await engine._check_feed_health()
        engine.feeds["BINANCE"].connected = False
        await engine._check_feed_health()

        events = engine.audit_store.recent_events(10)
        degraded = [e for e in events if e["event"] == "feed_degraded"]
        assert degraded, "a feed outage must leave an audit record"
        assert "BINANCE" in degraded[0]["detail"]

    async def test_a_broken_alert_transport_cannot_stop_ingestion(self, monkeypatch, tmp_path):
        engine = self._engine(monkeypatch, tmp_path)

        async def exploding_hook(severity, message):
            raise RuntimeError("telegram is down")

        engine.add_alert_hook(exploding_hook)
        await engine._check_feed_health()
        engine.feeds["BINANCE"].connected = False
        # Must not raise: losing the alert channel is not a reason to lose the
        # market-data loop that shares this task.
        await engine._check_feed_health()
        assert engine._feed_state["BINANCE"] == "down"

    async def test_a_stale_book_is_reported_even_while_connected(self, monkeypatch, tmp_path):
        engine = self._engine(monkeypatch, tmp_path)
        alerts: list[tuple[str, str]] = []

        async def hook(severity, message):
            alerts.append((severity, message))

        engine.add_alert_hook(hook)
        await engine._check_feed_health()

        # The socket is up, the data is not. This is the failure mode that
        # looks healthy on a connection count and is worse than a disconnect.
        book = engine.feeds["BINANCE"].books["BTCUSDT"]
        book.last_update_wall = 0.0
        await engine._check_feed_health()

        assert alerts, "a connected-but-stale venue must still raise"
        assert "stale" in alerts[0][1].lower()
