"""Wire contracts for the coherence engine.

Field ORDER is part of the contract here for the same reason it is in
``modules/schemas_market.py``: ``tools/openapi.json`` is generated from these
classes and a digest gate in the web build compares it. Moving a model between
files is free; reordering a field inside one is a contract change.

Prices and sizes cross the wire as **strings**, not numbers. The kernel holds
them as ``Decimal`` and JSON has one numeric type, so serialising a price as a
number would hand the browser a float and undo the argument the kernel exists
to make. The TypeScript side parses the strings the same way it parses Kalshi's.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CoherenceHostStatus(BaseModel):
    """Whether Kalshi answered, and which host did."""

    host: str
    reachable: bool
    detail: str | None = None


class CoherenceShardStatus(BaseModel):
    """One exchange instance. Collateral is per shard, so this is a hard gate."""

    exchange_index: int
    description: str
    exchange_active: bool
    trading_active: bool


class CoherenceRecorderStatus(BaseModel):
    """What the recorder has done, not what it was configured to do."""

    running: bool
    configured: bool
    poll_seconds: int
    watchlist: list[str]
    polls: int
    books_written: int
    seconds_since_last_poll: float | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    series_seen: list[str] = Field(default_factory=list)


class CoherenceBudgetStatus(BaseModel):
    """The client's model of its own read bucket, with the basis for it."""

    tokens_per_second: int
    burst: int
    tokens_available: float
    default_cost: int
    published_costs_known: int
    tokens_spent: int
    refusals: int
    basis: str


class CoherenceStatus(BaseModel):
    """Everything a reader needs to judge whether the rest of the tab is real."""

    state: str
    hosts: list[CoherenceHostStatus] = Field(default_factory=list)
    shards: list[CoherenceShardStatus] = Field(default_factory=list)
    schema_probe: dict[str, object] = Field(default_factory=dict)
    recorder: CoherenceRecorderStatus
    budget: CoherenceBudgetStatus
    tape: dict[str, object] = Field(default_factory=dict)
    solver: dict[str, object] = Field(default_factory=dict)
    signing: dict[str, object] = Field(default_factory=dict)
    dry_run: bool = True
    notes: list[str] = Field(default_factory=list)


class CoherenceMarketView(BaseModel):
    """One market as the desk renders it. Every price is a string or absent."""

    ticker: str
    event_ticker: str
    series_ticker: str
    yes_sub_title: str
    strike_kind: str
    floor_strike: str | None = None
    cap_strike: str | None = None
    exchange_index: int
    price_grid: str
    yes_bid: str | None = None
    no_bid: str | None = None
    yes_ask: str | None = None
    no_ask: str | None = None
    spread: str | None = None
    depth: str
    unquoted_reason: str | None = None


class CoherenceEventView(BaseModel):
    """A family of markets that resolve together."""

    event_ticker: str
    series_ticker: str
    title: str
    mutually_exclusive: bool
    exchange_index: int
    settlement_sources: list[str] = Field(default_factory=list)
    markets: list[CoherenceMarketView] = Field(default_factory=list)
    yes_ask_total: str | None = None
    yes_bid_total: str | None = None
    basket_note: str | None = None


class CoherenceUniverse(BaseModel):
    """The watchlist, as far as it could be read."""

    state: str
    events: list[CoherenceEventView] = Field(default_factory=list)
    watchlist: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class CoherenceBookLevel(BaseModel):
    """One resting level. Both fields are strings; neither is ever null."""

    price: str
    size: str


class CoherenceBookView(BaseModel):
    """One market's two bid ladders and the asks they imply.

    ``yes_bids`` and ``no_bids`` are what Kalshi published. ``yes_asks`` is
    derived, and is here so the desk never has to derive it twice.
    """

    ticker: str
    depth: str
    source: str
    ts_ns: int | None = None
    yes_bids: list[CoherenceBookLevel] = Field(default_factory=list)
    no_bids: list[CoherenceBookLevel] = Field(default_factory=list)
    yes_asks: list[CoherenceBookLevel] = Field(default_factory=list)
    best_yes_bid: str | None = None
    best_no_bid: str | None = None
    best_yes_ask: str | None = None
    best_no_ask: str | None = None
    spread: str | None = None
    identity_sum: str | None = None
    identity_one_plus_spread: str | None = None
    unquoted_reason: str | None = None


class CoherenceBooks(BaseModel):
    """A page of books, and where they were read from."""

    state: str
    origin: str
    books: list[CoherenceBookView] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
