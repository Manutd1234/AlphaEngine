"""Order vocabulary and the Module A (TCA) wire contracts.

Split out of ``modules/schemas.py`` unchanged: every field name, type,
default and — critically — ORDER is byte-identical to what it was, because
``tools/openapi.json`` is generated from these classes and a digest gate in
the web build compares it. Moving a model between files is free; moving a
field inside one is a contract change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

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
