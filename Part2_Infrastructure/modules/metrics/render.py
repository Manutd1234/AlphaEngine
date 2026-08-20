"""``render_metrics`` — the whole gateway state as one exposition document.

Split out of ``modules/metrics.py``; the formatting primitives are in
``exposition.py`` and the two latency instruments in their own modules.

**Every import inside ``render_metrics`` stays function-scope.** This module is
reached by ``modules/telegram/*``, ``modules/risk_proxy`` and ``modules/audit``
through the package facade, and each of those is imported here. Hoisting one of
these to the top of the file recreates ``telegram -> metrics -> telegram`` at
module scope and the gateway fails to boot. No lint catches it; the check is
``venv/bin/python -c "import main"``.
"""

from __future__ import annotations

import time

from config import settings
from modules.metrics.decision_latency import core_latency_summary, decision_latency_summary
from modules.metrics.exposition import _JOB_STATES, _Writer
from modules.metrics.request_latency import request_latency_summary

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
    # Published beside `decision_latency_us`, never instead of it: this one is
    # the gate arithmetic, that one is the whole `submit()` under the lock, and
    # blending them would report a number neither clock ever read.
    core = core_latency_summary()
    if core["samples"]:
        for quantile, key in (("0.5", "p50"), ("0.99", "p99"), ("0.999", "p999"), ("0.9999", "p9999")):
            out.metric(
                "decision_core_latency_ns", core[key],
                help=(
                    "Native decision core: the pre-trade gate arithmetic — book "
                    "consolidation, sizing, exposure, drawdown and the routed "
                    "slippage walk — timed inside the engine. Excludes the "
                    "Python-side state reads (kill switch, halts, whitelist, "
                    "duplicate, rate limit) and all response construction."
                ),
                labels=(("quantile", quantile),),
            )
        out.metric(
            "decision_core_latency_max_ns", core["max"],
            help="Slowest native decision core evaluation since start.",
        )
        # How many of the core samples above are the startup self-measure —
        # the same battery on a synthetic two-venue book — rather than real
        # orders. Never part of decision_latency_us.
        out.metric(
            "decision_core_self_test_samples", core["self_test_samples"],
            help=(
                "Native decision core samples contributed by the startup "
                "self-measure (synthetic two-venue book, same compiled battery); "
                "the remainder are submitted orders."
            ),
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
