"""Pydantic request/response contracts shared by the REST API and gateway console."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Side = Literal["BUY", "SELL"]
OrderType = Literal["MARKET", "LIMIT"]

#: Three, not the usual six. ``FOK`` is only meaningful alongside partial fills,
#: and this gateway deliberately does not model those — see the README's
#: "deliberately missing" table.
TimeInForce = Literal["GTC", "DAY", "IOC"]

#: Five states, and ``PARTIALLY_FILLED`` is deliberately absent. The L2 feeds
#: carry ladder snapshots rather than trade prints, so how much of a resting
#: order a crossing trade consumed is unknowable here. Declaring a state that can
#: never be reached would claim a model that does not exist.
OrderStatus = Literal["WORKING", "FILLED", "CANCELLED", "EXPIRED", "REJECTED"]


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
    # No default here on purpose: the sensible one differs by order type, and a
    # single field default cannot say so. `submit` resolves None to GTC for a
    # LIMIT and IOC for a MARKET, which makes every client that never sends the
    # field behave exactly as it did before resting orders existed.
    time_in_force: TimeInForce | None = None

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("time_in_force", mode="before")
    @classmethod
    def _tif_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _resting_market_orders_are_nonsense(self) -> OrderRequest:
        # Rejected rather than coerced. A market order that rests is not a thing,
        # and quietly rewriting it to IOC would answer a question nobody asked.
        if self.order_type == "MARKET" and self.time_in_force in {"GTC", "DAY"}:
            raise ValueError("a MARKET order cannot rest — use GTC or DAY with a LIMIT price")
        return self

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
    # Defaulted so every existing assertion about `accepted` and `fill` keeps
    # meaning what it meant: before resting orders, an accepted order was a
    # filled order, and these defaults say exactly that.
    status: OrderStatus = "FILLED"
    time_in_force: TimeInForce | None = None


class WorkingOrder(BaseModel):
    """An order resting on the book right now.

    Terminal decisions live in ``/api/audit/orders``. This is only what is still
    open, which is the set a desk can actually still act on.
    """

    order_id: str
    client_order_id: str | None = None
    symbol: str
    side: Side
    order_type: OrderType
    time_in_force: TimeInForce
    quantity: float
    limit_price: float
    #: Committed capital: quantity x limit price. A resting order is not free.
    notional: float
    strategy: str
    source: str
    status: OrderStatus
    accepted_at: datetime
    age_seconds: float
    mark_price: float | None = None
    #: How far the limit sits from the mark. Null when there is no live mark to
    #: measure against — never zero, which would read as "at the touch".
    distance_bps: float | None = None
    #: DAY orders only.
    expires_at: datetime | None = None


class OrderAck(BaseModel):
    order_id: str
    status: OrderStatus
    actor: str
    reason: str | None = None
    at: datetime


class CancelRequest(BaseModel):
    reason: str = "manual cancel"


class ReplaceRequest(BaseModel):
    quantity: float | None = Field(default=None, gt=0)
    notional: float | None = Field(default=None, gt=0)
    limit_price: float | None = Field(default=None, gt=0)
    reason: str = "replace"


class OrderEvent(BaseModel):
    ts: datetime
    event: str
    status: OrderStatus
    detail: str = ""
    actor: str = "system"
    fill_price: float | None = None
    fill_qty: float | None = None
    fee_usd: float | None = None
    venue: str | None = None
    replaces: str | None = None


class OrderTimeline(BaseModel):
    order_id: str
    status: OrderStatus
    events: list[OrderEvent]


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
    # ``realized_pnl`` is *this session's*, because the gateway zeroes the
    # per-position counters at every UTC rollover. The money those closed
    # sessions made is here, and without it the payload stops reconciling:
    # after the first boundary ``equity != starting + realized + unrealized``
    # and the missing term has no name. Defaulted so the field is an additive
    # contract change — every existing client keeps parsing what it parsed.
    carried_realized_pnl: float = 0.0
    unrealized_pnl: float
    daily_pnl: float
    daily_drawdown_pct: float
    drawdown_budget_used_pct: float
    # True when the desk is between the soft threshold and the hard breaker:
    # position-reducing orders still pass, everything else is refused.
    reduce_only: bool = False
    reduce_only_threshold: float = 1.0
    reduce_only_source: Literal["threshold", "operator", "off"] = "off"
    gross_exposure: float
    positions: list[Position]
    orders_accepted: int
    orders_rejected: int
    orders_last_second: float
    # Resting orders are committed capital that has not landed yet, so a state
    # snapshot that omitted them would understate what the book is exposed to.
    working_orders: int = 0
    working_notional: float = 0.0
    limits: dict[str, float]
    session_date: str


class KillSwitchRequest(BaseModel):
    reason: str = "Manual override"
    symbol: str | None = None


class ReduceOnlyRequest(BaseModel):
    enabled: bool = True
    reason: str = "Operator soft halt"
    symbol: str | None = None


# --------------------------------------------------------------------------- #
# Module C — Backtest
# --------------------------------------------------------------------------- #
class BacktestRequest(BaseModel):
    """Every tunable a sweep accepts, with its bounds.

    This model is the parameter registry: the bounds and descriptions here are
    what ``/docs`` publishes, so a researcher reads one place to learn what can
    be varied and how far. Widening a bound is therefore a documented change,
    not a silent one.
    """

    symbol: str = Field(default="BTCUSDT", description="Instrument to test, e.g. BTCUSDT.")
    interval: str = Field(default="1h", description="Bar size: 15m, 1h, 4h or 1d.")
    bars: int = Field(default=1500, ge=200, le=5000,
                      description="History depth in bars. Fewer than ~500 makes walk-forward folds too short to read.")
    strategy: Literal["ma_cross", "donchian", "rsi_reversion"] = Field(
        default="ma_cross", description="Signal family. Each interprets fast/slow as its own two parameters.")
    fast_min: int = Field(default=5, ge=2, le=400, description="Lower bound of the fast-parameter sweep.")
    fast_max: int = Field(default=40, ge=2, le=400, description="Upper bound of the fast-parameter sweep.")
    fast_step: int = Field(default=5, ge=1, le=100, description="Grid spacing for the fast parameter.")
    slow_min: int = Field(default=20, ge=3, le=800, description="Lower bound of the slow-parameter sweep.")
    slow_max: int = Field(default=200, ge=3, le=800, description="Upper bound of the slow-parameter sweep.")
    slow_step: int = Field(default=20, ge=1, le=200, description="Grid spacing for the slow parameter.")
    fee_bps: float = Field(default=6.0, ge=0, le=100,
                           description="Per-side taker fee in basis points, charged on turnover.")
    slippage_bps: float = Field(default=2.0, ge=0, le=100,
                                description="Per-side slippage assumption in basis points. Setting both cost "
                                            "fields to 0 produces a frictionless result that will not survive live.")
    direction: Literal["long_only", "long_short"] = Field(
        default="long_only", description="Whether short signals are traded or flattened to cash.")
    walk_forward: bool = Field(default=True,
                               description="Run out-of-sample folds. Disable only for a quick in-sample look.")
    folds: int = Field(default=4, ge=2, le=10, description="Number of walk-forward folds.")
    embargo_bars: int = Field(
        default=0, ge=0, le=500,
        description="Bars discarded between each training window and its test window. Guards against "
                    "leakage from indicator lookback spanning the boundary; 0 keeps folds adjacent.")
    label: str | None = Field(
        default=None, max_length=120,
        description="Optional human label for this run, stored with the audit record.")
    notify_chat_id: str | None = Field(
        default=None, description="Telegram chat to notify when the job finishes.")

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
    # Where the in-sample winner actually placed out-of-sample, among all
    # combinations scored on this fold. Rank 1 of 40 means the choice held up;
    # rank 33 of 40 means the fold selected noise. This is the per-fold input to
    # the probability-of-backtest-overfitting estimate.
    oos_rank: int | None = None
    combos_ranked: int | None = None
    embargo_bars: int = 0


class BacktestResult(BaseModel):
    job_id: str
    request: BacktestRequest
    engine: str
    data_source: str
    bars: int
    period_start: str
    period_end: str
    # Content hash of the bars this run saw. A date range does not identify a
    # dataset — a revised bar, a different venue, or the synthetic fallback all
    # produce the same window with different numbers. Two runs sharing this
    # value provably compared the same prices.
    data_hash: str | None = None
    combos_tested: int
    best: ParamResult
    benchmark_buy_hold: dict[str, float]
    top_results: list[ParamResult]
    deflated_sharpe_ratio: float
    probabilistic_sharpe_ratio: float
    # Minimum Track Record Length at 95% confidence vs a zero benchmark — how
    # many bars this Sharpe would need to be statistically real. None when the
    # per-bar Sharpe is not positive (no finite record proves an absent edge).
    min_track_record_bars: float | None = None
    dsr_verdict: str
    walk_forward: list[WalkForwardFold]
    walk_forward_oos_sharpe: float | None
    # Fraction of folds whose in-sample winner placed in the worse half
    # out-of-sample. High values mean the grid search is selecting noise.
    overfitting_probability: float | None = None
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
