"""The names ``modules.tca_engine`` is patched BY NAME on, still reach the code.

``tools/gate_fixture.py`` — shared by ``tools/make_gate_fixture.py``, which
RECORDS the twenty-scenario gate-parity fixture, and ``tests/test_gate_parity.py``,
which asserts the running engine still reproduces it — pins every limit a gate
reads with a single line:

    monkeypatch.setattr(tca_engine, "settings", limits)

That patches the *package* attribute. When ``tca_engine`` was one file, the code
that read ``settings.venue_stale_after_s`` lived in that same module and the
patch therefore reached it. Now it does not: ``BookState`` lives in
``modules/tca_engine/book.py``, and a plain ``from config import settings``
there would have bound the real settings object at import time and ignored the
patch entirely.

Nothing would have failed. ``test_gate_parity`` would still pass — it would
simply judge the freshness scenarios against whatever the developer's ``.env``
says instead of against the scenario's own limit, which is a parity suite
testing the wrong thing while reporting green.

So these are the assertions that would have caught it. They are deliberately
about the *mechanism* rather than about any one gate: a future split that moves
``BookState`` again, or that "tidies" the proxy in ``_runtime.py`` away, turns
this file red instead of turning the parity fixture into decoration.
"""

from __future__ import annotations

import dataclasses
import time

import pytest

import modules.tca_engine as tca_engine
from config import settings as base_settings
from modules.tca_engine import BookState, TCAEngine


@pytest.fixture
def book() -> BookState:
    b = BookState("TEST", "BTCUSDT")
    b.apply_snapshot(bids=[(100.0, 10.0)], asks=[(101.0, 10.0)])
    return b


def _pinned(monkeypatch, **fields) -> None:
    """Pin limits exactly the way ``tools/gate_fixture.py`` does."""
    monkeypatch.setattr(tca_engine, "settings", dataclasses.replace(base_settings, **fields))


class TestTheSettingsPatchPointReachesEverySubmodule:
    def test_book_staleness_follows_the_patched_limit(self, book, monkeypatch):
        """``venue_stale_after_s`` decides the ``reference_freshness`` gate."""
        book.last_update_wall = time.time() - 5.0

        _pinned(monkeypatch, venue_stale_after_s=60.0)
        assert book.stale is False, "a 5s-old book is fresh under a 60s limit"

        _pinned(monkeypatch, venue_stale_after_s=1.0)
        assert book.stale is True, (
            "modules/tca_engine/book.py is not reading the patched settings — the "
            "gate-parity battery is judging freshness against the developer's .env"
        )

    def test_the_engine_reads_the_patched_symbol_and_venue_lists(self, monkeypatch):
        _pinned(monkeypatch, symbols=["ethusdt"], venues=["bybit"])
        engine = TCAEngine()
        assert engine.symbols == ["ETHUSDT"]
        assert engine.venue_names == ["BYBIT"]

    def test_the_analytics_half_reads_the_patched_probe_notional(self, book, monkeypatch):
        """``tca_report`` lives in analytics.py, two files from the patch point."""
        _pinned(monkeypatch, default_probe_notional=250.0, venue_stale_after_s=3600.0)
        engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
        engine.feeds = {"TEST": _StubFeed(book)}  # type: ignore[assignment]

        assert engine.tca_report("BTCUSDT").target_notional == 250.0

    def test_the_health_view_reads_the_patched_market_data_flag(self, monkeypatch):
        engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
        _pinned(monkeypatch, enable_market_data=True)
        assert engine.health()["enabled"] is True
        _pinned(monkeypatch, enable_market_data=False)
        assert engine.health()["enabled"] is False

    def test_the_clock_is_patchable_on_the_package_too(self, book, monkeypatch):
        """``_utcnow`` is exported from the package, so it must actually work.

        Nothing patches it today. A name that a future test would reasonably
        reach for, and that would silently keep reading the wall clock, is the
        same trap as the settings one — just not sprung yet.
        """
        from datetime import datetime, timezone

        pinned = datetime(2031, 1, 1, tzinfo=timezone.utc)
        monkeypatch.setattr(tca_engine, "_utcnow", lambda: pinned)
        _pinned(monkeypatch, venue_stale_after_s=3600.0)

        engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
        engine.feeds = {"TEST": _StubFeed(book)}  # type: ignore[assignment]
        assert engine.tca_report("BTCUSDT").generated_at == pinned

    def test_the_patch_is_undone_when_the_test_that_made_it_ends(self, monkeypatch):
        """A proxy that could not be un-patched would leak limits between tests."""
        original = base_settings.venue_stale_after_s
        _pinned(monkeypatch, venue_stale_after_s=original + 999.0)
        monkeypatch.undo()
        assert tca_engine.settings.venue_stale_after_s == original


class _StubFeed:
    """A connected feed holding one book, with no socket behind it."""

    def __init__(self, book: BookState) -> None:
        self.connected = True
        self.books = {book.symbol: book}
