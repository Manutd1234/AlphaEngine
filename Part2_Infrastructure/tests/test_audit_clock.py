"""``modules.audit._utcnow`` is a patch point, and every writer still reads it.

``tests/test_rehydration.py`` arranges a deliberate timestamp tie with

    monkeypatch.setattr(audit_module, "_utcnow", lambda: at.replace(tzinfo=None))

and asserts the replay refuses to guess which of a ``book_reset`` and a
``session_rollover`` happened second. That line patches the *package*
attribute. When ``audit.py`` was one file, every writer read the same module
global, so the patch reached all of them.

Split across ``boundaries.py``, ``writers.py`` and ``subscribers.py``, a plain
``from modules.audit.clock import _utcnow`` in any of them would have bound the
real clock at import time and ignored the patch. The rehydration test covers
the boundary writer; nothing covered the other two, and a clock that quietly
stopped being patchable there is the kind of thing that is only noticed when a
future test tries to pin a timestamp and cannot work out why it will not stick.

So this asserts the mechanism across every module that reads the clock, rather
than any one behaviour that happens to depend on it.
"""

from __future__ import annotations

from datetime import datetime

import pytest

import modules.audit as audit_module
from modules.audit import AuditLog

PINNED = datetime(2031, 3, 4, 5, 6, 7)


@pytest.fixture
def store(tmp_path):
    log = AuditLog(tmp_path / "clock.duckdb")
    yield log
    log.close()


@pytest.fixture
def frozen(monkeypatch):
    """Freeze the clock exactly the way ``tests/test_rehydration.py`` does."""
    monkeypatch.setattr(audit_module, "_utcnow", lambda: PINNED)


def _stamp(value) -> datetime:
    """DuckDB hands back a ``datetime``; the SQLite fallback hands back a string."""
    return value if isinstance(value, datetime) else datetime.fromisoformat(str(value))


class TestThePackageClockReachesEveryWriter:
    def test_the_risk_event_writer_reads_the_patched_clock(self, store, frozen):
        """``writers.py`` — the append-only, best-effort half."""
        store.record_risk_event("kill_switch", severity="critical", detail="pytest")
        rows = store.query("SELECT ts FROM risk_events WHERE event = 'kill_switch'")
        assert _stamp(rows[0]["ts"]) == PINNED

    def test_the_boundary_writer_reads_the_patched_clock(self, store, frozen):
        """``boundaries.py`` — the strict half the rehydration tie depends on."""
        store.record_book_reset("pytest")
        rows = store.query("SELECT ts FROM risk_events WHERE event = 'book_reset'")
        assert _stamp(rows[0]["ts"]) == PINNED

    def test_the_subscriber_ledger_reads_the_patched_clock(self, store, frozen):
        """``subscribers.py`` — a third file, reached by the same one patch."""
        store.upsert_subscriber("4242", "someone")
        row = store.get_subscriber("4242")
        assert _stamp(row["subscribed_at"]) == PINNED

    def test_the_order_event_writer_reads_the_patched_clock(self, store, frozen):
        store.record_order_event(
            order_id="o-1", event="accepted", status="WORKING",
            symbol="BTCUSDT", side="BUY",
        )
        rows = store.query("SELECT ts FROM order_events WHERE order_id = 'o-1'")
        assert _stamp(rows[0]["ts"]) == PINNED

    def test_an_unpatched_store_still_reads_the_real_clock(self, store):
        """The indirection must not pin anything by itself."""
        before = datetime.utcnow()
        store.record_risk_event("heartbeat")
        rows = store.query("SELECT ts FROM risk_events WHERE event = 'heartbeat'")
        assert _stamp(rows[0]["ts"]) >= before.replace(microsecond=0)
        assert _stamp(rows[0]["ts"]) != PINNED


class TestTheCompositionIsOneObject:
    """``AuditLog`` gained bases; it must not have gained behaviour."""

    def test_every_concern_shares_one_connection(self, store):
        from modules.audit import AuditStore

        assert isinstance(store, AuditStore)
        # One ``__init__`` ran, so one handle and one lock exist.
        assert store._conn is not None
        assert store.backend in {"duckdb", "sqlite"}

    def test_the_public_surface_is_reachable_off_the_one_class(self, store):
        for name in (
            "record_order", "record_book_reset", "upsert_subscriber",
            "upsert_ohlcv", "recent_orders", "query", "close",
        ):
            assert callable(getattr(store, name)), f"{name} did not survive the split"
