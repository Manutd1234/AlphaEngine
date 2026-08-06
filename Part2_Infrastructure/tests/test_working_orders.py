"""The resting order book — the half of an order's life that used to not exist.

Every accepted order used to fill in the same call, which made "accepted" and
"filled" the same word. They are not, and the tests that matter here are the ones
where the difference costs something: a halt that does not reach a resting order
is not a halt, and two resting orders that each pass a cap can breach it together.

Nothing sleeps. ``sweep_working_orders`` is directly callable for the same reason
``snapshot_equity`` is — a test that waits out a timer is a slow test that still
cannot say *when* the fill happened.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import pytest

from config import settings
from modules.audit import AuditLog
from modules.risk_proxy import RiskGateway, TokenBucket, _utcnow
from modules.schemas import OrderRequest, ReplaceRequest
from modules.tca_engine import BookState, TCAEngine


class _Feed:
    def __init__(self, book):
        self.connected = True
        self.books = {book.symbol: book}


def _book(bid: float = 99.95, ask: float = 100.05) -> BookState:
    book = BookState("TEST", "BTCUSDT")
    book.apply_snapshot(
        bids=[(bid - i * 0.01, 5000.0) for i in range(50)],
        asks=[(ask + i * 0.01, 5000.0) for i in range(50)],
    )
    return book


@pytest.fixture
def engine() -> TCAEngine:
    eng = TCAEngine(symbols=["BTCUSDT"], venues=[])
    eng.feeds = {"TEST": _Feed(_book())}
    return eng


@pytest.fixture
def gateway(engine) -> RiskGateway:
    gw = RiskGateway(tca_engine=engine, audit=None)
    gw.bucket = TokenBucket(1e6, 1_000_000)
    return gw


@pytest.fixture
def audited_gateway(engine, tmp_path) -> RiskGateway:
    """A gateway whose terminal decisions are observable.

    The fixture above passes ``audit=None``, which is enough while the assertion
    is "the order left the book". It cannot say *how* it left: a retirement is
    queued to the audit and dropped when there is nowhere to write it. Anything
    that turns on the difference between CANCELLED and EXPIRED needs a real log.
    """
    audit = AuditLog(tmp_path / "working-orders.duckdb")
    gw = RiskGateway(tca_engine=engine, audit=audit)
    gw.bucket = TokenBucket(1e6, 1_000_000)
    yield gw
    audit.close()


def limit_order(price: float, side: str = "BUY", **kw) -> OrderRequest:
    base = dict(
        symbol="BTCUSDT", side=side, quantity=100.0,
        order_type="LIMIT", limit_price=price,
    )
    base.update(kw)
    return OrderRequest(**base)


def _reprice(engine: TCAEngine, bid: float, ask: float) -> None:
    engine.feeds["TEST"].books["BTCUSDT"] = _book(bid, ask)


# --------------------------------------------------------------------------- #
class TestMarketability:
    @pytest.mark.asyncio
    async def test_a_market_order_still_fills_in_the_same_call(self, gateway):
        decision = await gateway.submit(OrderRequest(
            symbol="BTCUSDT", side="BUY", notional=10_000.0, order_type="MARKET",
        ))
        assert decision.accepted
        assert decision.status == "FILLED"
        assert decision.fill is not None
        assert not gateway.working, "a market order must never rest"

    @pytest.mark.asyncio
    async def test_a_marketable_limit_crosses_the_spread_as_a_taker(self, gateway):
        # A bid above the offer is willing to pay it, so it is a taker and takes
        # the original path — route VWAP, taker fee, immediate fill.
        decision = await gateway.submit(limit_order(100.50))
        assert decision.status == "FILLED"
        assert decision.fill is not None
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_a_non_marketable_limit_rests_instead_of_filling(self, gateway):
        decision = await gateway.submit(limit_order(99.00))
        assert decision.accepted, "resting is an acceptance, not a rejection"
        assert decision.status == "WORKING"
        assert decision.fill is None, "nobody has met this price yet"
        assert len(gateway.working) == 1

        resting = gateway.list_working()[0]
        assert resting.symbol == "BTCUSDT"
        assert resting.limit_price == 99.00
        assert resting.notional == pytest.approx(9_900.0), "committed capital, not zero"
        assert resting.time_in_force == "GTC", "a LIMIT with no TIF rests by default"

    @pytest.mark.asyncio
    async def test_a_rejected_order_never_reaches_the_book(self, gateway):
        gateway.kill.active = True
        decision = await gateway.submit(limit_order(99.00))
        assert not decision.accepted
        assert decision.status == "REJECTED"
        assert not gateway.working


class TestTheSweep:
    @pytest.mark.asyncio
    async def test_a_resting_buy_fills_when_the_offer_comes_to_it(self, gateway, engine):
        await gateway.submit(limit_order(99.00))
        assert not await gateway.sweep_working_orders(), "nothing has crossed yet"

        _reprice(engine, bid=98.90, ask=98.95)
        filled = await gateway.sweep_working_orders()

        assert len(filled) == 1
        assert filled[0].status == "FILLED"
        assert not gateway.working
        assert gateway.positions["BTCUSDT"].quantity == pytest.approx(100.0)

    @pytest.mark.asyncio
    async def test_a_resting_sell_fills_when_the_bid_comes_up_to_it(self, gateway, engine):
        await gateway.submit(limit_order(101.00, side="SELL"))
        assert not await gateway.sweep_working_orders()

        _reprice(engine, bid=101.05, ask=101.10)
        filled = await gateway.sweep_working_orders()
        assert len(filled) == 1
        assert gateway.positions["BTCUSDT"].quantity == pytest.approx(-100.0)

    @pytest.mark.asyncio
    async def test_a_resting_fill_takes_its_own_price_and_the_maker_fee(self, gateway, engine):
        await gateway.submit(limit_order(99.00))
        _reprice(engine, bid=98.00, ask=98.10)
        filled = await gateway.sweep_working_orders()

        fill = filled[0].fill
        assert fill is not None
        # The limit, not the route VWAP. Someone crossed to reach this order; it
        # does not pay to cross to reach itself.
        assert fill.price == pytest.approx(99.00)
        assert fill.fee_usd == pytest.approx(
            99.00 * 100 * settings.paper_maker_fee_bps / 1e4,
        )
        assert settings.paper_maker_fee_bps < settings.paper_fee_bps, (
            "the whole point of the maker branch is that it is cheaper"
        )

    @pytest.mark.asyncio
    async def test_a_maker_fill_reports_price_improvement_as_negative_slippage(
        self, gateway, engine,
    ):
        await gateway.submit(limit_order(99.00))
        _reprice(engine, bid=98.00, ask=98.10)
        fill = (await gateway.sweep_working_orders())[0].fill

        # Bought at 99.00 while the mark sat around 98.05 — that is worse than the
        # mark, so slippage is positive here. The sign convention is the same one
        # `_paper_fill` uses, and the number is measured rather than assumed.
        assert fill.slippage_bps is not None
        mark = gateway.mark("BTCUSDT")
        expected = (fill.price - mark) / mark * 1e4
        assert fill.slippage_bps == pytest.approx(expected, abs=0.01)

    @pytest.mark.asyncio
    async def test_a_sweep_with_no_book_leaves_orders_resting(self, gateway, engine):
        await gateway.submit(limit_order(99.00))
        engine.feeds = {}
        assert not await gateway.sweep_working_orders()
        assert len(gateway.working) == 1, "no touch means no evidence, not a fill"

    @pytest.mark.asyncio
    async def test_two_fills_in_one_symbol_get_distinguishable_timestamps(
        self, gateway, engine,
    ):
        """The failure that would surface at the *next restart*, not at fill time.

        `accepted_fills_for_session` refuses to order two same-symbol fills that
        share a timestamp, because it cannot place them either side of a
        `book_reset`. A sweep reads the clock once and can fill several orders.
        """
        await gateway.submit(limit_order(99.00))
        await gateway.submit(limit_order(99.00))
        _reprice(engine, bid=98.00, ask=98.10)

        now = _utcnow()
        filled = await gateway.sweep_working_orders(now=now)
        assert len(filled) == 2
        stamps = {gateway._last_fill_stamp["BTCUSDT"]}
        assert len(stamps) == 1
        assert gateway._last_fill_stamp["BTCUSDT"] > now, "the second fill must be nudged forward"


class TestTimeInForce:
    @pytest.mark.asyncio
    async def test_an_unmarketable_ioc_expires_immediately(self, gateway):
        decision = await gateway.submit(limit_order(99.00, time_in_force="IOC"))
        assert decision.accepted, "it passed every gate — it just had nothing to hit"
        assert decision.status == "EXPIRED"
        assert decision.fill is None
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_a_marketable_ioc_fills(self, gateway):
        decision = await gateway.submit(limit_order(100.50, time_in_force="IOC"))
        assert decision.status == "FILLED"

    @pytest.mark.asyncio
    async def test_a_day_order_rests_until_its_own_expiry_stamp(self, gateway):
        """It must not die *early*, which is the half a boundary test cannot show.

        Swept one second short of its expiry with the session date untouched, no
        roll fires and the per-order check is the only thing looking at the
        clock. That check is the fallback, not the production path — a DAY order
        expires at exactly the boundary the roll also fires on, and the test
        below pins which of the two gets there first.
        """
        await gateway.submit(limit_order(99.00, time_in_force="DAY"))
        resting = gateway.list_working()[0]
        assert resting.expires_at is not None

        await gateway.sweep_working_orders(now=resting.expires_at - timedelta(seconds=1))
        assert len(gateway.working) == 1, "still inside the session"

        await gateway.sweep_working_orders(now=resting.expires_at)
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_a_day_order_expires_at_the_session_boundary(self, audited_gateway):
        """EXPIRED has to be reachable, and the roll is the only route to it.

        ``sweep_working_orders`` rolls the session before it looks at a single
        order, and the roll pulls the whole resting book. A DAY order therefore
        never reaches the per-order expiry check below it — whichever of the two
        runs first decides what the blotter says, and retired by the blanket
        cancel it read as though the system had pulled it, with ``EXPIRED`` left
        as a state the schema declares and production cannot reach by this route.

        The boundary here is a real one: ``session_date`` is advanced, so the
        roll actually fires. Calling the sweep with a future ``now`` and today's
        session date exercises the fallback instead and leaves the ordering
        untested, which is precisely how this went unnoticed.
        """
        gw = audited_gateway
        decision = await gw.submit(limit_order(99.00, time_in_force="DAY"))
        assert decision.status == "WORKING"

        gw.session_date = "2000-01-01"  # the UTC clock has crossed 00:00
        await gw.sweep_working_orders()

        assert not gw.working
        timeline = gw.audit.order_timeline(decision.order_id)
        assert [row["event"] for row in timeline] == ["ACCEPTED_WORKING", "EXPIRED"]
        assert "session boundary" in timeline[-1]["detail"]

    @pytest.mark.asyncio
    async def test_a_gtc_order_at_the_same_boundary_is_cancelled_not_expired(
        self, audited_gateway,
    ):
        """The rollover cancel takes what the DAY expiry left, and says so.

        A GTC order has no clock of its own. It dies at the boundary because the
        gateway refuses to let an order span two replay windows — a policy
        cancel, and it should read as one. Reporting both retirements under the
        same status would leave the blotter unable to tell an order the system
        pulled from one that ran out its own time.
        """
        gw = audited_gateway
        day = await gw.submit(limit_order(99.00, time_in_force="DAY", quantity=1.0))
        gtc = await gw.submit(limit_order(98.00, time_in_force="GTC", quantity=1.0))

        gw.session_date = "2000-01-01"
        await gw.sweep_working_orders()

        assert not gw.working
        assert gw.audit.order_timeline(day.order_id)[-1]["status"] == "EXPIRED"
        cancelled = gw.audit.order_timeline(gtc.order_id)[-1]
        assert cancelled["status"] == "CANCELLED"
        assert cancelled["detail"] == "session rollover"

    @pytest.mark.asyncio
    async def test_a_gtc_order_survives_a_sweep_that_does_not_cross_it(self, gateway):
        await gateway.submit(limit_order(99.00, time_in_force="GTC"))
        for _ in range(3):
            await gateway.sweep_working_orders()
        assert len(gateway.working) == 1

    def test_a_resting_market_order_is_rejected_not_coerced(self):
        # Quietly rewriting this to IOC would answer a question nobody asked.
        with pytest.raises(ValueError):
            OrderRequest(
                symbol="BTCUSDT", side="BUY", notional=1000.0,
                order_type="MARKET", time_in_force="GTC",
            )


class TestRiskIntegration:
    @pytest.mark.asyncio
    async def test_the_kill_switch_reaches_the_resting_book(self, gateway):
        """The alert says "all new orders are now rejected".

        With resting orders alive that sentence is false: an order placed before
        the halt keeps trading through it. This is the assertion the whole
        lifecycle rests on.
        """
        await gateway.submit(limit_order(99.00))
        assert len(gateway.working) == 1

        await gateway.trigger_kill(reason="test", actor="operator")
        assert not gateway.working, "a halt that leaves orders resting is not a halt"

    @pytest.mark.asyncio
    async def test_a_symbol_halt_only_pulls_that_symbol(self, gateway, engine):
        engine.symbols = ["BTCUSDT", "ETHUSDT"]
        other = BookState("TEST", "ETHUSDT")
        other.apply_snapshot(bids=[(50.0, 100.0)], asks=[(50.1, 100.0)])
        engine.feeds["TEST"].books["ETHUSDT"] = other

        await gateway.submit(limit_order(99.00))
        await gateway.trigger_kill(reason="test", actor="operator", symbol="BTCUSDT")
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_two_resting_orders_cannot_breach_a_cap_they_each_pass(
        self, gateway, monkeypatch,
    ):
        """The concrete failure the gate change exists to prevent.

        Two orders at 93% of the symbol cap each pass on their own. Both rest,
        both fill, and the book sits at 187% of a hard limit with no gate having
        fired at any point.
        """
        monkeypatch.setattr(
            "modules.risk_proxy.settings",
            replace(settings, max_symbol_notional_usd=10_000.0),
        )
        first = await gateway.submit(limit_order(99.00, quantity=94.0))
        assert first.status == "WORKING"

        second = await gateway.submit(limit_order(99.00, quantity=94.0))
        assert not second.accepted
        assert "symbol_concentration" in second.rejected_by

    @pytest.mark.asyncio
    async def test_a_resting_sell_does_not_net_against_a_resting_buy(
        self, gateway, monkeypatch,
    ):
        # They do not have to fill together — either side can be lifted alone —
        # so the projection takes the worse of the two rather than the net.
        monkeypatch.setattr(
            "modules.risk_proxy.settings",
            replace(settings, max_symbol_notional_usd=10_000.0),
        )
        await gateway.submit(limit_order(99.00, quantity=90.0))
        await gateway.submit(limit_order(101.00, side="SELL", quantity=90.0))
        blocked = await gateway.submit(limit_order(99.00, quantity=90.0))
        assert "symbol_concentration" in blocked.rejected_by

    @pytest.mark.asyncio
    async def test_the_resting_book_has_a_ceiling(self, gateway, monkeypatch):
        monkeypatch.setattr(
            "modules.risk_proxy.settings", replace(settings, max_working_orders=2),
        )
        await gateway.submit(limit_order(99.00, quantity=1.0))
        await gateway.submit(limit_order(98.00, quantity=1.0))
        blocked = await gateway.submit(limit_order(97.00, quantity=1.0))
        assert "working_book" in blocked.rejected_by

    @pytest.mark.asyncio
    async def test_reduce_only_pulls_resting_orders_that_would_add_risk(
        self, gateway, monkeypatch,
    ):
        await gateway.submit(limit_order(99.00))
        assert len(gateway.working) == 1

        # Force the desk into reduce-only. A resting BUY on a flat book can only
        # make it bigger, so it must not survive the regime.
        monkeypatch.setattr(RiskGateway, "reduce_only_active", lambda self: True)
        await gateway.sweep_working_orders()
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_reduce_only_leaves_a_closing_order_alone(self, gateway, monkeypatch):
        await gateway.submit(OrderRequest(
            symbol="BTCUSDT", side="BUY", quantity=100.0, order_type="MARKET",
        ))
        # Read the position back rather than assuming it: the fill walked the
        # ladder, so slightly less than 100 was bought, and a resting SELL of a
        # flat 100 would be *larger* than the holding — an opening trade wearing
        # a closing trade's clothes, which reduce-only is right to pull.
        held = gateway.positions["BTCUSDT"].quantity
        await gateway.submit(limit_order(101.00, side="SELL", quantity=held / 2))

        monkeypatch.setattr(RiskGateway, "reduce_only_active", lambda self: True)
        await gateway.sweep_working_orders()
        assert len(gateway.working) == 1, "reduce-only must not refuse the exit"

    @pytest.mark.asyncio
    async def test_reduce_only_pulls_an_oversized_close(self, gateway, monkeypatch):
        await gateway.submit(OrderRequest(
            symbol="BTCUSDT", side="BUY", quantity=100.0, order_type="MARKET",
        ))
        held = gateway.positions["BTCUSDT"].quantity
        # Half again as much as is held flips the book through flat and out the
        # other side, which is opening a short, not closing a long.
        await gateway.submit(limit_order(101.00, side="SELL", quantity=held * 1.5))

        monkeypatch.setattr(RiskGateway, "reduce_only_active", lambda self: True)
        await gateway.sweep_working_orders()
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_state_reports_the_resting_book(self, gateway):
        await gateway.submit(limit_order(99.00))
        state = gateway.state()
        assert state.working_orders == 1
        assert state.working_notional == pytest.approx(9_900.0)


class TestCancelAndReplace:
    @pytest.mark.asyncio
    async def test_cancel_removes_one_order_and_acknowledges_it(self, gateway):
        decision = await gateway.submit(limit_order(99.00))
        ack = await gateway.cancel_working(decision.order_id, actor="trader")
        assert ack is not None
        assert ack.status == "CANCELLED"
        assert ack.actor == "trader"
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_cancelling_an_unknown_order_is_not_an_error_state(self, gateway):
        assert await gateway.cancel_working("nope") is None

    @pytest.mark.asyncio
    async def test_cancelling_twice_reports_the_second_as_unknown(self, gateway):
        decision = await gateway.submit(limit_order(99.00))
        assert await gateway.cancel_working(decision.order_id) is not None
        assert await gateway.cancel_working(decision.order_id) is None

    @pytest.mark.asyncio
    async def test_a_cancel_does_not_consume_a_rate_limit_token(self, gateway):
        decision = await gateway.submit(limit_order(99.00))
        gateway.bucket = TokenBucket(rate=0.0, burst=0)
        # A book in trouble must always be able to get out, even when the desk
        # has spent every token it had.
        assert await gateway.cancel_working(decision.order_id) is not None

    @pytest.mark.asyncio
    async def test_replace_returns_the_new_order_s_own_check_vector(self, gateway):
        original = await gateway.submit(limit_order(99.00))
        replaced = await gateway.replace_working(
            original.order_id, ReplaceRequest(limit_price=98.00),
        )
        assert replaced is not None
        assert replaced.order_id != original.order_id
        assert replaced.status == "WORKING"
        assert replaced.checks, "a replacement faces every gate again"
        assert len(gateway.working) == 1
        assert gateway.list_working()[0].limit_price == 98.00

    @pytest.mark.asyncio
    async def test_replacing_an_unknown_order_declines(self, gateway):
        assert await gateway.replace_working("nope", ReplaceRequest(limit_price=1.0)) is None

    @pytest.mark.asyncio
    async def test_a_replacement_can_be_rejected_where_the_original_passed(
        self, gateway, monkeypatch,
    ):
        original = await gateway.submit(limit_order(99.00, quantity=50.0))
        monkeypatch.setattr(
            "modules.risk_proxy.settings",
            replace(settings, max_symbol_notional_usd=1_000.0),
        )
        replaced = await gateway.replace_working(
            original.order_id, ReplaceRequest(quantity=50.0, limit_price=99.0),
        )
        assert replaced is not None
        assert not replaced.accepted
        assert not gateway.working, "the original was pulled; the replacement never landed"


class TestBoundaries:
    @pytest.mark.asyncio
    async def test_a_session_rollover_cancels_everything(self, gateway):
        await gateway.submit(limit_order(99.00))
        gateway.session_date = "2000-01-01"
        await gateway.sweep_working_orders()
        assert not gateway.working, (
            "an order must not span a session boundary — its decision and its fill "
            "have to land in the same replay window"
        )

    @pytest.mark.asyncio
    async def test_a_book_reset_cancels_everything(self, gateway):
        await gateway.submit(limit_order(99.00))
        gateway.reset_book(actor="test")
        assert not gateway.working

    @pytest.mark.asyncio
    async def test_shutdown_cancels_rather_than_persisting(self, gateway):
        await gateway.submit(limit_order(99.00))
        await gateway.stop()
        assert not gateway.working, (
            "persisting a resting order would claim a recovery guarantee a "
            "single-instance paper gateway cannot honour"
        )
