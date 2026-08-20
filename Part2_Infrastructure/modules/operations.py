"""Typed, secret-free operations snapshot for the reliability workspace.

The legacy ``/health`` payload is intentionally compact and human-oriented.
This module assembles the richer read model used by the SRE workspace from the
same in-process accessors that back ``/health`` and ``/metrics``. It performs no
network calls or storage queries, so polling it cannot contend with the order
path or turn a downstream outage into a gateway outage.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from config import settings
from modules.metrics import (
    REQUEST_LATENCY_WINDOW_SECONDS,
    core_latency_summary,
    decision_latency_summary,
    request_latency_summary,
)
from modules.oncall import OnCallSnapshot, oncall_snapshot

# The web tier polls every 30 seconds. Freshness describes how long a last-good
# observation remains trustworthy, not the timeout of one gateway request, so
# allow two missed polls plus a small scheduling margin before reporting
# UNKNOWN.
SNAPSHOT_STALE_AFTER_SECONDS = 65.0

PlatformStatus = Literal["nominal", "degraded", "critical", "halted"]
MarketDataStatus = Literal["nominal", "degraded", "critical", "disabled"]
FeedStatus = Literal["up", "degraded", "stale", "down"]
RiskStatus = Literal["nominal", "reduce_only", "halted"]
TelegramStatus = Literal["running", "starting", "degraded", "disabled"]


class MarketDataSymbolSnapshot(BaseModel):
    symbol: str
    age_seconds: float | None = None
    updates_total: int = 0
    update_rate_hz: float = 0.0
    stale: bool = True


class MarketDataFeedSnapshot(BaseModel):
    venue: str
    status: FeedStatus
    connected: bool
    reconnects: int = 0
    uptime_seconds: float = 0.0
    error_present: bool = False
    synthetic: bool = False
    symbols: list[MarketDataSymbolSnapshot] = Field(default_factory=list)


class MarketDataSnapshot(BaseModel):
    enabled: bool
    status: MarketDataStatus
    uptime_seconds: float = 0.0
    stale_after_seconds: float
    synthetic_active: bool
    feeds: list[MarketDataFeedSnapshot] = Field(default_factory=list)


class RiskOperationsSnapshot(BaseModel):
    status: RiskStatus
    kill_switch_active: bool
    halted_symbols: list[str] = Field(default_factory=list)
    reduce_only: bool
    orders_accepted_total: int
    orders_rejected_total: int
    working_orders: int
    orders_last_second: float
    daily_drawdown_pct: float
    drawdown_budget_used_pct: float
    equity: float
    gross_exposure: float


class QueueOperationsSnapshot(BaseModel):
    backend: str
    workers: int
    broker_configured: bool
    broker_transport: str | None = None
    total: int
    by_status: dict[str, int] = Field(default_factory=dict)


class AuditOperationsSnapshot(BaseModel):
    backend: str
    available: bool


class TelegramOperationsSnapshot(BaseModel):
    enabled: bool
    mode: str
    status: TelegramStatus
    uptime_seconds: float
    updates_handled: int
    alerts_sent: int
    last_error_present: bool


class RouteLatencySnapshot(BaseModel):
    route: str
    p50_ms: float
    p95_ms: float
    p99_ms: float
    samples: int
    errors_total: int


class RouteLatencyOperationsSnapshot(BaseModel):
    window_seconds: float
    routes: list[RouteLatencySnapshot] = Field(default_factory=list)


class SupabaseMirrorSnapshot(BaseModel):
    """Mirror counters — a closed error vocabulary and no identity, per the
    endpoint's own no-URLs/no-paths rule."""

    configured: bool
    running: bool
    queued: int
    written: int
    failed: int
    dropped: int
    last_error_kind: str | None = None


class DecisionLatencySnapshot(BaseModel):
    """The pre-trade decision's own clock, in-process, every sample since start.

    ``engine`` and ``samples`` are always present so a build that fell back to
    the Python reference is visible before the first order; the quantiles are
    null until something has been measured — quantiles of nothing are not
    zeros. ``core_*`` is the native engine's timing of the arithmetic alone,
    in nanoseconds, and is null while the Python engine runs. The core
    histogram may include a startup self-measure of the same compiled battery
    on a synthetic two-venue book — ``core_self_test_samples`` says how many of
    its samples that contributed, null when there is no core histogram at all;
    the decision (µs) histogram never does, so ``samples`` counts submitted
    orders only.
    """

    engine: Literal["native", "python"]
    samples: int
    p50_us: float | None = None
    p99_us: float | None = None
    p999_us: float | None = None
    max_us: float | None = None
    core_p50_ns: float | None = None
    core_p99_ns: float | None = None
    core_max_ns: float | None = None
    core_self_test_samples: int | None = None


class OperationsSnapshot(BaseModel):
    # Additive optional field only — web/lib/reliability.ts hard-rejects
    # schema_version 2, and an older gateway must keep validating.
    schema_version: Literal[1] = 1
    observed_at: datetime
    stale_after_seconds: float
    status: PlatformStatus
    environment: str
    version: str
    market_data: MarketDataSnapshot
    risk: RiskOperationsSnapshot
    queue: QueueOperationsSnapshot
    audit: AuditOperationsSnapshot
    telegram: TelegramOperationsSnapshot
    route_latency: RouteLatencyOperationsSnapshot
    supabase: SupabaseMirrorSnapshot | None = None
    decision_latency: DecisionLatencySnapshot | None = None
    oncall: OnCallSnapshot | None = None


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
