"""
Prometheus text exposition for the gateway.
===========================================

``/health`` answers "is the process alive and what is it doing right now" for a
human. This module answers the same question for a scraper: the identical state
accessors, rendered as a time series a Grafana panel or an alert rule can act
on.

It is written by hand against the 0.0.4 text exposition format rather than
pulling in ``prometheus_client``. The gateway's dependency floor is a feature —
``requirements-core.txt`` is what a reviewer installs to run the tests — and the
exporter is a formatting problem, not a runtime one: almost every number here
already exists in memory, so the scrape is O(number of feeds) with no lock and
nothing computed for the sake of the endpoint. The one exception is the audit
row counts, which are full table scans and are therefore sampled on a timer
rather than run per scrape.

Two conventions worth stating because they are easy to get wrong:

* Counters are exported at their process-lifetime value with a ``_total``
  suffix; Prometheus computes rates. Restarting the gateway resets them, which
  is the standard counter contract.
* A metric is emitted even when its value is zero (no positions, no jobs of a
  given status). A missing series and a zero series mean different things to an
  alert rule, and "the kill switch metric disappeared" must not read as "the
  kill switch is fine".
"""

from __future__ import annotations

import math
import time
from bisect import bisect_left
from typing import Any, Iterable

from config import settings

PREFIX = "alphaengine"

#: Job states that always get a series, so ``alphaengine_jobs{status="failed"}``
#: exists (at 0) before the first failure rather than appearing with it.
_JOB_STATES = ("queued", "running", "succeeded", "failed")


def _escape_label(value: Any) -> str:
    """Escape a label *value* per the exposition format (backslash, quote, newline)."""
    text = str(value)
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(pairs: Iterable[tuple[str, Any]]) -> str:
    rendered = ",".join(f'{k}="{_escape_label(v)}"' for k, v in pairs if v is not None)
    return f"{{{rendered}}}" if rendered else ""


def _num(value: Any) -> float | None:
    """Coerce to a finite float, or ``None`` when the sample does not exist.

    An absent reading (a book that has never updated, a latency with no
    samples) is skipped rather than exported as 0 — a fabricated zero would be
    indistinguishable from a real one and would quietly poison an average.
    """
    if isinstance(value, bool):
        return float(value)
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):  # NaN / ±Inf
        return None
    return out


class _Writer:
    """Accumulates exposition lines, emitting each HELP/TYPE header once."""

    def __init__(self) -> None:
        self._lines: list[str] = []
        self._declared: set[str] = set()

    def metric(
        self,
        name: str,
        value: Any,
        *,
        help: str = "",
        type: str = "gauge",
        labels: Iterable[tuple[str, Any]] = (),
    ) -> None:
        number = _num(value)
        if number is None:
            return
        full = f"{PREFIX}_{name}"
        if full not in self._declared:
            self._declared.add(full)
            if help:
                self._lines.append(f"# HELP {full} {help}")
            self._lines.append(f"# TYPE {full} {type}")
        rendered = f"{number:.6f}".rstrip("0").rstrip(".") if number % 1 else f"{number:.0f}"
        self._lines.append(f"{full}{_labels(labels)} {rendered}")

    def render(self) -> str:
        return "\n".join(self._lines) + "\n"


_AUDIT_COUNT_INTERVAL_S = 300.0
_audit_counts: dict[str, int] = {}
_audit_counted_at = 0.0


def _audit_row_counts(audit) -> dict[str, int]:
    """Audit table sizes, refreshed at most every few minutes.

    These are the only numbers in this module that are not already in memory.
    A count is a full scan; a scrape is every 15 seconds; the value changes
    slowly and nobody alerts on its exact figure. So it is sampled.
    """
    global _audit_counted_at
    now = time.monotonic()
    if _audit_counts and now - _audit_counted_at < _AUDIT_COUNT_INTERVAL_S:
        return _audit_counts

    counts: dict[str, int] = {}
    for table in ("orders", "risk_events", "backtest_runs", "equity_snapshots"):
        rows = audit.query(f"SELECT count(*) AS n FROM {table}")  # noqa: S608 - fixed identifier list
        if rows and rows[0].get("n") is not None:
            counts[table] = int(rows[0]["n"])
    if counts:
        _audit_counts.clear()
        _audit_counts.update(counts)
        _audit_counted_at = now
    return _audit_counts


def render_metrics() -> str:
    """Render the current gateway state as Prometheus text exposition."""
    from modules.audit import get_audit
    from modules.jobs import get_queue
    from modules.risk_proxy import get_gateway
    from modules.tca_engine import get_engine
    from modules.telegram import get_bot

    out = _Writer()

    # -- build / process ---------------------------------------------------- #
    out.metric(
        "info", 1,
        help="Build and environment labels for this gateway process.",
        labels=(("version", settings.version), ("environment", settings.environment)),
    )

    tca = get_engine()
    health = tca.health()
    out.metric("uptime_seconds", health.get("uptime_s"), help="Seconds since the market-data engine started.")
    out.metric(
        "market_data_enabled", bool(health.get("enabled")),
        help="1 when live venue feeds are enabled, 0 when the process runs offline.",
    )
    out.metric(
        "synthetic_book_active", bool(health.get("synthetic_active")),
        help="1 when books are served from the synthetic fallback rather than a venue.",
    )

    # -- Module A: feeds and books ------------------------------------------ #
    for feed in health.get("feeds", []):
        venue = feed.get("venue")
        out.metric(
            "feed_connected", bool(feed.get("connected")),
            help="1 when the venue WebSocket is connected.", labels=(("venue", venue),),
        )
        out.metric(
            "feed_reconnects_total", feed.get("reconnects"),
            help="Venue WebSocket reconnects since process start.",
            type="counter", labels=(("venue", venue),),
        )
        out.metric(
            "feed_uptime_seconds", feed.get("uptime_s"),
            help="Seconds since this venue feed last connected.", labels=(("venue", venue),),
        )
        for symbol, book in (feed.get("symbols") or {}).items():
            tags = (("venue", venue), ("symbol", symbol))
            out.metric(
                "book_age_seconds", book.get("age_s"),
                help="Age of the most recent book update.", labels=tags,
            )
            out.metric(
                "book_stale", bool(book.get("stale")),
                help="1 when a book has not updated within the staleness budget.", labels=tags,
            )
            out.metric(
                "book_updates_total", book.get("updates"),
                help="Book updates applied since process start.", type="counter", labels=tags,
            )
            out.metric(
                "book_update_rate_hz", book.get("rate_hz"),
                help="Recent book update rate.", labels=tags,
            )

    # -- Module B: risk ------------------------------------------------------ #
    state = get_gateway().state()
    out.metric(
        "kill_switch_active", bool(state.kill_switch_active),
        help="1 when the global kill switch is engaged and all new flow is blocked.",
    )
    out.metric(
        "halted_symbols", len(state.halted_symbols),
        help="Number of individually halted symbols.",
    )
    out.metric(
        "orders_accepted_total", state.orders_accepted,
        help="Orders that passed every pre-trade gate.", type="counter",
    )
    out.metric(
        "orders_rejected_total", state.orders_rejected,
        help="Orders stopped by at least one pre-trade gate.", type="counter",
    )
    out.metric("orders_last_second", state.orders_last_second, help="Observed order rate over the last second.")
    out.metric("working_orders", state.working_orders, help="Orders resting on the book right now.")
    out.metric(
        "working_notional_usd", state.working_notional,
        help="Committed capital in resting orders, worst side per symbol.",
    )
    out.metric("equity_usd", state.equity, help="Mark-to-market account equity.")
    out.metric("daily_pnl_usd", state.daily_pnl, help="Session P&L against the start-of-day mark.")
    out.metric("realized_pnl_usd", state.realized_pnl, help="Realized session P&L.")
    out.metric("unrealized_pnl_usd", state.unrealized_pnl, help="Open-position P&L at the current mark.")
    out.metric("gross_exposure_usd", state.gross_exposure, help="Sum of absolute position notionals.")
    out.metric(
        "drawdown_budget_used_ratio", state.drawdown_budget_used_pct,
        help="Fraction of the daily drawdown budget consumed; the breaker trips at 1.",
    )
    out.metric(
        "reduce_only_active", bool(state.reduce_only),
        help="1 when only position-reducing orders are accepted.",
    )
    # Exported so an alert can compare against the *configured* threshold rather
    # than a copy of the default. A rule that hardcodes 0.8 goes quiet the
    # moment an operator changes this, which is the moment it matters most.
    out.metric(
        "reduce_only_threshold_ratio", state.reduce_only_threshold,
        help="Drawdown-budget fraction at which reduce-only mode engages.",
    )
    out.metric("open_positions", len(state.positions), help="Symbols with a non-flat position.")
    for position in state.positions:
        tags = (("symbol", position.symbol),)
        out.metric("position_notional_usd", position.notional, help="Absolute position notional.", labels=tags)
        out.metric(
            "position_unrealized_pnl_usd", position.unrealized_pnl,
            help="Unrealized P&L for one position.", labels=tags,
        )

    # -- Module C: job queue -------------------------------------------------- #
    stats = get_queue().stats()
    by_status = stats.get("by_status", {})
    for status in sorted(set(_JOB_STATES) | set(by_status)):
        out.metric(
            "jobs", by_status.get(status, 0),
            help="Jobs in the queue by terminal or in-flight status.", labels=(("status", status),),
        )
    out.metric("jobs_total", stats.get("total"), help="Jobs submitted since process start.")
    out.metric("job_workers", stats.get("workers"), help="Configured worker slots.")
    out.metric(
        "job_backend_info", 1,
        help="Which execution backend the job queue resolved to.",
        labels=(("backend", stats.get("backend")),),
    )

    # -- Latency SLIs --------------------------------------------------------- #
    for route, summary in request_latency_summary().items():
        for quantile, value in (("0.5", summary["p50"]), ("0.95", summary["p95"]), ("0.99", summary["p99"])):
            out.metric(
                "request_latency_ms", value,
                help="HTTP handler latency over a bounded recent window, by route.",
                labels=(("route", route), ("quantile", quantile)),
            )
        out.metric(
            "request_samples", summary["samples"],
            help="Samples backing the latency quantiles for this route.", labels=(("route", route),),
        )
        out.metric(
            "request_errors_total", summary["errors"],
            help="Responses with a 5xx status, by route.", type="counter", labels=(("route", route),),
        )

    # -- Pre-trade decision latency ------------------------------------------- #
    # Microseconds, not milliseconds. This is the one path in the system that
    # operates below a millisecond, and rendering it in ms would report every
    # healthy decision as 0.05 and every quantile as indistinguishable.
    decisions = decision_latency_summary()
    if decisions["samples"]:
        for quantile, key in (("0.5", "p50"), ("0.99", "p99"), ("0.999", "p999"), ("0.9999", "p9999")):
            out.metric(
                "decision_latency_us", decisions[key],
                help="Pre-trade risk decision latency, all samples since start.",
                labels=(("quantile", quantile),),
            )
        out.metric(
            "decision_latency_max_us", decisions["max"],
            help="Slowest pre-trade risk decision since start.",
        )
    out.metric(
        "decision_samples_total", decisions["samples"],
        help="Pre-trade decisions measured since start.", type="counter",
    )
    # Which engine made those decisions — a build that quietly fell back to
    # the Python reference must be visible where the latency is read.
    from modules.decision_core import ENGINE as _decision_engine  # local: metrics imports first

    out.metric(
        "decision_engine", 1,
        help="Active pre-trade decision engine (native = compiled core, python = reference).",
        labels=(("engine", _decision_engine),),
    )
    # The native core's own clock, in nanoseconds; absent until it has run.
    core = core_latency_summary()
    if core["samples"]:
        for quantile, key in (("0.5", "p50"), ("0.99", "p99"), ("0.999", "p999"), ("0.9999", "p9999")):
            out.metric(
                "decision_core_latency_ns", core[key],
                help="Native decision core latency (inside the engine), all samples since start.",
                labels=(("quantile", quantile),),
            )
        out.metric(
            "decision_core_latency_max_ns", core["max"],
            help="Slowest native decision core evaluation since start.",
        )

    # -- Audit / observability ------------------------------------------------ #
    audit = get_audit()
    out.metric(
        "audit_backend_info", 1,
        help="Storage engine backing the audit log.", labels=(("backend", audit.backend),),
    )
    # Row counts are full table scans, so they are cached rather than run on
    # every scrape: at a 15s interval they would otherwise contend with the
    # audit writes on the order path — the exact latency source the runbook
    # sends an operator to look for.
    for table, count in _audit_row_counts(audit).items():
        out.metric(
            "audit_rows", count,
            help="Rows persisted in the append-only audit store (sampled, not per-scrape).",
            labels=(("table", table),),
        )

    bot = get_bot()
    bot_health = bot.health()
    out.metric("telegram_enabled", bool(bot_health.get("enabled")), help="1 when the Telegram companion is running.")
    out.metric(
        "telegram_alerts_sent_total", bot_health.get("alerts_sent"),
        help="Alert cards pushed to subscribers.", type="counter",
    )
    out.metric(
        "telegram_updates_handled_total", bot_health.get("updates_handled"),
        help="Telegram updates processed.", type="counter",
    )

    return out.render()


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


# --------------------------------------------------------------------------- #
# Pre-trade decision latency
#
# Separate from the request window above, and the separation is the point. That
# one answers "is the HTTP tier healthy" over a 200-sample ring in milliseconds.
# This one measures the desk's own risk decision — `RiskGateway.submit`, the
# only part of this system that operates in microseconds — and it is judged on
# its TAIL, not its middle. A 200-sample ring cannot express p99.9 at all: the
# 99.9th percentile of 200 samples is just the maximum wearing a decimal point.
#
# So this is a log-linear histogram over the whole run, in the shape a latency
# desk actually keeps one:
#
#   * every sample counted, never a sliding window — an outlier at 03:00 still
#     shows at 09:00, because "we had a 4ms decision last night" is exactly the
#     fact a window is designed to forget;
#   * bounded memory regardless of volume, because it stores counts per bucket
#     rather than samples;
#   * no allocation on the record path. `bisect_left` over a preallocated list
#     of edges allocates nothing, and the counter increment reuses CPython's
#     small-int cache. A recorder that allocates is measuring its own garbage.
#
# ~12% bucket resolution (8 linear sub-buckets per power of two, 1us..~1s).
# Deliberately coarse: reporting p99.9 to four significant figures from a
# process that shares a core with two venue feed handlers would be inventing
# precision the measurement does not have.
# --------------------------------------------------------------------------- #

class _LogLinearHistogram:
    """Counts per log-linear bucket, every sample for the life of the process.

    One class, two instruments: the whole-decision histogram in microseconds
    (``_decision``) and the native core's own timing in nanoseconds
    (``_core``). Same edges shape, same nearest-rank quantiles clamped to the
    observed maximum, so the two never disagree about what a p99 means.
    """

    __slots__ = ("unit", "edges", "counts", "total", "max_value")

    def __init__(self, unit: str, powers: int) -> None:
        self.unit = unit
        edges: list[float] = []
        for power in range(powers):  # 2^0 .. 2^(powers-1) units, 8 sub-buckets each
            base = float(1 << power)
            step = base / 8.0
            for sub in range(8):
                edges.append(base + step * sub)
        #: Upper bound of each bucket. Ascending, so `bisect_left` finds the
        #: bucket in O(log n) without touching the heap.
        self.edges = edges
        self.counts: list[int] = [0] * (len(edges) + 1)
        self.total = 0
        self.max_value = 0.0

    def observe(self, value: float) -> None:
        """Record one sample. Called on the order path; must stay cheap."""
        if value < 0 or value != value:  # NaN never compares equal
            return
        self.counts[bisect_left(self.edges, value)] += 1
        self.total += 1
        if value > self.max_value:
            self.max_value = value

    def reset(self) -> None:
        for index in range(len(self.counts)):
            self.counts[index] = 0
        self.total = 0
        self.max_value = 0.0

    def quantile(self, target_rank: int) -> float:
        seen = 0
        for index, count in enumerate(self.counts):
            seen += count
            if seen >= target_rank:
                # The bucket's upper edge, rounded up rather than interpolated
                # between two buckets that may have had no samples between them.
                #
                # Clamped to the observed maximum, which is not cosmetic: the
                # edge overestimates by up to the bucket width, so an unclamped
                # p99.99 reported 1152us against a real maximum of 1125us. A
                # quantile above the slowest decision ever recorded is not a
                # rounding artefact to explain in a footnote, it is a number
                # that cannot be true.
                if index >= len(self.edges):
                    return self.max_value
                return min(self.edges[index], self.max_value)
        return self.max_value

    def summary(self) -> dict[str, float]:
        """p50/p99/p99.9/p99.99/max in this histogram's unit, plus the count.

        Quantiles are nearest-rank over bucket upper bounds, matching
        ``_quantile`` above rather than introducing a second convention.
        """
        if self.total == 0:
            return {"samples": 0, "p50": 0.0, "p99": 0.0, "p999": 0.0, "p9999": 0.0, "max": 0.0}
        return {
            "samples": self.total,
            "p50": self.quantile(math.ceil(0.50 * self.total)),
            "p99": self.quantile(math.ceil(0.99 * self.total)),
            "p999": self.quantile(math.ceil(0.999 * self.total)),
            "p9999": self.quantile(math.ceil(0.9999 * self.total)),
            "max": self.max_value,
        }

    def buckets(self) -> list[tuple[float, int]]:
        """(upper edge, count) per bucket, the last edge being +inf."""
        out = list(zip(self.edges, self.counts[:-1], strict=True))
        out.append((math.inf, self.counts[-1]))
        return out


#: The whole ``RiskGateway.submit`` under its lock, in microseconds:
#: 2^0 = 1us .. 2^20 ≈ 1.05s.
_decision = _LogLinearHistogram("us", 21)
#: The native core's own clock around the arithmetic, in nanoseconds:
#: 2^0 = 1ns .. 2^24 ≈ 16.8ms. Empty while the Python engine runs.
_core = _LogLinearHistogram("ns", 25)

# The pre-class names, kept for the callers (and one memory-stability test)
# that read them: the list objects are the histogram's own, not copies.
_DECISION_EDGES = _decision.edges
_decision_counts = _decision.counts


def observe_decision_latency(microseconds: float) -> None:
    """Record one pre-trade decision. Called on the order path; must stay cheap."""
    _decision.observe(microseconds)


def observe_core_latency(nanoseconds: float) -> None:
    """Record the native core's timing of one decision (its own clock)."""
    _core.observe(nanoseconds)


def reset_decision_latency() -> None:
    """Drop every recorded decision (used by tests to isolate assertions)."""
    _decision.reset()
    _core.reset()


def decision_latency_summary() -> dict[str, float]:
    """p50/p99/p99.9/p99.99/max in microseconds, plus the sample count."""
    return _decision.summary()


def core_latency_summary() -> dict[str, float]:
    """p50/p99/p99.9/p99.99/max in nanoseconds for the native core, plus count."""
    return _core.summary()


def decision_latency_buckets() -> list[tuple[float, int]]:
    """(upper edge in µs, count) per bucket — for a CDF, not a summary."""
    return _decision.buckets()


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
