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

from modules.schemas_coherence_proof import CoherenceProofConstraintLeg as CoherenceProofConstraintLeg
from modules.schemas_coherence_proof import CoherenceProofConstraintRow as CoherenceProofConstraintRow
from modules.schemas_coherence_proof import CoherenceProofConstraints as CoherenceProofConstraints
from modules.schemas_coherence_proof import CoherenceProofEvidence as CoherenceProofEvidence
from modules.schemas_coherence_proof import CoherenceProofObservation as CoherenceProofObservation
from modules.schemas_coherence_proof import CoherenceProofSolver as CoherenceProofSolver
from modules.schemas_coherence_status import CoherenceBudgetStatus as CoherenceBudgetStatus
from modules.schemas_coherence_status import CoherenceHostStatus as CoherenceHostStatus
from modules.schemas_coherence_status import (
    CoherenceObservationCampaignStatus as CoherenceObservationCampaignStatus,
)
from modules.schemas_coherence_status import CoherenceRecorderStatus as CoherenceRecorderStatus
from modules.schemas_coherence_status import (
    CoherenceRecorderStorageStatus as CoherenceRecorderStorageStatus,
)
from modules.schemas_coherence_status import CoherenceShardStatus as CoherenceShardStatus
from modules.schemas_coherence_status import CoherenceStatus as CoherenceStatus


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
    # Size, as the venue published it. Strings for the reason every price here
    # is a string, and nullable for a different reason: absent means the key
    # was not sent, while "0.00" means the exchange looked and found nothing.
    # A desk that renders those the same way invents an empty book.
    open_interest: str | None = None
    liquidity: str | None = None
    volume: str | None = None
    notional_value: str | None = None


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
    # The family's own size, and the denominator any per-outcome share is read
    # against. Withheld entirely when one leg has no figure, for the reason
    # `basket_totals` withholds a price total: a sum over the legs that
    # answered understates the family by exactly the legs it skipped, and a
    # share against an understated denominator reads too large.
    open_interest_total: str | None = None
    liquidity_total: str | None = None


class CoherenceUniverse(BaseModel):
    """The watchlist, as far as it could be read."""

    #: How old the venue read behind this answer was, in seconds, at the moment
    #: this response was composed. Null when the answer came straight from the
    #: exchange on this request, which is its own answer: it is as fresh as the
    #: request.
    #:
    #: AN AGE, NOT A TIMESTAMP, and the difference is not pedantry. A timestamp
    #: has to be subtracted from a clock, and the clock that would do it belongs
    #: to the reader's laptop rather than to this process — so a machine a few
    #: seconds ahead would render "12s in the future", which is worse than no
    #: stamp at all. An age is computed here, against the clock that took the
    #: reading, and survives any skew between the two.
    #:
    #: The desk needs it because a precomputed answer arrives in two
    #: milliseconds and is not two milliseconds old; stamping it "0s ago" would
    #: make the desk faster and its own clock a liar.
    observed_age_s: float | None = None
    state: str
    events: list[CoherenceEventView] = Field(default_factory=list)
    watchlist: list[str] = Field(default_factory=list)
    # What each watched series is ABOUT, keyed by series ticker — Kalshi's own
    # `category` ("Crypto", "Climate and Weather"), never inferred from the
    # ticker. A series missing from this map is one the exchange would not
    # answer for, which the surface reports rather than filling in.
    categories: dict[str, str] = Field(default_factory=dict)
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


class CoherenceCertificateLeg(BaseModel):
    """One order in a proposed portfolio, with its fees broken out."""

    ticker: str
    label: str
    direction: str
    price: str
    size: str
    notional: str
    trade_fee: str
    rounding_fee: str
    rebate: str
    net_fee: str


class CoherenceCertificate(BaseModel):
    """One coherence result, whether or not it found anything.

    Produced on the healthy case too: a detector silent when all is well leaves
    a caller unable to tell "no opportunity" from "the feed is down", and this
    engine's most common — and correct — answer is that the market is coherent.
    """

    #: How old the venue read behind this answer was, in seconds, at the moment
    #: this response was composed. Null when the answer came straight from the
    #: exchange on this request, which is its own answer: it is as fresh as the
    #: request.
    #:
    #: AN AGE, NOT A TIMESTAMP, and the difference is not pedantry. A timestamp
    #: has to be subtracted from a clock, and the clock that would do it belongs
    #: to the reader's laptop rather than to this process — so a machine a few
    #: seconds ahead would render "12s in the future", which is worse than no
    #: stamp at all. An age is computed here, against the clock that took the
    #: reading, and survives any skew between the two.
    #:
    #: The desk needs it because a precomputed answer arrives in two
    #: milliseconds and is not two milliseconds old; stamping it "0s ago" would
    #: make the desk faster and its own clock a liar.
    observed_age_s: float | None = None
    verdict: str
    engine: str
    component_id: str
    series_ticker: str
    exchange_index: int
    #: The prices admit no probability measure, but no portfolio survives the
    #: fees. Carried beside ``verdict`` rather than folded into it: reporting
    #: a family quoted at $0.98 for a dollar as simply "coherent" would state
    #: something false about the prices in order to say something true about
    #: the trade, and holding those apart is what this engine is for.
    priced_out: bool = False
    family: str = ""
    because: str = ""
    scope: str = "same-event"
    tier: int = 1
    tier_note: str = ""
    legs: list[CoherenceCertificateLeg] = Field(default_factory=list)
    gross_edge: str | None = None
    worst_case_payoff: str | None = None
    total_fees: str | None = None
    net_edge: str | None = None
    #: The linear programme's optimum, six-decimal, signed: the most any
    #: portfolio of these quotes can guarantee itself in the worst state before
    #: fees. At or below zero exactly when a probability measure exists, which
    #: makes it the one figure a COHERENT certificate can report — the other
    #: four describe a portfolio, and a coherent verdict has none. ``None`` from
    #: the closed-form engine, which solves no programme.
    margin: str | None = None
    worth_doing: bool = False
    rows_tested: int = 0
    rows_untestable: int = 0
    notes: list[str] = Field(default_factory=list)
    proof: str = ""
    proof_evidence: CoherenceProofEvidence | None = None


class CoherenceFeeFill(BaseModel):
    """What one fill of a worked example cost, component by component."""

    trade_fee: str
    rounding_fee: str
    rebate: str
    net: str
    notional: str


class CoherenceFees(BaseModel):
    """The three-component fee, worked through at a price and a size."""

    state: str
    price: str
    contracts: str
    fills: int
    multiplier: str
    balance_precision: str
    per_fill: list[CoherenceFeeFill] = Field(default_factory=list)
    total: CoherenceFeeFill | None = None
    net_as_fraction_of_notional: str | None = None
    minimum_clip: str | None = None
    minimum_clip_note: str = ""
    naive_threshold: str = "1.0000"
    fee_aware_threshold: str | None = None
    notes: list[str] = Field(default_factory=list)


class CoherenceIndexPoint(BaseModel):
    """One reading of the index. ci is null when it could not be measured."""

    ts_ns: int
    series_ticker: str
    event_ticker: str
    exchange_index: int
    ci: str | None = None
    engine: str
    detail: str | None = None


class CoherenceIndexSeries(BaseModel):
    """The index over time, oldest first so a chart can plot it."""

    state: str
    points: list[CoherenceIndexPoint] = Field(default_factory=list)
    series: list[str] = Field(default_factory=list)
    measured: int = 0
    unmeasurable: int = 0
    notes: list[str] = Field(default_factory=list)
class CoherenceAblation(BaseModel):
    """What one configuration of the model found over the whole tape."""

    name: str
    description: str
    observations: int = 0
    violations: int = 0
    worth_doing: int = 0
    gross_total: str = "0"
    net_total: str = "0"
    untestable: int = 0
    notes: list[str] = Field(default_factory=list)


class CoherenceReplay(BaseModel):
    """The ablation harness's answer: which parts of the model change the answer.

    Not a P&L estimate. Replaying an arbitrage engine over its own recorded
    quotes cannot tell you what it would have earned — it could not have traded
    against every quote it recorded. What it can tell you is how many
    opportunities each configuration SEES, and the gap between the naive test
    and the fee-aware one is the number this project exists to produce.
    """

    state: str
    rows: int = 0
    observations: int = 0
    first_ts_ns: int = 0
    last_ts_ns: int = 0
    span_seconds: str = "0"
    ablations: list[CoherenceAblation] = Field(default_factory=list)
    headline: str = ""
    notes: list[str] = Field(default_factory=list)
