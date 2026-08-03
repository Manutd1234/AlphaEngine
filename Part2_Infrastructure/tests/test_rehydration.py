"""Restart recovery for the paper position book.

Only accepted fills from the current UTC session are replayed. This deliberately
does not claim to restore an overnight book, live kill/halt state, counters,
rate-limit history or idempotency keys; those need dedicated durable snapshots.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

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


def test_incomplete_fill_evidence_fails_closed():
    class IncompleteAudit:
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
