"""Typed, secret-free operations snapshot for the reliability workspace.

The legacy ``/health`` payload is intentionally compact and human-oriented.
This module assembles the richer read model used by the SRE workspace from the
same in-process accessors that back ``/health`` and ``/metrics``. It performs no
network calls or storage queries, so polling it cannot contend with the order
path or turn a downstream outage into a gateway outage.

The SHAPES live in ``modules/operations_models.py``; this file is the assembly.
They are re-exported below — each as ``X as X`` so ``ruff --fix`` does not
delete it — because every call site says ``from modules.operations import X``.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from config import settings
from modules.metrics import (
    REQUEST_LATENCY_WINDOW_SECONDS,
    core_latency_summary,
    decision_latency_summary,
    request_latency_summary,
)
from modules.oncall import OnCallSnapshot as OnCallSnapshot  # noqa: F401
from modules.oncall import oncall_snapshot
from modules.operations_models import AuditOperationsSnapshot as AuditOperationsSnapshot  # noqa: F401
from modules.operations_models import DecisionLatencySnapshot as DecisionLatencySnapshot  # noqa: F401
from modules.operations_models import FeedStatus as FeedStatus  # noqa: F401
from modules.operations_models import MarketDataFeedSnapshot as MarketDataFeedSnapshot  # noqa: F401
from modules.operations_models import MarketDataSnapshot as MarketDataSnapshot  # noqa: F401
from modules.operations_models import MarketDataStatus as MarketDataStatus  # noqa: F401
from modules.operations_models import MarketDataSymbolSnapshot as MarketDataSymbolSnapshot  # noqa: F401
from modules.operations_models import OperationsSnapshot as OperationsSnapshot  # noqa: F401
from modules.operations_models import PlatformStatus as PlatformStatus  # noqa: F401
from modules.operations_models import QueueOperationsSnapshot as QueueOperationsSnapshot  # noqa: F401
from modules.operations_models import RiskOperationsSnapshot as RiskOperationsSnapshot  # noqa: F401
from modules.operations_models import RiskStatus as RiskStatus  # noqa: F401
from modules.operations_models import RouteLatencyOperationsSnapshot as RouteLatencyOperationsSnapshot  # noqa: F401
from modules.operations_models import RouteLatencySnapshot as RouteLatencySnapshot  # noqa: F401
from modules.operations_models import SupabaseMirrorSnapshot as SupabaseMirrorSnapshot  # noqa: F401
from modules.operations_models import TelegramOperationsSnapshot as TelegramOperationsSnapshot  # noqa: F401
from modules.operations_models import TelegramStatus as TelegramStatus  # noqa: F401

# The web tier polls every 30 seconds. Freshness describes how long a last-good
# observation remains trustworthy, not the timeout of one gateway request, so
# allow two missed polls plus a small scheduling margin before reporting
# UNKNOWN.
SNAPSHOT_STALE_AFTER_SECONDS = 65.0


def _finite_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _optional_finite_float(value: Any) -> float | None:
    if value is None:
        return None
    number = _finite_float(value, default=math.nan)
    return number if math.isfinite(number) else None


def _feed_status(connected: bool, symbols: list[MarketDataSymbolSnapshot]) -> FeedStatus:
    if not connected or not symbols or all(symbol.age_seconds is None for symbol in symbols):
        return "down"
    stale_count = sum(symbol.stale for symbol in symbols)
    if stale_count == len(symbols):
        return "stale"
    if stale_count:
        return "degraded"
    return "up"


def _market_data_snapshot(raw: dict[str, Any]) -> MarketDataSnapshot:
    feeds: list[MarketDataFeedSnapshot] = []
    for raw_feed in raw.get("feeds") or []:
        venue = str(raw_feed.get("venue") or "UNKNOWN")
        symbols = [
            MarketDataSymbolSnapshot(
                symbol=str(symbol),
                age_seconds=_optional_finite_float(raw_symbol.get("age_s")),
                updates_total=int(raw_symbol.get("updates") or 0),
                update_rate_hz=_finite_float(raw_symbol.get("rate_hz")),
                stale=bool(raw_symbol.get("stale", True)),
            )
            for symbol, raw_symbol in sorted((raw_feed.get("symbols") or {}).items())
        ]
        connected = bool(raw_feed.get("connected"))
        feeds.append(
            MarketDataFeedSnapshot(
                venue=venue,
                status=_feed_status(connected, symbols),
                connected=connected,
                reconnects=int(raw_feed.get("reconnects") or 0),
                uptime_seconds=_finite_float(raw_feed.get("uptime_s")),
                error_present=bool(raw_feed.get("last_error")),
                synthetic=venue.upper() == "SIM",
                symbols=symbols,
            )
        )

    enabled = bool(raw.get("enabled"))
    # ``TCAEngine.health`` marks watchdog-created fallback state explicitly;
    # a deployment configured with SIM as a venue has the same operational
    # meaning even though it does not populate the watchdog's private handle.
    synthetic_active = bool(raw.get("synthetic_active")) or any(feed.synthetic for feed in feeds)
    real_feeds = [feed for feed in feeds if not feed.synthetic]
    usable_real_feeds = [feed for feed in real_feeds if feed.status in {"up", "degraded"}]
    if not enabled:
        status: MarketDataStatus = "disabled"
    elif not usable_real_feeds:
        status = "critical"
    elif synthetic_active or any(feed.status != "up" for feed in real_feeds):
        status = "degraded"
    else:
        status = "nominal"

    return MarketDataSnapshot(
        enabled=enabled,
        status=status,
        uptime_seconds=_finite_float(raw.get("uptime_s")),
        stale_after_seconds=settings.venue_stale_after_s,
        synthetic_active=synthetic_active,
        feeds=feeds,
    )


def _risk_snapshot(state: Any) -> RiskOperationsSnapshot:
    halted_symbols = list(state.halted_symbols)
    if state.kill_switch_active or halted_symbols:
        status: RiskStatus = "halted"
    elif state.reduce_only:
        status = "reduce_only"
    else:
        status = "nominal"
    return RiskOperationsSnapshot(
        status=status,
        kill_switch_active=state.kill_switch_active,
        halted_symbols=halted_symbols,
        reduce_only=state.reduce_only,
        orders_accepted_total=state.orders_accepted,
        orders_rejected_total=state.orders_rejected,
        working_orders=state.working_orders,
        orders_last_second=state.orders_last_second,
        daily_drawdown_pct=state.daily_drawdown_pct,
        drawdown_budget_used_pct=state.drawdown_budget_used_pct,
        equity=state.equity,
        gross_exposure=state.gross_exposure,
    )


def _queue_snapshot(raw: dict[str, Any]) -> QueueOperationsSnapshot:
    statuses = {status: 0 for status in ("queued", "running", "succeeded", "failed", "cancelled")}
    statuses.update({str(status): int(count) for status, count in (raw.get("by_status") or {}).items()})
    return QueueOperationsSnapshot(
        backend=str(raw.get("backend") or "unknown"),
        workers=int(raw.get("workers") or 0),
        broker_configured=bool(raw.get("broker_configured")),
        broker_transport=raw.get("broker_transport"),
        total=int(raw.get("total") or 0),
        by_status=statuses,
    )


def _telegram_snapshot(raw: dict[str, Any]) -> TelegramOperationsSnapshot:
    enabled = bool(raw.get("enabled"))
    uptime = _finite_float(raw.get("uptime_s"))
    has_error = bool(raw.get("last_error"))
    if not enabled:
        status: TelegramStatus = "disabled"
    elif has_error:
        status = "degraded"
    else:  # Enabled, no error, no uptime yet: that is starting, not degraded.
        status = "running" if uptime > 0 else "starting"
    return TelegramOperationsSnapshot(
        enabled=enabled,
        mode=str(raw.get("mode") or "disabled"),
        status=status,
        uptime_seconds=uptime,
        updates_handled=int(raw.get("updates_handled") or 0),
        alerts_sent=int(raw.get("alerts_sent") or 0),
        last_error_present=has_error,
    )


def _route_latency_snapshot() -> RouteLatencyOperationsSnapshot:
    routes = [
        RouteLatencySnapshot(
            route=route,
            p50_ms=summary["p50"],
            p95_ms=summary["p95"],
            p99_ms=summary["p99"],
            samples=int(summary["samples"]),
            errors_total=int(summary["errors"]),
        )
        for route, summary in sorted(request_latency_summary().items())
    ]
    return RouteLatencyOperationsSnapshot(
        window_seconds=REQUEST_LATENCY_WINDOW_SECONDS,
        routes=routes,
    )


def _decision_latency_snapshot() -> DecisionLatencySnapshot:
    from modules.decision_core import ENGINE

    decision = decision_latency_summary()
    samples = int(decision["samples"])
    core = core_latency_summary()
    core_samples = int(core["samples"])
    return DecisionLatencySnapshot(
        engine=ENGINE,  # type: ignore[arg-type]
        samples=samples,
        p50_us=decision["p50"] if samples else None,
        p99_us=decision["p99"] if samples else None,
        p999_us=decision["p999"] if samples else None,
        max_us=decision["max"] if samples else None,
        core_p50_ns=core["p50"] if core_samples else None,
        core_p99_ns=core["p99"] if core_samples else None,
        core_max_ns=core["max"] if core_samples else None,
        core_self_test_samples=int(core["self_test_samples"]) if core_samples else None,
    )


def _platform_status(
    market_data: MarketDataSnapshot,
    risk: RiskOperationsSnapshot,
    queue_state: QueueOperationsSnapshot,
    audit_state: AuditOperationsSnapshot,
) -> PlatformStatus:
    """The one word the gateway card shows, and the order it is decided in.

    ``telegram`` is NOT a parameter, and that is the point. A chat-transport
    fault used to be the fourth disjunct below, which is how a Telegram blip
    told a desk its TRADING path was degraded. The risk gateway still gates,
    market data still flows and orders still route without the bot: it reports
    on its own plane (``notificationsPosture`` in web/lib/reliability.ts) and
    must never fold back in here.

    ``web/lib/dependency-graph.ts``'s ``degradedCause`` mirrors this order so
    the console can name the cause; ``web/tests/degraded-cause.test.ts`` reads
    THIS FILE to keep the two in step.
    """
    if risk.status == "halted":
        status: PlatformStatus = "halted"
    elif market_data.status == "critical" or not audit_state.available:
        status = "critical"
    # Telegram is deliberately absent: a notification companion is not on the order path.
    elif (
        market_data.status in {"degraded", "disabled"}
        or risk.status == "reduce_only"
        or (queue_state.broker_configured and queue_state.backend != "celery")
    ):
        status = "degraded"
    else:
        status = "nominal"
    return status


def build_operations_snapshot(
    *,
    tca: Any,
    gateway: Any,
    queue: Any,
    audit: Any,
    bot: Any,
    mirror: Any = None,
    observed_at: datetime | None = None,
) -> OperationsSnapshot:
    """Build one internally consistent, process-local reliability snapshot."""
    market_data = _market_data_snapshot(tca.health())
    risk = _risk_snapshot(gateway.state())
    queue_state = _queue_snapshot(queue.stats())
    audit_state = AuditOperationsSnapshot(**audit.health())
    telegram = _telegram_snapshot(bot.health())
    status = _platform_status(market_data, risk, queue_state, audit_state)

    return OperationsSnapshot(
        observed_at=observed_at or datetime.now(timezone.utc),
        stale_after_seconds=SNAPSHOT_STALE_AFTER_SECONDS,
        status=status,
        environment=settings.environment,
        version=settings.version,
        market_data=market_data,
        risk=risk,
        queue=queue_state,
        audit=audit_state,
        telegram=telegram,
        route_latency=_route_latency_snapshot(),
        supabase=SupabaseMirrorSnapshot(**mirror.health()) if mirror is not None else None,
        decision_latency=_decision_latency_snapshot(),
        oncall=oncall_snapshot(settings.data_oncall, webhook_url=settings.data_ops_webhook_url),
    )
