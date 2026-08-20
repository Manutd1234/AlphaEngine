"""Module B — the order path: requests, decisions, working orders, risk state.

Split out of ``modules/schemas.py``; see that module's note on why field
order here is a wire contract and not a style choice.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from modules.schemas_market import OrderStatus, OrderType, Side, TimeInForce


# --------------------------------------------------------------------------- #
# Module B — Risk
# --------------------------------------------------------------------------- #
class PaperExecutionReference(BaseModel):
    """Trusted quote evidence for a paper equity order.

    The public web route obtains this server-side and the authenticated gateway
    consumes it. Browsers never choose the price or the provenance fields.
    """

    asset_class: Literal["equity"] = "equity"
    price: float = Field(gt=0)
    as_of: datetime
    source: str = Field(min_length=1, max_length=80)
    currency: Literal["USD"] = "USD"
    delayed: bool = False

    @field_validator("as_of")
    @classmethod
    def _timestamp_has_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("paper execution quote timestamp must include a timezone")
        return value

    @field_validator("source")
    @classmethod
    def _source_is_readable(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("paper execution quote source is required")
        return cleaned


class OrderRequest(BaseModel):
    symbol: str
    side: Side
    quantity: float | None = Field(default=None, gt=0)
    notional: float | None = Field(default=None, gt=0)
    order_type: OrderType = "MARKET"
    limit_price: float | None = Field(default=None, gt=0)
    strategy: str = "manual"
    client_order_id: str | None = None
    # Internal server-to-server evidence. The Vercel order route ignores any
    # browser-supplied value and constructs this only after a provider quote
    # passes its own data contract.
    paper_execution: PaperExecutionReference | None = None
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
        if self.paper_execution and not re.fullmatch(r"[A-Z]{1,5}(?:[.-][A-Z]{1,2})?", self.symbol):
            raise ValueError("paper equity symbols must be a US-style ticker, e.g. AAPL or BRK.B")
        return self

    @field_validator("side", mode="before")
    @classmethod
    def _side_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("order_type", mode="before")
    @classmethod
    def _type_upper(cls, v: Any) -> Any:
        return v.strip().upper() if isinstance(v, str) else v


# One pre-trade gate's verdict.
#
# A stdlib dataclass rather than a `BaseModel`, and the only schema here that
# is. Fifteen of these are constructed on every order, inside the timed section
# of `RiskProxy.submit`, which made their construction the largest single
# component of the desk's own decision latency:
#
#     pydantic BaseModel   8.79 us p50, 21.17 us p99.9   (15 checks)
#     dataclass(slots)     2.58 us p50,  4.00 us p99.9
#
# Nothing is given up for that. Pydantic v2 accepts a stdlib dataclass as a
# field type, so `RiskDecision.checks` serialises to identical JSON and
# generates an identical JSON Schema.
#
# Written as a comment and NOT a docstring on purpose: a dataclass's docstring
# becomes the `description` of its JSON Schema, so putting this here would
# publish an internal note about microseconds into the OpenAPI contract every
# client reads. `tools/export_openapi.py --check` catches that, which is how
# this was found.
#
# What IS given up is `.model_dump()` — use `dataclasses.asdict`. There is no
# validation either, which is the right trade only because every field is set
# by this repository's own gate code and never by a request body.
@dataclass(slots=True)
class CheckResult:
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
