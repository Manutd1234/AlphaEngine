"""The HTTP request latency window and the ASGI middleware that fills it.

Split out of ``modules/metrics.py``. The window and the middleware stay in one
file because they are one instrument: the middleware is the only production
caller of ``observe_request``, and the ``/metrics`` exclusion below is the rule
that keeps a scrape from perturbing what it measures.
"""

from __future__ import annotations

import math
import time

# --------------------------------------------------------------------------- #
# Request latency window
#
# A bounded, time-limited per-route ring, mirroring the semantics the web tier
# already uses in web/lib/observability.ts: a *recent* window rather than an
# all-time average, and failures included in the timing sample (an error that
# takes 30s is a latency problem too). Nearest-rank quantiles — with this few
# samples, interpolation would invent precision the window does not have.
#
# Both bounds are load-bearing. Without the time bound a single slow request
# during a cold start pins p99 for days on a quiet desk, and the alert that
# fires on it sends an operator looking for a problem that ended long ago.
# Without the route bound, an internet scanner hitting a few thousand distinct
# 404 paths adds a permanent series each — `/metrics` is unauthenticated, so
# that budget is attacker-controlled.
# --------------------------------------------------------------------------- #
_LATENCY_CAPACITY = 200
REQUEST_LATENCY_WINDOW_SECONDS = 900.0
#: Distinct routes tracked. The real app has ~30; anything beyond this is
#: unmatched paths, which are aggregated rather than given a series each.
_MAX_ROUTES = 60
UNMATCHED_ROUTE = "unmatched"

#: route -> list of (monotonic timestamp, duration_ms)
_latency: dict[str, list[tuple[float, float]]] = {}
_errors: dict[str, int] = {}


def observe_request(route: str, duration_ms: float, *, error: bool = False) -> None:
    now = time.monotonic()
    if route not in _latency and len(_latency) >= _MAX_ROUTES:
        # Aggregate rather than drop: losing the fact that requests happened is
        # worse than losing which path they were for.
        route = UNMATCHED_ROUTE
    window = _latency.setdefault(route, [])
    window.append((now, duration_ms))
    cutoff = now - REQUEST_LATENCY_WINDOW_SECONDS
    if len(window) > _LATENCY_CAPACITY or (window and window[0][0] < cutoff):
        window[:] = [s for s in window[-_LATENCY_CAPACITY:] if s[0] >= cutoff]
    if error:
        _errors[route] = _errors.get(route, 0) + 1


def reset_request_latency() -> None:
    """Drop every recorded sample (used by tests to isolate assertions)."""
    _latency.clear()
    _errors.clear()


def _quantile(sorted_values: list[float], q: float) -> float:
    """Nearest rank: the value some request actually experienced.

    ``ceil(q·n) - 1`` — the same expression the two TypeScript implementations
    use. An earlier ``round(q·n + 0.5) - 1`` looked equivalent and was not:
    Python rounds halves to even, so an exact ``q·n`` returned the *next* index
    and p99 collapsed onto the maximum for any window under 100 samples.
    """
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, max(0, math.ceil(q * len(sorted_values)) - 1))
    return sorted_values[index]


def request_latency_summary() -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    cutoff = time.monotonic() - REQUEST_LATENCY_WINDOW_SECONDS
    for route, window in _latency.items():
        recent = sorted(duration for at, duration in window if at >= cutoff)
        if not recent:
            continue
        out[route] = {
            "p50": _quantile(recent, 0.50),
            "p95": _quantile(recent, 0.95),
            "p99": _quantile(recent, 0.99),
            "samples": len(recent),
            "errors": _errors.get(route, 0),
        }
    return out




class RequestTimingMiddleware:
    """Pure-ASGI timing middleware.

    Implemented at the ASGI layer rather than as a ``BaseHTTPMiddleware`` so it
    adds no per-request task or queue to the WebSocket-heavy hot path; non-HTTP
    scopes pass straight through. Routes are recorded by their template path
    (``/api/book/{symbol}``) so per-symbol cardinality cannot blow up the label
    space.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status_holder = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            # `scope["route"]` is only set for *matched* routes, so a 404 would
            # otherwise be recorded under its raw path — one permanent series
            # per URL a scanner tries.
            matched = getattr(scope.get("route"), "path", None)
            path = matched or UNMATCHED_ROUTE
            if path != "/metrics":  # a scrape must not perturb what it measures
                observe_request(
                    path,
                    (time.perf_counter() - started) * 1000.0,
                    error=status_holder["code"] >= 500,
                )
