"""The typed shapes of the operations snapshot.

Split out of ``modules/operations.py`` so that file carries the assembly logic
alone. Every field name, type, default and ordering is unchanged: these models
are published through ``/api/ops/snapshot`` and appear in
``tools/openapi.json``, which the web build gates on by digest.

``modules/operations.py`` re-exports all of them, so ``from modules.operations
import <model>`` keeps working.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from modules.oncall import OnCallSnapshot

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
