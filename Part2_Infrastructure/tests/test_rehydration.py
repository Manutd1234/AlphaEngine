"""Restart recovery for the paper position book.

Only accepted fills from the current UTC session are replayed. Everything a
restart needs from *earlier* sessions arrives as two numbers on the durable
``session_rollover`` record — what those sessions banked, and the equity this one
opened on — and `tests/test_session_rollover.py` is where that half is pinned.
This file covers the replay itself and, below, what the reader does when the
record it depends on cannot be trusted.

The replay deliberately does not claim to restore an overnight *book*, live
kill/halt state, counters, rate-limit history or idempotency keys; those need
dedicated durable snapshots.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

import modules.audit as audit_module
import modules.risk_proxy as risk_proxy
from modules.audit import AuditLog
from modules.risk_proxy import RiskGateway, TokenBucket
from modules.schemas import OrderRequest
from modules.tca_engine import BookState, TCAEngine


class _Feed:
    def __init__(self, book):
        self.connected = True
        self.books = {book.symbol: book}


def engine() -> TCAEngine:
    tca = TCAEngine(symbols=["BTCUSDT"], venues=[])
    book = BookState("TEST", "BTCUSDT")
    book.apply_snapshot(
        bids=[(100.0 - i * 0.01, 5000.0) for i in range(50)],
        asks=[(100.0 + i * 0.01, 5000.0) for i in range(50)],
    )
    tca.feeds = {"TEST": _Feed(book)}
    return tca


def gateway(tca: TCAEngine, audit) -> RiskGateway:
    gw = RiskGateway(tca_engine=tca, audit=audit)
    gw.bucket = TokenBucket(1e6, 1_000_000)
    return gw


def order(side: str, notional: float, client_order_id: str) -> OrderRequest:
    return OrderRequest(
        symbol="BTCUSDT",
        side=side,
        notional=notional,
        order_type="MARKET",
        client_order_id=client_order_id,
    )


@pytest.mark.asyncio
async def test_restart_restores_positions_and_pnl_without_replaying_side_effects(tmp_path):
    path = tmp_path / "rehydrate.duckdb"
    tca = engine()
    audit = AuditLog(path)
    original = gateway(tca, audit)

    assert (await original.submit(order("BUY", 20_000, "open"))).accepted
    assert (await original.submit(order("SELL", 5_000, "reduce"))).accepted
    assert not (await original.submit(order("BUY", 5_000_000, "rejected"))).accepted
    await original.trigger_kill("test halt", "pytest")

    before = original.state()
    before_position = before.positions[0]
    order_count = audit.query("SELECT count(*) AS n FROM orders")[0]["n"]
    event_count = audit.query("SELECT count(*) AS n FROM risk_events")[0]["n"]
    audit.close()

    reopened = AuditLog(path)
    restored = gateway(tca, reopened)
    after = restored.state()
    after_position = after.positions[0]

    assert after_position.quantity == pytest.approx(before_position.quantity)
    assert after_position.avg_price == pytest.approx(before_position.avg_price)
    assert after_position.realized_pnl == pytest.approx(before_position.realized_pnl)
    assert after_position.unrealized_pnl == pytest.approx(before_position.unrealized_pnl)
    assert after.equity == pytest.approx(before.equity)
    assert after.gross_exposure == pytest.approx(before.gross_exposure)

    # Position evidence is restored; operational process state is not replayed.
    assert after.orders_accepted == 0
    assert after.orders_rejected == 0
    assert after.kill_switch_active is False
    assert after.halted_symbols == []

    # Construction is a read: it must not duplicate orders or risk events.
    assert reopened.query("SELECT count(*) AS n FROM orders")[0]["n"] == order_count
    assert reopened.query("SELECT count(*) AS n FROM risk_events")[0]["n"] == event_count
    reopened.close()


@pytest.mark.asyncio
async def test_restart_honours_the_latest_durable_book_reset(tmp_path):
    path = tmp_path / "reset.duckdb"
    tca = engine()
    audit = AuditLog(path)
    original = gateway(tca, audit)

    first = await original.submit(order("BUY", 20_000, "before-reset"))
    assert first.accepted
    original.reset_book("pytest")
    second = await original.submit(order("BUY", 7_000, "after-reset"))
    assert second.accepted and second.fill is not None
    audit.close()

    reopened = AuditLog(path)
    restored = gateway(tca, reopened)
    position = restored.positions["BTCUSDT"]
    assert position.quantity == pytest.approx(second.fill.quantity)
    assert position.avg_price == pytest.approx(second.fill.price)
    assert position.realized_pnl == pytest.approx(-second.fill.fee_usd)
    assert reopened.query(
        "SELECT count(*) AS n FROM risk_events WHERE event = 'book_reset'"
    )[0]["n"] == 1
    reopened.close()


@pytest.mark.asyncio
async def test_restart_does_not_guess_an_overnight_book(tmp_path, monkeypatch):
    path = tmp_path / "prior-session.duckdb"
    tca = engine()
    audit = AuditLog(path)
    real_utcnow = risk_proxy._utcnow
    yesterday = real_utcnow() - timedelta(days=1)
    monkeypatch.setattr(risk_proxy, "_utcnow", lambda: yesterday)

    prior_session = gateway(tca, audit)
    assert (await prior_session.submit(order("BUY", 10_000, "yesterday"))).accepted
    audit.close()

    monkeypatch.setattr(risk_proxy, "_utcnow", real_utcnow)
    reopened = AuditLog(path)
    restored = gateway(tca, reopened)
    assert restored.positions == {}
    reopened.close()


class _NoRollover:
    """The ordinary case for a session that has not closed one: no record.

    Every stand-in below inherits it so each test varies exactly one thing. A
    restart reads the durable session baseline before it replays a single fill,
    so an audit that cannot answer that question at all stops the gateway before
    the fill evidence is ever reached — which would make these tests pass for the
    wrong reason.
    """

    def latest_session_rollover(self, session_date):
        return None

    def has_activity_before(self, session_date):
        # A store with no earlier sessions, which is what makes "no rollover
        # record" the ordinary case rather than a boundary crossed while the
        # process was down. A stand-in that omitted this would answer the
        # gateway's question by raising, and the tests below would pass on an
        # error from the wrong line.
        return False

    def accepted_fills_for_session(self, session_date):
        return []


def test_incomplete_fill_evidence_fails_closed():
    class IncompleteAudit(_NoRollover):
        def accepted_fills_for_session(self, session_date):
            return [{
                "ts": "2026-08-04T00:00:00",
                "order_id": "broken",
                "symbol": "BTCUSDT",
                "side": "BUY",
                "fill_qty": 1.0,
                "fill_price": 100.0,
                "fee_usd": None,
            }]

    with pytest.raises(RuntimeError, match="missing numeric fee_usd"):
        gateway(engine(), IncompleteAudit())


def test_an_unreadable_session_baseline_fails_closed():
    """A baseline that cannot be read is refused, not defaulted.

    0.0 and ``starting_equity_usd`` look like a neutral fallback and are not:
    they assert that nothing has been banked and that this session opened on the
    original balance. After a losing week both are false in the direction that
    *widens* the drawdown budget, so a gateway that quietly defaulted would come
    up holding risk capacity it never had. Same reasoning
    ``accepted_fills_for_session`` uses to refuse an understated book — a
    gateway that will not construct is loud; one that starts on a fabricated
    baseline is not.
    """
    class UnreadableAudit(_NoRollover):
        def latest_session_rollover(self, session_date):
            raise RuntimeError("could not read the durable session rollover record")

    with pytest.raises(RuntimeError, match="cannot safely restore"):
        gateway(engine(), UnreadableAudit())


def test_a_rollover_record_missing_its_carry_fails_closed():
    """A partially-written record is not partially applied.

    Taking the baseline and defaulting the carry would produce a book whose
    equity and whose drawdown denominator came from different sessions — self-
    consistent nowhere, and wrong by an amount nothing in the payload names.
    """
    class CorruptAudit(_NoRollover):
        def latest_session_rollover(self, session_date):
            return {
                "session_date": session_date,
                "carried_realized_pnl": None,
                "start_of_day_equity": 900_000.0,
            }

    with pytest.raises(RuntimeError, match="missing numeric carried_realized_pnl"):
        gateway(engine(), CorruptAudit())


def test_a_rollover_record_filed_under_another_session_is_refused():
    """The row is found by the window its timestamp falls in, so the payload must agree.

    A record naming a different day disagrees with its own clock. Applying it
    anyway would anchor today's drawdown budget to some other day's balance — a
    wrong denominator that reads as entirely plausible in the panel.
    """
    class MisfiledAudit(_NoRollover):
        def latest_session_rollover(self, session_date):
            return {
                "session_date": "1999-12-31",
                "carried_realized_pnl": 5_000.0,
                "start_of_day_equity": 1_005_000.0,
            }

    with pytest.raises(RuntimeError, match="session it was filed under"):
        gateway(engine(), MisfiledAudit())


def test_a_rollover_tying_with_a_reset_is_refused(tmp_path, monkeypatch):
    """The tie the schema cannot break, refused rather than guessed at.

    ``risk_events`` carries timestamps and no sequence column. A rollover and a
    book reset stamped at the same instant put the account on two different
    balances — the rollover's banked carry, or the opening balance the reset
    restores — and nothing in either row says which happened second. Picking one
    would be a coin flip wearing a number's clothes, so the read refuses, exactly
    as a fill tying with a reset does.
    """
    audit = AuditLog(tmp_path / "tie.duckdb")
    at = risk_proxy._utcnow()
    session = at.strftime("%Y-%m-%d")
    audit.record_session_rollover(
        session, carried_realized_pnl=1_000.0, start_of_day_equity=1_001_000.0,
        unrealized_at_rollover=0.0, at=at,
    )
    # `record_book_reset` reads its own clock, so the tie has to be arranged.
    monkeypatch.setattr(audit_module, "_utcnow", lambda: at.replace(tzinfo=None))
    audit.record_book_reset("pytest")

    with pytest.raises(RuntimeError, match="ambiguous audit timestamp"):
        audit.latest_session_rollover(session)
    audit.close()
