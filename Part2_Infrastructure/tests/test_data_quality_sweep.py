"""The periodic resolver sweep, which nothing covered before this file.

`DataQualityLedger._resolve_cleared` runs inside `ingest` and only there, so an
escalation clears when the SAME provider sends more findings. A provider that
stops reporting entirely — which is exactly what a badly broken one does — left
its escalation open forever, and the rule's cooldown meant no replacement could
open either. `resolve_loop` is the sweep that fixes that, `main.py` starts it as
a background task, and until now the only thing asserting it existed was the
`from modules.data_quality import resolve_loop` at the top of `main.py`.

It moved to `modules/data_quality_escalation.py` when `data_quality.py` was
split, which is when the gap became visible.

The loop's own `asyncio` is swapped for a shim rather than patching
`asyncio.sleep` itself: the sweep floors its interval at five seconds, and a
global patch would reach pytest's event loop as well as the code under test.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from modules import data_quality_escalation as dqe
from modules.data_quality import DataQualityLedger, WebContractCheck, WebContractFinding

NOW = 1_700_000_000_000.0


def _fatal(seq: int, *, provider: str = "fmp", at: float = NOW) -> WebContractFinding:
    return WebContractFinding(
        seq=seq, observed_at=at, capability="quote", provider=provider, symbol="BTCUSDT",
        key="quote:BTCUSDT:*", passed=False, fatal=1, warn=0, drift=0, not_evaluated=0,
        checks=[WebContractCheck(check="quote.price_positive", severity="fatal", message="no price")],
    )


class _OnePassAsyncio:
    """`asyncio` for the sweep only: the first sleep returns, the second cancels."""

    CancelledError = asyncio.CancelledError

    def __init__(self) -> None:
        self.slept: list[float] = []

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        if len(self.slept) > 1:
            raise asyncio.CancelledError
        await asyncio.sleep(0)

    @staticmethod
    async def to_thread(function, *args, **kwargs):
        return await asyncio.to_thread(function, *args, **kwargs)


def _ledger() -> DataQualityLedger:
    return DataQualityLedger.in_memory(
        retention_days=7, view_window_minutes=1440, recent_limit=25,
        escalate_fatal_count=3, escalate_window_minutes=15, escalate_fail_rate=0.25,
        escalate_min_samples=8, escalate_cooldown_minutes=60,
    )


@pytest.mark.asyncio
async def test_the_sweep_resolves_a_provider_that_went_silent(monkeypatch):
    ledger = _ledger()
    opened = ledger.ingest([_fatal(i) for i in (1, 2, 3)], instance="a", now_ms=NOW)
    assert [e.rule for e in opened] == ["fatal_burst"]
    assert [e.resolved_at for e in ledger.view(NOW).escalations] == [None]

    # fmp now sends nothing at all. No `ingest` call will ever run again for it,
    # so `_resolve_cleared` is unreachable except through the sweep.
    clock = _OnePassAsyncio()
    monkeypatch.setattr(dqe, "asyncio", clock)
    with pytest.raises(asyncio.CancelledError):
        await dqe.resolve_loop(interval_s=0.0, ledger=ledger)

    assert clock.slept[0] == 5.0, (
        "the sweep's five-second floor went away — a zero interval would spin"
    )
    # Far enough past the window that no fatal finding is still inside it.
    (swept,) = ledger.view(NOW + 60 * 60_000).escalations
    assert swept.resolved_at is not None, (
        "the escalation is still open against a condition that ended; the desk "
        "shows a permanent red and the cooldown blocks a replacement"
    )


@pytest.mark.asyncio
async def test_a_condition_that_still_holds_is_left_open(monkeypatch):
    # Ingest at the WALL CLOCK, not at NOW.
    #
    # `resolve_loop` reads `time.time()` itself — the sweep's clock is not a
    # parameter — so the only way to place the sweep inside the rule's fifteen
    # minute window is to open the escalation near real time. The sibling test
    # above works the other way round and relies on the same fact: NOW is a
    # 2023 constant, so the wall clock is always far past its window, which is
    # what makes that one a genuine "the condition ended" case rather than a
    # coincidence.
    live = time.time() * 1000.0
    ledger = _ledger()
    opened = ledger.ingest(
        [_fatal(i, at=live) for i in (1, 2, 3)], instance="a", now_ms=live,
    )
    assert [e.rule for e in opened] == ["fatal_burst"], (
        "no escalation opened, so the assertion below would pass on an empty list"
    )

    clock = _OnePassAsyncio()
    monkeypatch.setattr(dqe, "asyncio", clock)
    with pytest.raises(asyncio.CancelledError):
        await dqe.resolve_loop(interval_s=30.0, ledger=ledger)

    assert clock.slept[0] == 30.0
    # Three fatals are still inside the window, so the escalation must survive.
    (kept,) = ledger.view(live).escalations
    assert kept.resolved_at is None, "the sweep resolved a condition that still holds"


def test_main_still_starts_the_sweep():
    """The loop is useless if nothing runs it, and nothing else asserts that."""
    import inspect

    import main

    assert "resolve_loop" in inspect.getsource(main.lifespan), (
        "main.py's lifespan no longer starts the data-quality resolve sweep"
    )
