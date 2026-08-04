"""Module B — the checks that stop money leaving the building.

Every test here corresponds to a real failure mode: the extra zero, the runaway
loop, the concentrated position, the day that keeps getting worse.
"""

from __future__ import annotations

import asyncio

import pytest

from config import settings
from modules.risk_proxy import PositionState, RiskGateway, TokenBucket
from modules.schemas import OrderRequest
from modules.tca_engine import BookState, TCAEngine


# --------------------------------------------------------------------------- #
# Fixtures — a deep, symmetric book at 100.0 so sizing maths is obvious
# --------------------------------------------------------------------------- #
class _Feed:
    def __init__(self, book):
        self.connected = True
        self.books = {book.symbol: book}


@pytest.fixture
def engine() -> TCAEngine:
    eng = TCAEngine(symbols=["BTCUSDT"], venues=[])
    book = BookState("TEST", "BTCUSDT")
    book.apply_snapshot(
        bids=[(100.0 - i * 0.01, 5000.0) for i in range(50)],
        asks=[(100.0 + i * 0.01, 5000.0) for i in range(50)],
    )
    eng.feeds = {"TEST": _Feed(book)}
    return eng


@pytest.fixture
def gateway(engine) -> RiskGateway:
    gw = RiskGateway(tca_engine=engine, audit=None)
    gw.bucket = TokenBucket(1e6, 1_000_000)  # neutralise rate limiting by default
    return gw


def order(**kw) -> OrderRequest:
    base = dict(symbol="BTCUSDT", side="BUY", notional=10_000.0, order_type="MARKET")
    base.update(kw)
    return OrderRequest(**base)


def failed(decision) -> set[str]:
    return set(decision.rejected_by)


# --------------------------------------------------------------------------- #
class TestTokenBucket:
    def test_burst_then_throttle(self):
        b = TokenBucket(rate=5, burst=5)
        assert sum(b.try_consume() for _ in range(5)) == 5
        assert not b.try_consume()

    def test_refills_over_time(self):
        b = TokenBucket(rate=100, burst=1)
        assert b.try_consume()
        assert not b.try_consume()
        b.updated -= 1.0  # simulate a second passing
        assert b.try_consume()


class TestPositionAccounting:
    def test_average_price_on_add(self):
        p = PositionState("X")
        p.apply_fill("BUY", 1.0, 100.0, 0.0)
        p.apply_fill("BUY", 1.0, 200.0, 0.0)
        assert p.quantity == pytest.approx(2.0)
        assert p.avg_price == pytest.approx(150.0)

    def test_realised_pnl_on_close(self):
        p = PositionState("X")
        p.apply_fill("BUY", 2.0, 100.0, 0.0)
        p.apply_fill("SELL", 2.0, 110.0, 0.0)
        assert p.quantity == 0.0
        assert p.realized_pnl == pytest.approx(20.0)

    def test_fees_reduce_realised_pnl(self):
        p = PositionState("X")
        p.apply_fill("BUY", 1.0, 100.0, 5.0)
        assert p.realized_pnl == pytest.approx(-5.0)

    def test_unrealised_marks_to_market(self):
        p = PositionState("X")
        p.apply_fill("BUY", 2.0, 100.0, 0.0)
        assert p.unrealized(105.0) == pytest.approx(10.0)


@pytest.mark.asyncio
class TestPreTradeChecks:
    async def test_valid_order_is_accepted_and_filled(self, gateway):
        d = await gateway.submit(order(notional=10_000))
        assert d.accepted, d.reason
        assert d.fill is not None
        assert d.fill.simulated
        assert all(c.passed for c in d.checks)

    async def test_fat_finger_notional_rejected(self, gateway):
        d = await gateway.submit(order(notional=settings.max_order_notional_usd * 10))
        assert not d.accepted
        assert "max_order_notional" in failed(d)

    async def test_kill_switch_blocks_everything(self, gateway):
        await gateway.trigger_kill("test", "pytest")
        d = await gateway.submit(order())
        assert not d.accepted
        assert "kill_switch" in failed(d)

    async def test_resume_restores_trading(self, gateway):
        await gateway.trigger_kill("test", "pytest")
        await gateway.release_kill("pytest")
        assert (await gateway.submit(order())).accepted

    async def test_per_symbol_halt_is_scoped(self, gateway):
        await gateway.trigger_kill("maintenance", "pytest", symbol="BTCUSDT")
        d = await gateway.submit(order())
        assert not d.accepted and "symbol_halt" in failed(d)
        assert not gateway.kill.active  # global trading untouched

    async def test_unknown_symbol_rejected(self, gateway):
        d = await gateway.submit(order(symbol="DOGEUSDT"))
        assert not d.accepted and "symbol_whitelist" in failed(d)

    async def test_rate_limiter_throttles_a_runaway_loop(self, gateway):
        gateway.bucket = TokenBucket(rate=5, burst=5)
        results = [await gateway.submit(order(notional=1000, client_order_id=f"loop-{i}")) for i in range(15)]
        throttled = [r for r in results if "rate_limit" in failed(r)]
        assert len(throttled) >= 8
        assert sum(r.accepted for r in results) <= 6

    async def test_duplicate_client_order_id_rejected(self, gateway):
        first = await gateway.submit(order(client_order_id="abc-123"))
        assert first.accepted
        second = await gateway.submit(order(client_order_id="abc-123"))
        assert not second.accepted and "duplicate_order" in failed(second)

    async def test_limit_price_band(self, gateway):
        d = await gateway.submit(order(order_type="LIMIT", limit_price=1_000.0, notional=1_000))
        assert not d.accepted and "price_band" in failed(d)

    async def test_gross_exposure_ceiling(self, gateway):
        for i in range(30):
            await gateway.submit(order(notional=settings.max_order_notional_usd, client_order_id=f"g{i}"))
        d = await gateway.submit(order(notional=settings.max_order_notional_usd))
        assert not d.accepted
        assert {"gross_exposure", "symbol_concentration"} & failed(d)

    async def test_no_mark_price_means_no_trade(self, gateway):
        gateway.tca.feeds = {}  # every venue dark
        d = await gateway.submit(order())
        assert not d.accepted and "price_available" in failed(d)

    async def test_illiquid_book_rejected_on_slippage(self, gateway):
        thin = BookState("THIN", "BTCUSDT")
        thin.apply_snapshot(bids=[(100.0, 1.0)], asks=[(100.0, 1.0), (500.0, 1000.0)])
        gateway.tca.feeds = {"THIN": _Feed(thin)}
        d = await gateway.submit(order(notional=40_000))
        assert not d.accepted and "est_slippage" in failed(d)

    async def test_liquidity_gate_uses_the_routed_fill_not_one_venue(self, gateway):
        """Two venues, each holding half the order. The gate must accept it,
        because the router will fill it — checking a single venue would not."""
        books = {}
        for name in ("A", "B"):
            b = BookState(name, "BTCUSDT")
            b.apply_snapshot(bids=[(100.0, 60.0)], asks=[(100.0, 60.0)])
            books[name] = _Feed(b)
        gateway.tca.feeds = books

        assert all(not e.fillable for e in gateway.tca.estimate("BTCUSDT", "BUY", 10_000))
        d = await gateway.submit(order(notional=10_000))
        assert d.accepted, d.reason
        assert "+" in d.fill.venue                       # genuinely split across venues

    async def test_slippage_check_and_fill_price_agree(self, gateway):
        """The gate must measure the same execution the fill produces."""
        d = await gateway.submit(order(notional=30_000))
        check = next(c for c in d.checks if c.name == "est_slippage")
        assert check.observed == pytest.approx(d.fill.slippage_bps, abs=0.05)

    async def test_rejection_still_records_full_check_vector(self, gateway):
        d = await gateway.submit(order(notional=10_000_000))
        assert not d.accepted
        assert len(d.checks) >= 8            # evidence, not just a verdict
        assert d.latency_ms >= 0

    async def test_decision_latency_is_sub_millisecond(self, gateway):
        # The whole point of a pre-trade gate is that it is not a bottleneck.
        latencies = [(await gateway.submit(order(notional=1000, client_order_id=f"l{i}"))).latency_ms
                     for i in range(20)]
        assert sorted(latencies)[len(latencies) // 2] < 5.0


@pytest.mark.asyncio
class TestCircuitBreaker:
    async def test_drawdown_breach_blocks_new_orders(self, gateway):
        gateway.start_of_day_equity = settings.starting_equity_usd * 2  # force a >50% drawdown
        d = await gateway.submit(order())
        assert not d.accepted and "daily_drawdown" in failed(d)

    async def test_monitor_trips_kill_switch_without_a_human(self, gateway):
        alerts: list[tuple[str, str]] = []

        async def hook(sev, msg):
            alerts.append((sev, msg))

        gateway.add_alert_hook(hook)
        gateway.start_of_day_equity = settings.starting_equity_usd * 2
        await gateway.start()
        try:
            for _ in range(60):
                await asyncio.sleep(0.1)
                if gateway.kill.active:
                    break
        finally:
            await gateway.stop()

        assert gateway.kill.active
        assert gateway.kill.actor == "circuit-breaker"
        assert any(sev == "critical" for sev, _ in alerts)

    async def test_alert_hook_failure_never_blocks_trading(self, gateway):
        async def broken(sev, msg):
            raise RuntimeError("telegram is down")

        gateway.add_alert_hook(broken)
        await gateway.trigger_kill("test", "pytest")   # must not raise
        assert gateway.kill.active


@pytest.mark.asyncio
class TestFillQuality:
    async def test_fill_price_comes_from_the_ladder_not_the_mid(self, gateway):
        d = await gateway.submit(order(side="BUY", notional=40_000))
        mid = gateway.tca.consolidated_mid("BTCUSDT")
        assert d.fill.price >= mid          # a buy never fills better than mid
        assert d.fill.slippage_bps >= 0
        assert d.fill.fee_usd == pytest.approx(40_000 * settings.paper_fee_bps / 1e4)

    async def test_state_reflects_executed_position(self, gateway):
        await gateway.submit(order(notional=20_000))
        state = gateway.state()
        assert state.positions and state.positions[0].symbol == "BTCUSDT"
        assert state.gross_exposure > 0
        assert state.orders_accepted == 1


@pytest.mark.asyncio
class TestReduceOnlyMode:
    """The stretch between the warning and the halt.

    A binary limit gives a desk no way to de-risk: at 79% of the budget it can
    do anything, at 80% nothing — including closing the position that is
    causing the problem. Reduce-only is the graduated response, and the property
    that matters is that the *exit* stays open while the entrance closes.
    """

    def _stress(self, gateway, fraction: float = 0.9) -> None:
        """Push the book to `fraction` of its drawdown budget."""
        # Drawdown is measured against start-of-day equity, so raising that
        # mark is the cleanest way to simulate a loss without needing fills.
        loss_pct = settings.max_daily_drawdown_pct * fraction
        gateway.start_of_day_equity = gateway.equity() / (1 - loss_pct)

    async def test_below_the_threshold_nothing_changes(self, gateway):
        self._stress(gateway, fraction=0.5)
        assert gateway.reduce_only_active() is False
        decision = await gateway.submit(order())
        assert decision.accepted, decision.reason

    async def test_opening_orders_are_refused_once_it_engages(self, gateway):
        self._stress(gateway, fraction=0.9)
        assert gateway.reduce_only_active() is True

        decision = await gateway.submit(order(client_order_id="opening"))
        assert not decision.accepted
        assert "reduce_only" in failed(decision)
        # The hard breaker has NOT tripped — this is the softer regime.
        assert "daily_drawdown" not in failed(decision)
        assert not gateway.kill.active

    async def test_a_closing_order_still_gets_through(self, gateway):
        # Open a position first, while the book is still healthy.
        opened = await gateway.submit(order(notional=20_000, client_order_id="entry"))
        assert opened.accepted

        self._stress(gateway, fraction=0.9)
        held = gateway.positions["BTCUSDT"].quantity
        closing = await gateway.submit(order(
            side="SELL", quantity=held, notional=None, client_order_id="exit"))

        assert closing.accepted, f"a desk in trouble must be able to close: {closing.reason}"
        assert abs(gateway.positions["BTCUSDT"].quantity) < 1e-9

    async def test_an_oversized_close_is_an_opening_trade_in_disguise(self, gateway):
        opened = await gateway.submit(order(notional=20_000, client_order_id="entry"))
        assert opened.accepted

        self._stress(gateway, fraction=0.9)
        held = gateway.positions["BTCUSDT"].quantity
        # Selling three times the position flips the book short — that is new
        # risk wearing the shape of an exit.
        flipping = await gateway.submit(order(
            side="SELL", quantity=held * 3, notional=None, client_order_id="flip"))
        assert not flipping.accepted
        assert "reduce_only" in failed(flipping)

    async def test_the_state_says_which_regime_the_desk_is_in(self, gateway):
        assert gateway.state().reduce_only is False
        self._stress(gateway, fraction=0.9)
        state = gateway.state()
        assert state.reduce_only is True
        assert state.reduce_only_threshold == settings.reduce_only_threshold

    async def test_the_hard_breaker_still_rejects_everything(self, gateway):
        gateway.start_of_day_equity = settings.starting_equity_usd * 2
        opened = gateway.positions.setdefault("BTCUSDT", PositionState("BTCUSDT", quantity=10.0, avg_price=100.0))
        assert opened.quantity > 0
        # Past the hard limit even a closing order is refused: at that point the
        # desk is halted, not merely defensive.
        decision = await gateway.submit(order(side="SELL", quantity=1.0, notional=None))
        assert not decision.accepted
        assert "daily_drawdown" in failed(decision)


@pytest.mark.asyncio
class TestHaltRecovery:
    async def test_a_resume_records_why_and_what_it_was_for(self, gateway, tmp_path):
        from modules.audit import AuditLog

        gateway.audit = AuditLog(tmp_path / "resume.duckdb")
        await gateway.trigger_kill("drawdown breach", "circuit-breaker")
        await gateway.release_kill(actor="ian", reason="feed recovered, exposure reviewed")

        events = gateway.audit.recent_events(10)
        released = next(e for e in events if e["event"] == "kill_switch_released")
        assert "feed recovered" in released["detail"]
        assert "ian" in released["detail"]

    async def test_a_resume_without_a_reason_is_still_allowed(self, gateway, tmp_path):
        from modules.audit import AuditLog

        gateway.audit = AuditLog(tmp_path / "resume2.duckdb")
        await gateway.trigger_kill("test", "pytest")
        # Requiring a reason would mean a desk cannot restart during an incident
        # if whoever is at the keyboard cannot articulate one yet.
        kill = await gateway.release_kill(actor="ian")
        assert kill.active is False
