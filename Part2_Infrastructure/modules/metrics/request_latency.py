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

class RequestLatencyWindow:
    """A bounded, time-limited per-route latency ring.

    Was two module-level dicts mutated by three module-level functions — an
    accidental singleton. The tell was ``reset_request_latency``, whose own
    docstring said it existed "for tests to isolate assertions": a reset verb
    that exists only because the state is global is the shape of a class that
    has not been written yet. A test can now build its own window instead of
    clearing everyone else's.

    **Mutates its dicts in place and never rebinds them.** ``modules/metrics/
    __init__`` re-exports them BY OBJECT — deliberately, because hoisting the
    values would freeze them and because the facade cannot import more eagerly
    without recreating the ``telegram -> metrics -> telegram`` cycle that stops
    the gateway booting. Rebinding ``self.samples`` would silently detach every
    reader going through the facade, so ``reset`` clears rather than reassigns.
    """

    def __init__(
        self,
        *,
        capacity: int = _LATENCY_CAPACITY,
        window_seconds: float = REQUEST_LATENCY_WINDOW_SECONDS,
        max_routes: int = _MAX_ROUTES,
    ) -> None:
        self.capacity = capacity
        self.window_seconds = window_seconds
        self.max_routes = max_routes
        #: route -> list of (monotonic timestamp, duration_ms)
        self.samples: dict[str, list[tuple[float, float]]] = {}
        self.errors: dict[str, int] = {}

    def observe(self, route: str, duration_ms: float, *, error: bool = False) -> None:
        now = time.monotonic()
        if route not in self.samples and len(self.samples) >= self.max_routes:
            # Aggregate rather than drop: losing the fact that requests happened
            # is worse than losing which path they were for.
            route = UNMATCHED_ROUTE
        window = self.samples.setdefault(route, [])
        window.append((now, duration_ms))
        cutoff = now - self.window_seconds
        if len(window) > self.capacity or (window and window[0][0] < cutoff):
            window[:] = [s for s in window[-self.capacity:] if s[0] >= cutoff]
        if error:
            self.errors[route] = self.errors.get(route, 0) + 1

    def reset(self) -> None:
        """Drop every recorded sample. Clears in place — see the class note."""
        self.samples.clear()
        self.errors.clear()

    def summary(self) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        cutoff = time.monotonic() - self.window_seconds
        for route, window in self.samples.items():
            recent = sorted(duration for at, duration in window if at >= cutoff)
            if not recent:
                continue
            out[route] = {
                "p50": _quantile(recent, 0.50),
                "p95": _quantile(recent, 0.95),
                "p99": _quantile(recent, 0.99),
                "samples": len(recent),
                "errors": self.errors.get(route, 0),
            }
        return out


#: The process-wide window the middleware and /metrics share. One instance, not
#: a global dict, so a test can construct its own without touching this one.
_default = RequestLatencyWindow()

#: Bound to the instance's own dicts, for the by-object facade re-export above.
#: These names are the same objects `_default` mutates, never copies of them.
_latency = _default.samples
_errors = _default.errors


def observe_request(route: str, duration_ms: float, *, error: bool = False) -> None:
    _default.observe(route, duration_ms, error=error)


def reset_request_latency() -> None:
    """Drop every recorded sample from the process-wide window."""
    _default.reset()


def request_latency_summary() -> dict[str, dict[str, float]]:
    return _default.summary()


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
