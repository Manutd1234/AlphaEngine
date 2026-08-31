"""The status route's two upstream calls must be issued together, not in series.

WHAT THIS IS WRITTEN FOR, measured 2026-08-25. `/api/coherence/status` makes two
independent round trips to Kalshi — `exchange_status()` and a one-row `markets()`
schema probe — and awaited them one after the other. Against the live venue that
is ~245ms and ~260ms, so the handler cost the SUM:

    sequential   515.0 / 514.3 / 528.0 ms   median 515.0
    concurrent   787.7 / 248.8 / 252.3 ms   median 252.3

Through the desk's proxy it measured 520/538/525ms, roughly forty times every
other coherence route, on something the Diffusion episodes section polls every
twenty seconds. None of it was compute.

WHY A TEST AND NOT JUST THE FIX. `await a; await b` and "run both, then collect"
look almost identical in a diff, and the difference is invisible to every other
suite: the route returns the same object either way, so correctness tests pass
and only a clock can tell. A later edit that reintroduces a direct `await` on
either client call would silently double the latency again.

NOT CACHED, and that is asserted too. A short TTL would take the steady state to
zero and would also mean a status endpoint reporting an exchange as reachable
for up to a TTL after it stopped being — the one thing this route exists to tell
the truth about. Concurrency costs nothing and keeps every answer live.
"""

from __future__ import annotations

import ast
import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
API_SOURCE = ROOT / "modules" / "api" / "coherence.py"
PROBE_SOURCE = ROOT / "modules" / "coherence" / "status_read.py"


def _handler() -> ast.AsyncFunctionDef:
    """The `coherence_status` coroutine, as a syntax tree."""
    tree = ast.parse(API_SOURCE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "coherence_status":
            return node
    raise AssertionError("coherence_status is no longer a coroutine in modules/api/coherence.py")


def _probe_runner() -> ast.AsyncFunctionDef:
    tree = ast.parse(PROBE_SOURCE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_run_status_probes":
            return node
    raise AssertionError("the status probe supervisor is missing")


def _calls(node: ast.AST, attr: str) -> list[ast.Call]:
    """Every call to `<something>.<attr>(...)` inside a subtree."""
    return [
        child
        for child in ast.walk(node)
        if isinstance(child, ast.Call)
        and isinstance(child.func, ast.Attribute)
        and child.func.attr == attr
    ]


def test_both_upstream_calls_are_scheduled_before_either_is_awaited() -> None:
    scheduled = _calls(_probe_runner(), "create_task")
    assert len(scheduled) >= 2, (
        "the status route no longer schedules its two Kalshi round trips together. "
        "Awaiting them in series costs the SUM of two ~250ms internet calls; measured, "
        "that took the route from 252ms to 515ms."
    )


def test_neither_client_call_is_awaited_directly() -> None:
    """`await client.exchange_status()` is the regression, in one line."""
    handler = _probe_runner()
    awaited_directly = []
    for node in ast.walk(handler):
        if not isinstance(node, ast.Await):
            continue
        call = node.value
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute):
            if call.func.attr in {"exchange_status", "markets"}:
                awaited_directly.append(call.func.attr)

    assert awaited_directly == [], (
        f"these upstream calls are awaited inline rather than scheduled first: {awaited_directly}. "
        "Schedule both, then collect them — otherwise the route pays for one round trip "
        "before it starts the other."
    )


def test_the_status_answer_is_not_cached() -> None:
    """A status endpoint may not report a venue reachable after it stopped being."""
    text = API_SOURCE.read_text(encoding="utf-8")
    handler_src = ast.get_source_segment(text, _handler()) or ""
    probe_src = PROBE_SOURCE.read_text(encoding="utf-8")
    for banned in ("lru_cache", "ttl_cache", "cached_property", "@cache"):
        assert banned not in handler_src + probe_src, (
            f"the status route caches through {banned}. Its whole job is to say whether the "
            "exchange is reachable RIGHT NOW; a TTL means answering 'yes' for up to that long "
            "after it stopped being true. The latency fix is concurrency, not staleness."
        )


async def test_status_probe_timeout_returns_degraded_evidence_instead_of_escaping(monkeypatch) -> None:
    from modules.api import coherence as api
    from modules.coherence import status_read

    class SlowClient:
        async def exchange_status(self):
            await asyncio.sleep(1)

        async def markets(self, *_args, **_kwargs):
            await asyncio.sleep(1)

    async def slow_tape(*_args, **_kwargs):
        await asyncio.sleep(1)

    monkeypatch.setattr(status_read, "KalshiClient", SlowClient)
    monkeypatch.setattr(status_read, "run_blocking", slow_tape)
    monkeypatch.setattr(status_read, "STATUS_PROBE_DEADLINE_S", 0.02)
    monkeypatch.setattr(api.tunables, "SERIES_WATCHLIST", ("KXTEST",))

    started = time.perf_counter()
    result = await api.coherence_status(_actor="test")

    assert time.perf_counter() - started < 0.2
    assert result.state == "unavailable"
    assert result.tape["state"] == "unavailable"
    assert any("recovery budget" in note for note in result.notes)


async def test_cancellation_resistant_probe_cannot_overrun_http_deadline(monkeypatch) -> None:
    from modules.api import coherence as api
    from modules.coherence import status_read

    swallowed_cancel = asyncio.Event()
    release = asyncio.Event()

    class StubbornClient:
        async def exchange_status(self):
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                swallowed_cancel.set()
                await release.wait()

        async def markets(self, *_args, **_kwargs):
            await asyncio.Event().wait()

    async def healthy_tape(*_args, **_kwargs):
        return {"state": "ok"}

    monkeypatch.setattr(status_read, "KalshiClient", StubbornClient)
    monkeypatch.setattr(status_read, "run_blocking", healthy_tape)
    monkeypatch.setattr(status_read, "STATUS_PROBE_DEADLINE_S", 0.01)
    monkeypatch.setattr(status_read, "STATUS_CANCEL_GRACE_S", 0.01)
    monkeypatch.setattr(api.tunables, "SERIES_WATCHLIST", ("KXTEST",))

    async with asyncio.timeout(0.2):
        result = await api.coherence_status(_actor="test")

    assert result.state == "unavailable"
    assert swallowed_cancel.is_set()
    release.set()
    await asyncio.sleep(0)


async def test_status_offloads_tape_health_through_the_bounded_runtime(monkeypatch) -> None:
    from modules.api import coherence as api
    from modules.coherence import status_read

    calls: list[tuple[str, str]] = []

    class FastClient:
        async def exchange_status(self):
            return SimpleNamespace(
                host="api.elections.kalshi.com",
                payload={"exchange_index_statuses": []},
            )

    class Store:
        def health(self):
            pytest.fail("tape health ran directly on the event-loop thread")

    async def bounded(label, fn, *_args, **kwargs):
        calls.append((label, kwargs.get("dependency", "")))
        assert fn is status_read._status_tape_health
        return {"state": "ok", "path": "coherence.duckdb", "book_snapshots": 0,
                "tickers_seen": 0, "coherence_index_rows": 0, "violation_episodes": 0}

    store = Store()
    monkeypatch.setattr(status_read, "KalshiClient", FastClient)
    monkeypatch.setattr(status_read, "get_store", lambda: store)
    monkeypatch.setattr(status_read, "run_blocking", bounded)
    monkeypatch.setattr(api.tunables, "SERIES_WATCHLIST", ())

    result = await api.coherence_status(_actor="test")

    assert result.tape["state"] == "ok"
    assert calls == [("coherence.status.tape-health", "coherence_tape")]


async def test_an_exhausted_caller_budget_starts_no_dependency_work(monkeypatch) -> None:
    from modules.api import coherence as api
    from modules.coherence import status_read

    class ExhaustedBudget:
        def remaining_s(self) -> float:
            return 0.5

    def must_not_construct():
        pytest.fail("an exhausted request started a Kalshi client")

    monkeypatch.setattr(status_read, "current_request_budget", lambda: ExhaustedBudget())
    monkeypatch.setattr(status_read, "KalshiClient", must_not_construct)

    result = await api.coherence_status(_actor="test")

    assert result.state == "unavailable"
    assert any("exhausted before live status probes" in note for note in result.notes)
