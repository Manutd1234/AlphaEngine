"""Alert transports may report safety actions, never delay those actions."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from modules.risk_proxy import RiskGateway, TokenBucket
from modules.tca_engine import BookState, TCAEngine, VenueFeed


def _engine() -> TCAEngine:
    engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
    book = BookState("BINANCE", "BTCUSDT")
    book.apply_snapshot(bids=[(100.0, 5_000.0)], asks=[(101.0, 5_000.0)])
    feed = VenueFeed(["BTCUSDT"])
    feed.name = "BINANCE"
    feed.books = {"BTCUSDT": book}
    feed.connected = True
    engine.feeds = {"BINANCE": feed}
    return engine


@pytest.mark.asyncio
async def test_hanging_alert_is_bounded_away_from_risk_controls(monkeypatch):
    from modules.risk_proxy import hooks

    gateway = RiskGateway(tca_engine=_engine(), audit=None)
    gateway.bucket = TokenBucket(1e6, 1_000_000)
    cancelled = asyncio.Event()

    async def hanging(_severity, _message):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(hooks, "ALERT_HOOK_DEADLINE_S", 0.01)
    gateway.add_alert_hook(hanging)
    async with asyncio.timeout(0.2):
        await gateway.trigger_kill("test", "pytest")

    assert gateway.kill.active
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_hanging_alert_is_bounded_away_from_feed_ingestion(monkeypatch):
    from modules import audit as audit_module
    from modules.tca_engine import supervision

    engine = _engine()
    cancelled = asyncio.Event()
    audit = SimpleNamespace(record_risk_event=lambda *_args, **_kwargs: None)
    monkeypatch.setattr(audit_module, "get_audit", lambda: audit)

    async def hanging(_severity, _message):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(supervision, "ALERT_HOOK_DEADLINE_S", 0.01)
    engine.add_alert_hook(hanging)
    await engine._check_feed_health()
    engine.feeds["BINANCE"].connected = False
    async with asyncio.timeout(0.2):
        await engine._check_feed_health()

    assert engine._feed_state["BINANCE"] == "down"
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_cancellation_resistant_alert_cannot_hold_risk_controls(monkeypatch):
    from modules.risk_proxy import hooks

    gateway = RiskGateway(tca_engine=_engine(), audit=None)
    gateway.bucket = TokenBucket(1e6, 1_000_000)
    swallowed_cancel = asyncio.Event()
    release = asyncio.Event()

    async def stubborn(_severity, _message):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            swallowed_cancel.set()
            await release.wait()

    monkeypatch.setattr(hooks, "ALERT_HOOK_DEADLINE_S", 0.01)
    monkeypatch.setattr(hooks, "ALERT_HOOK_CANCEL_GRACE_S", 0.01)
    gateway.add_alert_hook(stubborn)
    async with asyncio.timeout(0.2):
        await gateway.trigger_kill("test", "pytest")

    assert gateway.kill.active
    assert swallowed_cancel.is_set()
    release.set()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_cancelling_alert_fanout_propagates_to_caller():
    gateway = RiskGateway(tca_engine=_engine(), audit=None)
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def hanging(_severity, _message):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    gateway.add_alert_hook(hanging)
    delivery = asyncio.create_task(gateway._alert("critical", "test"))
    await started.wait()
    delivery.cancel()
    with pytest.raises(asyncio.CancelledError):
        await delivery

    assert cancelled.is_set()
