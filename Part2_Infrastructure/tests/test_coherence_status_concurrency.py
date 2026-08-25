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
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "modules" / "api" / "coherence.py"


def _handler() -> ast.AsyncFunctionDef:
    """The `coherence_status` coroutine, as a syntax tree."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "coherence_status":
            return node
    raise AssertionError("coherence_status is no longer a coroutine in modules/api/coherence.py")


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
    handler = _handler()
    scheduled = _calls(handler, "create_task")
    assert len(scheduled) >= 2, (
        "the status route no longer schedules its two Kalshi round trips together. "
        "Awaiting them in series costs the SUM of two ~250ms internet calls; measured, "
        "that took the route from 252ms to 515ms."
    )


def test_neither_client_call_is_awaited_directly() -> None:
    """`await client.exchange_status()` is the regression, in one line."""
    handler = _handler()
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
    text = SOURCE.read_text(encoding="utf-8")
    handler_src = ast.get_source_segment(text, _handler()) or ""
    for banned in ("lru_cache", "ttl_cache", "cached_property", "@cache"):
        assert banned not in handler_src, (
            f"the status route caches through {banned}. Its whole job is to say whether the "
            "exchange is reachable RIGHT NOW; a TTL means answering 'yes' for up to that long "
            "after it stopped being true. The latency fix is concurrency, not staleness."
        )
