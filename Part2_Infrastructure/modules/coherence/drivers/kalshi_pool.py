"""Lifecycle for process-wide Kalshi transport and read-admission resources.

The REST client owns request semantics; this module owns the reusable
``httpx.AsyncClient`` and the shared token-admission guard. Keeping both
process-lifetime resources here makes their loop rules explicit without
changing the public ``kalshi_rest.close_pool`` shutdown hook.
"""

from __future__ import annotations

import asyncio
import threading
import time
from urllib.parse import urlsplit

import httpx

from modules.backend_runtime import current_request_budget
from modules.coherence import tunables
from modules.coherence.scheduler.budget import ReadBudget, Spend

# Until 2026-08-25 every GET opened its own `httpx.AsyncClient` and closed it on
# the way out, so each call paid for a fresh DNS lookup, TCP connect and TLS
# handshake. Measured against `external-api.kalshi.com` from this machine:
#
#     cold connection   DNS 3ms + TCP 239-257ms + TLS 237-265ms + ~250ms  = 713-776ms
#     reused connection                                          ~265ms  = 261-274ms
#
# A cold Proofs load makes about nineteen of these, so roughly 9.3 seconds of
# the wall clock was handshake for connections thrown away microseconds later.
#
# One client for the process, created on first use rather than at import: the
# module is imported by tooling that never makes a request, and a client built
# at import time binds to whatever event loop happens to exist then.
#
# KEYED ON THE RUNNING LOOP, and that is not defensive programming — it is the
# first thing that broke. A pooled connection holds a transport bound to the
# loop that opened it, so a client built under one loop raises "Event loop is
# closed" the moment a second loop uses it. In this process there is only ever
# one loop and the check never fires; under pytest every test gets its own, and
# without this the suite fails in whichever test happens to run second.
_POOL: httpx.AsyncClient | None = None
_POOL_LOOP: asyncio.AbstractEventLoop | None = None

# Local admission smooths one endpoint-cost refill, never turns a bounded web
# request into an unbounded venue queue. The default 50-token/s model
# replenishes even the known 50-token endpoint inside one second.
LOCAL_BUDGET_WAIT_MAX_S = 1.25
LOCAL_BUDGET_RESPONSE_MARGIN_S = 0.25
_BUDGET_LOCK_CREATION_GUARD = threading.Lock()


def local_budget_wait_s() -> float:
    """Fit local token admission inside the propagated gateway deadline."""
    request_budget = current_request_budget()
    if request_budget is None:
        return LOCAL_BUDGET_WAIT_MAX_S
    return min(
        LOCAL_BUDGET_WAIT_MAX_S,
        max(0.0, request_budget.remaining_s() - LOCAL_BUDGET_RESPONSE_MARGIN_S),
    )


def venue_attempt_timeout_s(configured_timeout_s: float) -> float | None:
    """Cap one venue attempt to its freshly observed request allowance."""
    configured = max(0.1, configured_timeout_s)
    request_budget = current_request_budget()
    if request_budget is None:
        return configured
    remaining = request_budget.remaining_s() - LOCAL_BUDGET_RESPONSE_MARGIN_S
    return min(configured, remaining) if remaining > 0 else None


def host_only(url: str) -> str:
    """The hostname for logs and provenance; never path or query."""
    return urlsplit(url).hostname or "unknown"


def default_failover(base_url: str) -> str | None:
    """The other configured host in the same Kalshi environment, if known."""
    for primary, secondary in (
        (tunables.PUBLIC_BASE_URL, tunables.PUBLIC_FAILOVER_URL),
        (tunables.DEMO_BASE_URL, tunables.DEMO_FAILOVER_URL),
    ):
        if base_url == primary:
            return secondary
        if base_url == secondary:
            return primary
    return None


def known_environment(base_url: str) -> str | None:
    if base_url in {tunables.PUBLIC_BASE_URL, tunables.PUBLIC_FAILOVER_URL}:
        return "public"
    if base_url in {tunables.DEMO_BASE_URL, tunables.DEMO_FAILOVER_URL}:
        return "demo"
    return None


def _budget_wait_lock(budget: ReadBudget) -> threading.Lock:
    """Return one event-loop-neutral admission guard per shared bucket.

    ``ReadBudget`` survives FastAPI ``TestClient`` and worker-loop lifecycles.
    An ``asyncio.Lock`` attached to it can remain bound to a closed loop after
    contention. This lock has no loop affinity and is never held across await.
    """
    with _BUDGET_LOCK_CREATION_GUARD:
        lock = getattr(budget, "_kalshi_admission_lock", None)
        if lock is None:
            lock = threading.Lock()
            budget._kalshi_admission_lock = lock
        return lock


async def acquire_budget(
    budget: ReadBudget,
    path: str,
    *,
    max_wait_s: float,
) -> Spend:
    """Wait for a bounded local refill and debit one affordable read.

    A call arriving at 9.6 tokens for a ten-token endpoint is affordable eight
    milliseconds later at the default refill rate. Concurrent loops may wait
    together, but the short plan/take critical section prevents them from
    spending the same tokens or double-counting one refusal.
    """
    deadline = time.monotonic() + max(0.0, max_wait_s)
    lock = _budget_wait_lock(budget)
    while True:
        with lock:
            planned = budget.plan(path)
            if planned.affordable:
                return budget.take(path)

            remaining_s = deadline - time.monotonic()
            if remaining_s <= 0:
                budget.refusals += 1
                return planned

        if budget.tokens_per_second <= 0:
            refill_s = remaining_s
        else:
            deficit = max(0.0, planned.cost - float(planned.tokens_remaining))
            refill_s = deficit / budget.tokens_per_second
        await asyncio.sleep(min(remaining_s, max(0.001, refill_s)))


def pool() -> httpx.AsyncClient:
    """Return the bounded shared client for the running event loop."""
    global _POOL, _POOL_LOOP
    loop = asyncio.get_running_loop()
    if _POOL is None or _POOL.is_closed or _POOL_LOOP is not loop:
        _POOL = httpx.AsyncClient(
            follow_redirects=False,
            # Bounded rather than default-unbounded: this process talks to two
            # hosts and a leak here is a file-descriptor leak.
            limits=httpx.Limits(max_keepalive_connections=8, max_connections=16),
        )
        _POOL_LOOP = loop
    return _POOL


async def close_pool() -> None:
    """Close the shared client, if it belongs to the loop asking.

    ONLY IF IT BELONGS TO THIS LOOP, and that qualifier is the whole function.
    `aclose()` on a client whose connections were opened under a different loop
    raises "Event loop is closed" from deep inside asyncio's transport teardown
    — and under pytest that is the common case, because every `TestClient`
    builds a loop, runs the lifespan and tears the loop down, so the second test
    to start the app finds a pool belonging to the first test's corpse. Dropping
    the reference is the right move there: the loop that owned those sockets is
    already gone and closed them on its way out.
    """
    global _POOL, _POOL_LOOP
    if _POOL is not None and not _POOL.is_closed:
        try:
            mine = _POOL_LOOP is asyncio.get_running_loop()
        except RuntimeError:
            mine = False
        if mine:
            await _POOL.aclose()
    _POOL = None
    _POOL_LOOP = None
