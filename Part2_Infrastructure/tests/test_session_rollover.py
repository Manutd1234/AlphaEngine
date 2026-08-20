"""The UTC session boundary — the one moment the book is rewritten by a clock.

Nothing here is triggered by an order. At midnight UTC the gateway banks the
closing session's realized P&L, zeroes the per-position counters so "realized"
keeps meaning "today", and re-marks the drawdown baseline. Three numbers move at
once, and the order they move in is the entire test surface: a desk that opens
the new session at anything other than flat has been handed, or charged, money
it never traded.

The failure this file pins used to be silent. `start_of_day_equity` was captured
*before* the per-position counters were zeroed, so `equity()` immediately fell by
the closing session's realized P&L while the baseline still contained it. Day two
opened at -R. A profitable Monday could put Tuesday into reduce-only — or trip the
breaker — on a book that had not sent an order; a losing Monday opened Tuesday
with +R of profit nobody made, quietly refunding a drawdown budget that had in
fact been spent.

Fixing the ordering moved the discontinuity rather than closing it. The banked
carry lived in memory, so a process restarted after any rollover came back with
nothing banked and republished an equity lower by exactly that amount — a step
*inside* one session's equity curve, where no panel can explain it — and
re-anchored the drawdown baseline to the configured starting equity, handing back
budget a losing session had already spent. `TestRestartsAcrossTheBoundary` is
where that half is pinned, and it is the reason the tests down there run against
a real audit log: with `audit=None` both restore paths return on their first line
and every assertion checks the constructor's defaults against themselves.

The clock is mocked only where the audit forces it. `_roll_session_if_needed`
compares two date strings, so most tests move the session the gateway thinks it
is in and call it — the same code path the monitor loop takes at midnight,
without waiting for midnight. The restart tests cannot: the rows a restart
replays are keyed on the timestamp the *clock* stamped them with, so a day-one
fill written under today's clock would be replayed into day two and counted
twice. Those tests move the clock instead of the label.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from conftest import deep_book, stub_feed

import modules.risk_proxy as risk_proxy
from config import settings
from modules.audit import AuditLog
from modules.portfolio import build_portfolio
from modules.risk_proxy import PositionState, RiskGateway, TokenBucket
from modules.schemas import OrderRequest
from modules.tca_engine import TCAEngine


@pytest.fixture
def engine() -> TCAEngine:
    eng = TCAEngine(symbols=["BTCUSDT"], venues=[])
    eng.feeds = {"TEST": stub_feed("TEST", deep_book("BTCUSDT", mid=100.0))}
    return eng


@pytest.fixture
def gateway(engine) -> RiskGateway:
    gw = RiskGateway(tca_engine=engine, audit=None)
    gw.bucket = TokenBucket(1e6, 1_000_000)  # the rate limiter is not what is under test
    return gw


class _Clock:
    """A UTC clock the test can move, because the gateway reads one to pick the day.

    Offsetting a real ``now`` rather than freezing a fixed instant keeps every
    row inside the session window the audit queries with, which a hard-coded
    date would only be for one day.
    """

    def __init__(self) -> None:
        self.offset = timedelta()

    def __call__(self) -> datetime:
        return datetime.now(timezone.utc) + self.offset


@pytest.fixture
def clock(monkeypatch) -> _Clock:
    """Patch every submodule that binds the clock, not just the package.

    One `setattr(risk_proxy, "_utcnow", ...)` worked while this was a module.
    As a package each submodule binds the name directly, so that patch set an
    attribute nothing reads and the fixture silently stopped moving time. The
    count assertion turns "matched nothing" into a red test.
    """
    moving = _Clock()
    bound = [m for m in vars(risk_proxy).values()
             if getattr(m, "__name__", "").startswith("modules.risk_proxy")
             and hasattr(m, "_utcnow")]
    assert len(bound) >= 3, f"clock fixture reached only {len(bound)} modules"
    for module in bound:
        monkeypatch.setattr(module, "_utcnow", moving)
    return moving


class _Desk:
    """One audit database, and as many gateway processes over it as a test needs.

    ``boot()`` *is* the restart: the file on disk survives, everything the old
    process held in memory does not. Anything the second gateway knows, it read
    back.
    """

    def __init__(self, path: Path, engine: TCAEngine) -> None:
        self._path = path
        self._engine = engine
        self.audit: AuditLog | None = None

    def boot(self) -> RiskGateway:
        self.close()
        self.audit = AuditLog(self._path)
        gw = RiskGateway(tca_engine=self._engine, audit=self.audit)
        gw.bucket = TokenBucket(1e6, 1_000_000)
        return gw

    def close(self) -> None:
        if self.audit is not None:
            self.audit.close()
            self.audit = None


@pytest.fixture
def desk(tmp_path, engine, clock) -> _Desk:
    made = _Desk(tmp_path / "sessions.duckdb", engine)
    yield made
    made.close()


def _market(side: str, **kw) -> OrderRequest:
    base = dict(symbol="BTCUSDT", side=side, notional=20_000.0, order_type="MARKET")
    base.update(kw)
    return OrderRequest(**base)


def _reprice(engine: TCAEngine, mid: float) -> None:
    engine.feeds["TEST"].books["BTCUSDT"] = deep_book("BTCUSDT", mid=mid)


def _cross_the_boundary(gateway: RiskGateway) -> None:
    """Age the gateway into a closed session, then let it notice.

    Equivalent to the monitor loop reaching 00:00 UTC: the rollover is a string
    comparison against today's date, so backdating the session the gateway
    believes it is in exercises exactly the production path.
    """
    gateway.session_date = "2000-01-01"
    gateway._roll_session_if_needed()


async def _trade_a_session(gateway, engine, *, close_at: float, tag: str) -> float:
    """Open at 100, mark to ``close_at``, close flat. Returns the session's realized P&L.

    Deliberately end-to-end through ``submit``: the fees and the ladder walk are
    part of the number that has to survive the boundary, and a hand-written
    realized figure would prove the arithmetic against itself.
    """
    entry = await gateway.submit(_market("BUY", client_order_id=f"{tag}-open"))
    assert entry.accepted, entry.reason

    _reprice(engine, close_at)
    held = gateway.positions["BTCUSDT"].quantity
    exit_ = await gateway.submit(
        _market("SELL", quantity=held, notional=None, client_order_id=f"{tag}-close")
    )
    assert exit_.accepted, exit_.reason
    assert abs(gateway.positions["BTCUSDT"].quantity) < 1e-9, "the session has to end flat"

    _reprice(engine, 100.0)  # next session opens on the same mark this one did
    return gateway.realized_pnl()


def _closed_session(gateway: RiskGateway, realized: float) -> None:
    """A session that ended flat having realized ``realized``.

    Written straight onto the position book rather than traded, because these
    figures are sized against the drawdown budget — 4% of a $1M book engages
    reduce-only — and reaching $45k of P&L under a $50k per-order cap would need
    a price move nobody would believe. The test would then be about the ladder
    rather than about the boundary.
    """
    gateway.positions["BTCUSDT"] = PositionState("BTCUSDT", realized_pnl=realized)


# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestTheBoundaryItself:
    async def test_day_two_opens_flat_after_a_winning_day(self, gateway, engine):
        realized = await _trade_a_session(gateway, engine, close_at=110.0, tag="mon")
        assert realized > 0, "the fixture has to actually make money for this to mean anything"
        assert gateway.daily_pnl() == pytest.approx(realized, abs=1e-6)

        _cross_the_boundary(gateway)

        # The whole contract: a session that has not traded has made and lost
        # nothing, whatever the one before it did.
        assert gateway.daily_pnl() == pytest.approx(0.0, abs=1e-9)
        assert gateway.realized_pnl() == pytest.approx(0.0, abs=1e-9)

    async def test_day_two_opens_flat_after_a_losing_day(self, gateway, engine):
        """The sign that used to flatter the book rather than embarrass it.

        A losing session left its (negative) realized P&L in the old baseline, so
        the new session opened at *positive* daily P&L — a desk that had just
        spent part of its drawdown budget was shown it back with interest. A
        wrong number that reads as good news is the one nobody reports.
        """
        realized = await _trade_a_session(gateway, engine, close_at=90.0, tag="mon")
        assert realized < 0
        assert gateway.daily_pnl() == pytest.approx(realized, abs=1e-6)

        _cross_the_boundary(gateway)

        assert gateway.daily_pnl() == pytest.approx(0.0, abs=1e-9)
        assert gateway.daily_pnl() < 1e-9, "yesterday's loss must not reappear as today's profit"

    async def test_equity_does_not_jump_at_the_boundary(self, gateway, engine):
        """A paper account that forgets it made money is a different bug, not a fix.

        Zeroing per-session P&L is a reporting decision. It must not be an
        accounting one: the money is still in the account at 00:00:01.
        """
        realized = await _trade_a_session(gateway, engine, close_at=110.0, tag="mon")
        before = gateway.equity()

        _cross_the_boundary(gateway)

        assert gateway.equity() == pytest.approx(before, abs=1e-9)
        assert gateway.equity() == pytest.approx(settings.starting_equity_usd + realized, abs=1e-9)
        assert gateway.start_of_day_equity == pytest.approx(before, abs=1e-9)

    async def test_a_losing_session_is_not_forgiven_by_the_boundary(self, gateway, engine):
        """The other half of continuity: the account is genuinely smaller.

        Opening day two flat must not mean opening it at the original starting
        equity — that would let a desk erase a bad session by waiting.
        """
        realized = await _trade_a_session(gateway, engine, close_at=90.0, tag="mon")

        _cross_the_boundary(gateway)

        assert gateway.equity() == pytest.approx(settings.starting_equity_usd + realized, abs=1e-9)
        assert gateway.equity() < settings.starting_equity_usd
        assert gateway.start_of_day_equity < settings.starting_equity_usd

    async def test_an_open_position_carries_its_mark_not_its_pnl(self, gateway, engine):
        """Yesterday's paper gain belongs to yesterday; today owns the move from here.

        An open position survives the boundary, so its unrealized P&L is already
        in the opening balance. Counting it into day two as well would let one
        price move be earned twice.
        """
        entry = await gateway.submit(_market("BUY", client_order_id="carry"))
        assert entry.accepted, entry.reason
        _reprice(engine, 105.0)
        marked = gateway.unrealized_pnl()
        assert marked > 0
        before = gateway.equity()

        _cross_the_boundary(gateway)

        assert gateway.unrealized_pnl() == pytest.approx(marked, abs=1e-9)
        assert gateway.equity() == pytest.approx(before, abs=1e-9)
        assert gateway.daily_pnl() == pytest.approx(0.0, abs=1e-9)

        held = gateway.positions["BTCUSDT"].quantity
        _reprice(engine, 106.0)
        assert gateway.daily_pnl() == pytest.approx(held * 1.0, abs=1e-6)

    async def test_the_state_payload_reports_the_session_not_the_lifetime(self, gateway, engine):
        """`realized_pnl` on the wire means *this session*, and keeps meaning it.

        The blotter, the attribution table and the state header all read that
        field. If the boundary left a lifetime figure there, every downstream
        surface would silently change units once a day.
        """
        await _trade_a_session(gateway, engine, close_at=110.0, tag="mon")
        _cross_the_boundary(gateway)

        state = gateway.state()
        assert state.realized_pnl == pytest.approx(0.0, abs=1e-9)
        assert state.daily_pnl == pytest.approx(0.0, abs=1e-9)
        assert state.equity > settings.starting_equity_usd, "the session reset, not the account"
        assert state.session_date == gateway.session_date

    async def test_the_state_payload_still_reconciles_after_a_boundary(self, gateway, engine):
        """`equity = starting + carried + realized + unrealized`, with every term named.

        `realized_pnl` on the wire means *this session*, so from the first
        rollover onward equity exceeds `starting + realized + unrealized` by
        whatever the closed sessions banked. While that term had no name the
        payload published two numbers that did not add up and gave a reader no
        way to find out why — which reads as a bug in whichever of them they
        trusted less.
        """
        realized = await _trade_a_session(gateway, engine, close_at=110.0, tag="mon")
        _cross_the_boundary(gateway)
        entry = await gateway.submit(_market("BUY", client_order_id="tue"))
        assert entry.accepted, entry.reason
        _reprice(engine, 103.0)

        state = gateway.state()
        assert state.carried_realized_pnl == pytest.approx(realized, abs=1e-9)
        assert state.equity == pytest.approx(
            settings.starting_equity_usd
            + state.carried_realized_pnl
            + state.realized_pnl
            + state.unrealized_pnl,
            abs=1e-6,
        )
        # And the term is doing work rather than decorating: dropped, the
        # identity is off by exactly one session's money.
        without_it = (
            settings.starting_equity_usd + state.realized_pnl + state.unrealized_pnl
        )
        assert state.equity - without_it == pytest.approx(realized, abs=1e-6)

    async def test_the_portfolio_equity_block_names_the_banked_term(self, gateway, engine):
        """A PM reading the equity block can account for every dollar in `current`.

        Asserted here rather than in `tests/test_portfolio.py` because the term
        only becomes non-zero at a boundary, and a portfolio fixture that never
        crosses one would pin the field at 0.0 forever — green whatever the
        gateway did with it.
        """
        realized = await _trade_a_session(gateway, engine, close_at=110.0, tag="mon")
        _cross_the_boundary(gateway)

        equity = build_portfolio(gateway, None)["equity"]

        assert equity["banked_prior_sessions"] == pytest.approx(realized, abs=0.01)
        assert equity["current"] == pytest.approx(
            settings.starting_equity_usd
            + equity["banked_prior_sessions"]
            + equity["realized_pnl"]
            + equity["unrealized_pnl"],
            abs=0.05,
        )


@pytest.mark.asyncio
class TestTheDrawdownBudget:
    async def test_a_fresh_session_opens_with_its_budget_unspent(self, gateway):
        _closed_session(gateway, realized=-45_000.0)  # 4.5% of a $1M book: deep in reduce-only
        assert gateway.daily_drawdown_pct() == pytest.approx(0.045)
        assert gateway.reduce_only_active() is True

        _cross_the_boundary(gateway)

        assert gateway.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-12)
        assert gateway.reduce_only_active() is False

    async def test_the_morning_after_a_bad_day_still_accepts_an_opening_order(self, gateway):
        """A defensive regime that outlives its session is a regime nobody can exit."""
        _closed_session(gateway, realized=-45_000.0)
        blocked = await gateway.submit(_market("BUY", client_order_id="day-one"))
        assert not blocked.accepted
        assert "reduce_only" in set(blocked.rejected_by)

        _cross_the_boundary(gateway)

        fresh = await gateway.submit(_market("BUY", client_order_id="day-two"))
        assert fresh.accepted, fresh.reason

    async def test_a_winning_day_does_not_open_the_next_one_in_the_hole(self, gateway):
        """The profitable session was the dangerous one.

        Under the old ordering the baseline kept the profit and `equity()` dropped
        it, so the better the day, the deeper the phantom drawdown it opened the
        next one with: $45k of profit read as 4.5% of budget spent, and the desk
        started in reduce-only having sent nothing.
        """
        _closed_session(gateway, realized=45_000.0)
        assert gateway.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-12)

        _cross_the_boundary(gateway)

        assert gateway.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-12)
        assert gateway.reduce_only_active() is False
        opening = await gateway.submit(_market("BUY", client_order_id="day-two"))
        assert opening.accepted, opening.reason

    async def test_the_budget_is_measured_against_the_new_balance(self, gateway):
        """Drawdown is a fraction of what the desk has *now*, not of what it started with.

        After a losing session the same dollar loss is a larger share of a smaller
        account. Anchoring the budget to the original starting equity forever would
        make the guard progressively looser exactly as the book got weaker.
        """
        _closed_session(gateway, realized=-200_000.0)
        _cross_the_boundary(gateway)

        assert gateway.start_of_day_equity == pytest.approx(800_000.0)
        gateway.positions["BTCUSDT"] = PositionState("BTCUSDT", realized_pnl=-36_000.0)
        # 4.5% of 800k, not the 3.6% it would be against the original million.
        assert gateway.daily_drawdown_pct() == pytest.approx(0.045)
        assert gateway.reduce_only_active() is True


@pytest.mark.asyncio
class TestASequenceOfSessions:
    async def test_three_sessions_stay_coherent(self, gateway, engine):
        """One boundary being right is an accident; the invariant has to hold every night.

        Win, lose, win. After each rollover the session is flat and the account
        equals its starting balance plus everything banked so far — an error that
        only accumulated on the second or third boundary would look exactly like a
        correct fix on the first.
        """
        opening = gateway.equity()
        banked = 0.0

        for tag, close_at in (("mon", 110.0), ("tue", 95.0), ("wed", 104.0)):
            realized = await _trade_a_session(gateway, engine, close_at=close_at, tag=tag)
            assert gateway.daily_pnl() == pytest.approx(realized, abs=1e-6), f"{tag} intraday"
            banked += realized

            _cross_the_boundary(gateway)

            assert gateway.daily_pnl() == pytest.approx(0.0, abs=1e-9), f"{tag} rollover"
            assert gateway.realized_pnl() == pytest.approx(0.0, abs=1e-9), f"{tag} session reset"
            assert gateway.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-12), f"{tag} budget"
            assert gateway.equity() == pytest.approx(opening + banked, abs=1e-6), f"{tag} equity"

        assert gateway.carried_realized_pnl == pytest.approx(banked, abs=1e-6)
        assert banked > 0, "two up days and one down day is a profitable week"


class TestFreshProcessesAndResets:
    """Both paths that start an account from nothing, which must agree with the boundary."""

    def test_a_fresh_gateway_carries_nothing(self, desk):
        """No boundary behind it means nothing banked — and that is a claim about the log.

        The carry is durable, so opening at zero is not a property of the
        constructor: it is what the audit says. There is no `session_rollover`
        record for today, so no session has closed, and 0.0 against the
        configured starting equity is the only pair consistent with a replay that
        covers today and nothing else. Any other opening carry would be money
        nobody banked.

        Note what this does *not* say. The session-scoped replay is the reason a
        carry is safe, not a reason it must be zero: `carried_realized_pnl` holds
        *prior* sessions' realized P&L, so it cannot double-count today's fills —
        they are the only ones being replayed. And a zero carry is not the safe
        default it looks like. After a rollover it is the value that moves equity
        without a trade, which is exactly what `TestRestartsAcrossTheBoundary`
        below refuses to allow.

        Given a real audit deliberately. With `audit=None` both restore paths
        return on their first line and this asserts the constructor's defaults
        against themselves — which is how the durable-carry gap survived a green
        suite.
        """
        gw = desk.boot()

        assert desk.audit.latest_session_rollover(gw.session_date) is None, (
            "the premise: nothing has closed yet"
        )
        assert gw.carried_realized_pnl == 0.0
        assert gw.start_of_day_equity == pytest.approx(settings.starting_equity_usd)
        assert gw.equity() == pytest.approx(settings.starting_equity_usd)
        assert gw.daily_pnl() == pytest.approx(0.0)
        assert gw.daily_drawdown_pct() == pytest.approx(0.0)

    def test_a_book_reset_clears_the_carried_total(self, gateway):
        """A reset restores the opening balance, so prior sessions go with the positions.

        A carry that survived would leave a flat, freshly reset book claiming money
        it no longer holds — and `daily_pnl` opening at exactly that stale figure,
        which is the same bug the boundary just stopped having.
        """
        _closed_session(gateway, realized=25_000.0)
        _cross_the_boundary(gateway)
        assert gateway.carried_realized_pnl == pytest.approx(25_000.0)

        gateway.reset_book(actor="test")

        assert gateway.carried_realized_pnl == 0.0
        assert gateway.equity() == pytest.approx(settings.starting_equity_usd)
        assert gateway.daily_pnl() == pytest.approx(0.0)
        assert gateway.daily_drawdown_pct() == pytest.approx(0.0)


# --------------------------------------------------------------------------- #
class TestRestartsAcrossTheBoundary:
    """The other half of continuity: the process, not just the clock.

    Everything above holds inside one process. A restart replays *this* session's
    fills and nothing else, so the P&L banked by every earlier session and the
    equity this one opened on reach the new process through one durable
    `session_rollover` record or not at all. When they did not, equity stepped
    down by the whole carry with no order behind it, and the drawdown denominator
    silently reverted to the original starting balance.
    """

    @pytest.mark.asyncio
    async def test_a_restart_after_a_rollover_does_not_move_equity(self, desk, engine, clock):
        """The step the panel could never explain: same session, two equities.

        A rollover step is at least at a boundary a reader can point at. This one
        landed mid-session, in the persisted curve, between two `snapshot_equity`
        rows of the same `session_date` — a paper account that lost yesterday's
        profit to a deployment.
        """
        clock.offset = timedelta(days=-1)
        live = desk.boot()
        realized = await _trade_a_session(live, engine, close_at=110.0, tag="mon")
        assert realized > 0, "the fixture has to actually make money for this to mean anything"

        clock.offset = timedelta()  # 00:00 UTC arrives
        live._roll_session_if_needed()
        banked, opened_at, equity = (
            live.carried_realized_pnl, live.start_of_day_equity, live.equity(),
        )
        assert banked == pytest.approx(realized, abs=1e-6)

        restarted = desk.boot()

        assert restarted.carried_realized_pnl == pytest.approx(banked, abs=1e-9)
        assert restarted.equity() == pytest.approx(equity, abs=1e-9)
        assert restarted.start_of_day_equity == pytest.approx(opened_at, abs=1e-9)
        assert restarted.daily_pnl() == pytest.approx(0.0, abs=1e-9)
        # Not a tautology against a flat account: yesterday genuinely made money,
        # and the restarted process has to still be holding it.
        assert restarted.equity() > settings.starting_equity_usd
        assert restarted.equity() == pytest.approx(
            settings.starting_equity_usd + realized, abs=1e-6,
        )

    @pytest.mark.asyncio
    async def test_a_losing_session_is_still_lost_after_a_restart(self, desk, engine, clock):
        """The sign that flatters rather than embarrasses, again at the process boundary.

        Forgetting a *loss* at restart is the dangerous direction: the account
        springs back to its opening balance and the desk is handed capital it
        spent.
        """
        clock.offset = timedelta(days=-1)
        live = desk.boot()
        realized = await _trade_a_session(live, engine, close_at=90.0, tag="mon")
        assert realized < 0

        clock.offset = timedelta()
        live._roll_session_if_needed()

        restarted = desk.boot()

        assert restarted.carried_realized_pnl == pytest.approx(realized, abs=1e-6)
        assert restarted.equity() == pytest.approx(
            settings.starting_equity_usd + realized, abs=1e-6,
        )
        assert restarted.equity() < settings.starting_equity_usd
        assert restarted.start_of_day_equity < settings.starting_equity_usd

    @pytest.mark.asyncio
    async def test_a_mid_session_restart_keeps_the_live_pnl_and_drawdown(
        self, desk, engine, clock,
    ):
        """A restart is not a new session. Today's numbers have to survive it.

        Both halves are load-bearing at once here: the carry comes from the
        durable rollover record, today's open position comes from the fill
        replay, and `daily_pnl` is the difference between them and a baseline
        that also had to be read back. Get any one wrong and this moves.
        """
        clock.offset = timedelta(days=-1)
        live = desk.boot()
        banked = await _trade_a_session(live, engine, close_at=110.0, tag="mon")

        clock.offset = timedelta()
        live._roll_session_if_needed()

        entry = await live.submit(_market("BUY", client_order_id="tue-open"))
        assert entry.accepted, entry.reason
        _reprice(engine, 97.0)  # today is going badly
        live_pnl, live_dd = live.daily_pnl(), live.daily_drawdown_pct()
        assert live_pnl < 0 and live_dd > 0, "the session has to have moved for this to bite"
        held = live.positions["BTCUSDT"].quantity

        restarted = desk.boot()

        assert restarted.carried_realized_pnl == pytest.approx(banked, abs=1e-6)
        assert restarted.positions["BTCUSDT"].quantity == pytest.approx(held, abs=1e-12)
        assert restarted.daily_pnl() == pytest.approx(live_pnl, abs=1e-9)
        assert restarted.daily_drawdown_pct() == pytest.approx(live_dd, abs=1e-12)

    @pytest.mark.asyncio
    async def test_a_restart_does_not_hand_back_spent_drawdown_budget(
        self, desk, engine, monkeypatch,
    ):
        """The safety regression, reproduced: same book, two verdicts.

        A session that lost $200k leaves the next one measuring its budget
        against $800k. Re-anchoring to the original million after a restart makes
        the same dollar loss a smaller fraction, so the guard that had engaged
        quietly disengages — the desk gets budget back by rebooting.

        Day one is written straight onto the position book, as elsewhere in this
        file, because the figures are sized against the drawdown budget and no
        believable price move reaches them under a $50k order cap. It is day
        *two* that has to be real fills: those are what the restart replays, and
        the point is that the replayed book and the read-back baseline agree.
        """
        monkeypatch.setattr(
            "modules.risk_proxy.settings",
            replace(settings, max_order_notional_usd=500_000.0,
                    max_symbol_notional_usd=500_000.0),
        )
        live = desk.boot()
        _closed_session(live, realized=-200_000.0)
        _cross_the_boundary(live)
        assert live.start_of_day_equity == pytest.approx(800_000.0)

        opening = await live.submit(_market("BUY", notional=400_000.0, client_order_id="tue"))
        assert opening.accepted, opening.reason
        _reprice(engine, 91.0)

        live_dd = live.daily_drawdown_pct()
        assert live.reduce_only_active() is True
        assert live_dd > settings.max_daily_drawdown_pct * settings.reduce_only_threshold
        # The scenario only separates the two denominators if the same loss reads
        # as *under* the reduce-only threshold against the original balance —
        # otherwise a restarted gateway would agree by luck and prove nothing.
        against_the_old_book = -live.daily_pnl() / settings.starting_equity_usd
        assert against_the_old_book < settings.max_daily_drawdown_pct * settings.reduce_only_threshold

        restarted = desk.boot()

        assert restarted.start_of_day_equity == pytest.approx(800_000.0)
        assert restarted.daily_drawdown_pct() == pytest.approx(live_dd, abs=1e-12)
        assert restarted.reduce_only_active() is True, (
            "a restart must not hand back drawdown budget the desk has spent"
        )

    def test_a_boundary_that_cannot_be_persisted_does_not_happen(self, desk):
        """Persist first, then move — the reverse ordering is the whole bug class.

        A rollover that lands in memory and nowhere else is undone by the next
        restart, which is the discontinuity this class exists to close. So the
        durable record is written before a single figure moves: if that write
        fails, `session_date` is still yesterday and the monitor loop retries the
        entire roll on its next pass, rather than leaving the account holding a
        carry no restart can find. Same argument `reset_book` makes for recording
        the reset before clearing the book.
        """
        live = desk.boot()
        _closed_session(live, realized=25_000.0)
        before = live.equity()

        live.audit.close()  # the store goes away mid-flight
        live.session_date = "2000-01-01"
        with pytest.raises(RuntimeError, match="audit store is closed"):
            live._roll_session_if_needed()

        assert live.session_date == "2000-01-01", "nothing may move before the record exists"
        assert live.carried_realized_pnl == 0.0
        assert live.realized_pnl() == pytest.approx(25_000.0), "the session was not closed"
        assert live.equity() == pytest.approx(before)
        assert live.start_of_day_equity == pytest.approx(settings.starting_equity_usd)

    def test_a_reset_after_a_rollover_is_not_undone_by_a_restart(self, desk):
        """A reset is the later boundary, and later wins.

        `reset_book` puts the paper account back on its opening balance. If the
        restart still read the rollover that preceded it, the next process would
        re-credit money the reset had just written off — a reset that only holds
        until someone redeploys is not a reset.
        """
        live = desk.boot()
        _closed_session(live, realized=25_000.0)
        _cross_the_boundary(live)
        assert live.carried_realized_pnl == pytest.approx(25_000.0)

        live.reset_book(actor="test")
        assert live.carried_realized_pnl == 0.0

        restarted = desk.boot()

        assert restarted.carried_realized_pnl == 0.0
        assert restarted.start_of_day_equity == pytest.approx(settings.starting_equity_usd)
        assert restarted.equity() == pytest.approx(settings.starting_equity_usd)

    def test_a_rollover_after_a_reset_is_the_boundary_that_counts(self, desk):
        """The same rule read the other way round, so it is a rule and not a preference."""
        live = desk.boot()
        live.reset_book(actor="test")
        _closed_session(live, realized=12_000.0)
        _cross_the_boundary(live)

        restarted = desk.boot()

        assert restarted.carried_realized_pnl == pytest.approx(12_000.0)
        assert restarted.start_of_day_equity == pytest.approx(
            settings.starting_equity_usd + 12_000.0,
        )

    @pytest.mark.asyncio
    async def test_three_boundaries_and_three_restarts_stay_coherent(self, desk, engine, clock):
        """One restart being right is an accident; the carry has to accumulate.

        Win, lose, win, restarting the process at every boundary. An error that
        only showed up on the second or third pass would look exactly like a
        correct fix on the first.
        """
        banked = 0.0
        gw = None
        for tag, close_at, days_ago in (("mon", 110.0, 3), ("tue", 95.0, 2), ("wed", 104.0, 1)):
            clock.offset = timedelta(days=-days_ago)
            if gw is None:
                gw = desk.boot()
            realized = await _trade_a_session(gw, engine, close_at=close_at, tag=tag)
            banked += realized

            clock.offset = timedelta(days=-(days_ago - 1))  # midnight arrives
            gw._roll_session_if_needed()
            gw = desk.boot()  # the deployment lands right after the boundary

            assert gw.carried_realized_pnl == pytest.approx(banked, abs=1e-6), f"{tag} carry"
            assert gw.equity() == pytest.approx(
settings.starting_equity_usd + banked, abs=1e-6), f"{tag} equity"
            assert gw.daily_pnl() == pytest.approx(0.0, abs=1e-9), f"{tag} rollover"
            assert gw.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-12), f"{tag} budget"

        assert banked > 0, "two up days and one down day is a profitable week"


class TestAnOvernightBookAcrossARestart:
    """The one term of the baseline a replay cannot rebuild.

    `start_of_day_equity` is written from `equity()`, which holds the mark of
    every position open at the boundary. `accepted_fills_for_session` replays one
    UTC day, so those positions do not come back — the restarted gateway's
    `equity()` is short by exactly that mark.

    Restoring the baseline whole measured the smaller book against the larger
    opening balance and published the difference as a loss nobody took. On a real
    book that is enough to open in reduce-only, reject an order, and satisfy the
    hard breaker on a session that has not traded. The record therefore carries
    the mark separately so the reader can subtract it.
    """

    @pytest.mark.asyncio
    async def test_a_restart_holding_an_overnight_position_opens_flat(self, desk, engine, clock):
        clock.offset = timedelta(days=-1)
        live = desk.boot()
        entry = await live.submit(_market("BUY", client_order_id="overnight"))
        assert entry.accepted, entry.reason
        _reprice(engine, 105.0)
        overnight_mark = live.unrealized_pnl()
        assert overnight_mark > 0, "the fixture needs a real open mark to carry"

        clock.offset = timedelta()
        live._roll_session_if_needed()
        assert live.daily_pnl() == pytest.approx(0.0, abs=1e-9)

        restarted = desk.boot()

        # The property that drives the controls: a session that has not traded
        # opens flat and with its budget unspent, live or restarted.
        assert restarted.daily_pnl() == pytest.approx(0.0, abs=1e-9)
        assert restarted.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-9)
        assert restarted.reduce_only_active() is False

    @pytest.mark.asyncio
    async def test_the_baseline_drops_exactly_the_mark_it_cannot_rebuild(self, desk, engine, clock):
        clock.offset = timedelta(days=-1)
        live = desk.boot()
        assert (await live.submit(_market("BUY", client_order_id="overnight2"))).accepted
        _reprice(engine, 105.0)
        overnight_mark = live.unrealized_pnl()

        clock.offset = timedelta()
        live._roll_session_if_needed()
        restarted = desk.boot()

        # Not a free lunch, and the test says so rather than the code claiming
        # otherwise: the restarted process publishes a smaller book, because it
        # genuinely does not know about those positions. Claiming their mark
        # would be the fabrication the subtraction exists to prevent.
        assert restarted.start_of_day_equity == pytest.approx(
            live.start_of_day_equity - overnight_mark, abs=1e-6,
        )
        assert restarted.equity() == pytest.approx(live.equity() - overnight_mark, abs=1e-6)

    @pytest.mark.asyncio
    async def test_a_losing_overnight_book_does_not_open_the_breaker(self, desk, engine, clock):
        """The dangerous direction, and the reason this is not cosmetic.

        With the mark left in the baseline, a restart on a book that closed
        holding a *gain* opened showing that gain as a loss. Sized against the
        drawdown budget it engages reduce-only, and a desk that had traded
        nothing would refuse its first order of the day.
        """
        clock.offset = timedelta(days=-1)
        live = desk.boot()
        assert (await live.submit(_market("BUY", client_order_id="overnight3"))).accepted
        _reprice(engine, 140.0)  # a large open gain, so the phantom loss would be large
        assert live.unrealized_pnl() > 0

        clock.offset = timedelta()
        live._roll_session_if_needed()
        restarted = desk.boot()

        assert restarted.daily_drawdown_pct() == pytest.approx(0.0, abs=1e-9)
        assert restarted.reduce_only_active() is False
        decision = await restarted.submit(_market("BUY", client_order_id="first-of-day"))
        assert "daily_drawdown" not in decision.rejected_by
        assert "reduce_only" not in decision.rejected_by


class TestTheBreakerSurvivesAFailedRoll:
    """A durable-write failure must not disable the automatic breaker.

    `_roll_session_if_needed` is the first statement in the monitor loop's try
    block, so a raising roll skipped the drawdown check underneath it — and
    because a failed roll deliberately leaves `session_date` on yesterday, it
    skipped it again on every tick, permanently. Fail-closed on the boundary is
    right; fail-closed on the breaker is not.
    """

    @pytest.mark.asyncio
    async def test_a_raising_roll_still_lets_the_breaker_trip(self, gateway, monkeypatch):
        def explode() -> None:
            raise RuntimeError("durable write failed")

        monkeypatch.setattr(gateway, "_roll_session_if_needed", explode)
        # A book already past its limit: the breaker is the only thing that
        # should be able to fire on this tick.
        gateway.positions["BTCUSDT"] = PositionState(
            "BTCUSDT", realized_pnl=-settings.starting_equity_usd * 0.9,
        )

        tripped: list[str] = []

        async def capture(reason: str, actor: str, symbol: str | None = None):
            tripped.append(reason)
            return gateway.kill

        monkeypatch.setattr(gateway, "trigger_kill", capture)
        # `.monitor`, not the package: `_monitor_loop` sleeps on the `asyncio`
        # IT imported. Aimed at the package this raised AttributeError; aimed
        # at the wrong submodule it would have slept for real.
        monkeypatch.setattr(risk_proxy.monitor.asyncio, "sleep", _one_tick_then_stop())

        with pytest.raises(_StopTicking):
            await gateway._monitor_loop()

        assert tripped, "the roll failed and took the breaker down with it"
        assert "drawdown" in tripped[0]


class _StopTicking(Exception):
    """Ends the monitor loop after one pass without waiting five seconds."""


def _one_tick_then_stop():
    calls = {"n": 0}

    async def sleep(_seconds: float) -> None:
        calls["n"] += 1
        if calls["n"] > 1:
            raise _StopTicking
    return sleep
