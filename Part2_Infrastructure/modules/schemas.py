"""Pydantic request/response contracts shared by the REST API and gateway console."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Side = Literal["BUY", "SELL"]
OrderType = Literal["MARKET", "LIMIT"]


# --------------------------------------------------------------------------- #
# Module A — TCA
# --------------------------------------------------------------------------- #
class BookLevel(BaseModel):
    price: float
    size: float
    notional: float
    cum_notional: float


class VenueBook(BaseModel):
    venue: str
    symbol: str
    connected: bool
    stale: bool
    synthetic: bool = False
    last_update: datetime | None = None
    latency_ms: float | None = None
    best_bid: float | None = None
    best_ask: float | None = None
    mid: float | None = None
    spread_bps: float | None = None
    bids: list[BookLevel] = Field(default_factory=list)
    asks: list[BookLevel] = Field(default_factory=list)
    depth_usd_bid: float = 0.0
    depth_usd_ask: float = 0.0
    imbalance: float | None = None


class ExecutionEstimate(BaseModel):
    """Result of walking a book for a target notional."""

    venue: str
    fillable: bool
    filled_notional: float
    filled_qty: float
    vwap: float | None
    mid: float | None
    slippage_bps: float | None
    levels_consumed: int
    worst_price: float | None


class RoutingLeg(BaseModel):
    venue: str
    notional: float
    qty: float
    vwap: float
    share_pct: float


class TCAReport(BaseModel):
    symbol: str
    side: Side
    target_notional: float
    generated_at: datetime
    consolidated_mid: float | None
    per_venue: list[ExecutionEstimate]
    best_single_venue: str | None
    smart_route: list[RoutingLeg]
    smart_route_vwap: float | None
    smart_route_slippage_bps: float | None
    saving_vs_worst_bps: float | None
    saving_vs_worst_usd: float | None
    venues_online: list[str]
    synthetic: bool = False


# --------------------------------------------------------------------------- #
# Module B — Risk
# --------------------------------------------------------------------------- #
class OrderRequest(BaseModel):
    symbol: str
    side: Side
    quantity: float | None = Field(default=None, gt=0)
    notional: float | None = Field(default=None, gt=0)
    order_type: OrderType = "MARKET"
    limit_price: float | None = Field(default=None, gt=0)
    strategy: str = "manual"
    client_order_id: str | None = None

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("side", mode="before")
    @classmethod
    def _side_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("order_type", mode="before")
    @classmethod
    def _type_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v


class CheckResult(BaseModel):
    name: str
    passed: bool
    detail: str
    observed: float | None = None
    limit: float | None = None


class Fill(BaseModel):
    price: float
    quantity: float
    notional: float
    fee_usd: float
    slippage_bps: float | None
    venue: str
    simulated: bool = True


class RiskDecision(BaseModel):
    order_id: str
    client_order_id: str | None
    accepted: bool
    symbol: str
    side: Side
    quantity: float | None
    notional: float | None
    checks: list[CheckResult]
    rejected_by: list[str] = Field(default_factory=list)
    reason: str | None = None
    latency_ms: float = 0.0
    timestamp: datetime
    fill: Fill | None = None


class Position(BaseModel):
    symbol: str
    quantity: float
    avg_price: float
    mark_price: float | None
    notional: float
    unrealized_pnl: float
    realized_pnl: float


class RiskState(BaseModel):
    kill_switch_active: bool
    kill_reason: str | None
    killed_at: datetime | None
    killed_by: str | None
    halted_symbols: list[str]
    equity: float
    start_of_day_equity: float
    realized_pnl: float
    unrealized_pnl: float
    daily_pnl: float
    daily_drawdown_pct: float
    drawdown_budget_used_pct: float
    gross_exposure: float
    positions: list[Position]
    orders_accepted: int
    orders_rejected: int
    orders_last_second: float
    limits: dict[str, float]
    session_date: str


class KillSwitchRequest(BaseModel):
    reason: str = "manual trigger"
    actor: str = "api"
    symbol: str | None = None


# --------------------------------------------------------------------------- #
# Module C — Backtest
# --------------------------------------------------------------------------- #
class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    bars: int = Field(default=1500, ge=200, le=5000)
    strategy: Literal["ma_cross", "donchian", "rsi_reversion"] = "ma_cross"
    fast_min: int = Field(default=5, ge=2, le=400)
    fast_max: int = Field(default=40, ge=2, le=400)
    fast_step: int = Field(default=5, ge=1, le=100)
    slow_min: int = Field(default=20, ge=3, le=800)
    slow_max: int = Field(default=200, ge=3, le=800)
    slow_step: int = Field(default=20, ge=1, le=200)
    fee_bps: float = Field(default=6.0, ge=0, le=100)
    slippage_bps: float = Field(default=2.0, ge=0, le=100)
    direction: Literal["long_only", "long_short"] = "long_only"
    walk_forward: bool = True
    folds: int = Field(default=4, ge=2, le=10)
    notify_chat_id: str | None = None

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class ParamResult(BaseModel):
    fast: int
    slow: int
    total_return: float
    cagr: float
    sharpe: float
    sortino: float
    max_drawdown: float
    calmar: float
    win_rate: float
    trades: int
    exposure: float
    turnover: float
    fees_paid: float


class WalkForwardFold(BaseModel):
    fold: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    chosen_fast: int
    chosen_slow: int
    is_sharpe: float
    oos_sharpe: float
    oos_return: float


class BacktestResult(BaseModel):
    job_id: str
    request: BacktestRequest
    engine: str
    data_source: str
    bars: int
    period_start: str
    period_end: str
    combos_tested: int
    best: ParamResult
    benchmark_buy_hold: dict[str, float]
    top_results: list[ParamResult]
    deflated_sharpe_ratio: float
    probabilistic_sharpe_ratio: float
    dsr_verdict: str
    walk_forward: list[WalkForwardFold]
    walk_forward_oos_sharpe: float | None
    equity_curve_png: str | None
    heatmap_png: str | None
    equity_curve: dict[str, list[Any]] | None = None
    duration_s: float = 0.0
    warnings: list[str] = Field(default_factory=list)


class JobStatus(BaseModel):
    job_id: str
    kind: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    progress: float = 0.0
    message: str = ""
    submitted_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    backend: str = "in-process"
