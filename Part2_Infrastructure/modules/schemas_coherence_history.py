"""Wire shapes for the recorded tape, where the two coherence schema modules end.

``schemas_coherence.py`` and ``schemas_coherence_lab.py`` are both within twenty
lines of the 400-line house ceiling, so this is a third module rather than a
shave to buy the room — the rule is to split, and the seam is the honest one:
everything here describes a series read back off ``book_snapshots``, which is
the recorder's table and nobody else's.

**A STATE, NOT AN EMPTY LIST.** Four answers are genuinely different and the
whole route exists to keep them apart, because every one of them would otherwise
reach a reader as "no data":

    unavailable    the tape would not open at all
    unconfigured   the recorder has never run here, so nothing was ever written
    empty          the tape is real and holds nothing for THIS market
    ok             a series

That distinction is the same one ``RfqPane``'s four-state table defends on the
desk, and it is worth the field: a reader looking at an empty chart cannot
otherwise tell a market nobody watched from a deployment that never recorded.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CoherenceBookHistoryPoint(BaseModel):
    """One recorded book, as prices rather than ladders.

    ``implied_yes_ask`` is DERIVED — Kalshi sends two bid ladders and no asks, so
    the YES ask a reader trades against is a dollar less the NO bid. It is named
    for what it is so nothing downstream can mistake it for a quote the venue
    sent, and it is null whenever the NO side was unquoted: a market with no NO
    bid has no implied ask, and a zero there is a free option.
    """

    ts_ns: int
    ticker: str
    event_ticker: str | None = None
    series_ticker: str | None = None
    best_yes_bid: str | None = None
    best_no_bid: str | None = None
    implied_yes_ask: str | None = None
    #: ``full`` or ``top_of_book`` — how deep the read that recorded this reached.
    depth: str = "top_of_book"
    #: Which driver wrote the row, so a replayed fixture cannot pass as a live read.
    source: str = "unknown"


class CoherenceBookHistory(BaseModel):
    """One market's recorded quotes, oldest first so a chart can plot it."""

    state: str
    ticker: str | None = None
    points: list[CoherenceBookHistoryPoint] = Field(default_factory=list)
    #: What the tape DOES hold, when it holds nothing for the ticker asked for.
    #: An empty series and a mistyped ticker are different answers.
    recorded: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class CoherenceFeeCurvePoint(BaseModel):
    """The three components at one price, for a fixed size and fill count.

    Every figure is a string for the reason the rest of this engine's money is:
    these are exact fixed-point quantities and their last places are the
    finding. ``as_fraction_of_notional`` is null at a price of zero — nothing
    was traded, so there is no notional to be a fraction of, and a zero there
    would read as a free trade.
    """

    price: str
    trade_fee: str
    rounding_fee: str
    rebate: str
    net: str
    notional: str
    as_fraction_of_notional: str | None = None


class CoherenceFeeCurve(BaseModel):
    """The fee at every price the venue quotes, for one size and fill count.

    `/api/coherence/fees` works ONE case through — Kalshi's own documented
    example, where the component nobody models is nineteen times the one
    everybody does. It cannot answer the question that example raises, which is
    whether that ratio is a property of that price or of the schedule; and the
    desk drew a parabola for it from a formula written in the browser, which is
    a third implementation of arithmetic Python is the reference for.

    So the whole curve is computed once, here, by the same kernel the worked
    example uses. Pure arithmetic: no venue call, no tape, one read.
    """

    state: str
    #: Contracts, to a hundredth — the same fixed-point form `/fees` takes.
    contracts: str
    fills: int
    multiplier: str
    balance_precision: str
    points: list[CoherenceFeeCurvePoint] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Violation episodes
#
# MOVED HERE FROM `schemas_coherence.py` on 2026-08-26, when that module crossed
# the 400-line ceiling and the house rule is to split rather than shave prose.
# The seam was already drawn: this module is the shapes read back off the
# recorder's own tables, and `violation_episodes` is one of them. An episode is
# the recorder noticing a family stop admitting a probability and noticing it
# start again — a series, not a reading of now.
#
# `round_trip_source` on the collection is the reason that file grew: the
# verdict these episodes carry used to be decided against a query parameter's
# default that nothing ever passed, and the payload now says whether the figure
# it was decided against was measured.
# --------------------------------------------------------------------------- #


class CoherenceEpisodeSample(BaseModel):
    ts_ns: int
    ci: str | None = None


class CoherenceEpisode(BaseModel):
    """One violation, from the poll it appeared on to the poll it stopped."""

    component_id: str
    series_ticker: str
    event_ticker: str
    family: str
    exchange_index: int
    opened_ts_ns: int
    closed_ts_ns: int | None = None
    lifetime_s: str | None = None
    peak_ci: str | None = None
    peak_net_edge_dollars: str | None = None
    samples: list[CoherenceEpisodeSample] = Field(default_factory=list)


class CoherenceSurvivalPoint(BaseModel):
    t_s: str
    surviving: str


class CoherenceEpisodes(BaseModel):
    """Closed episodes and the survival curve they make."""

    state: str
    episodes: list[CoherenceEpisode] = Field(default_factory=list)
    open_episodes: int = 0
    survival: list[CoherenceSurvivalPoint] = Field(default_factory=list)
    median_s: str | None = None
    median_withheld_reason: str | None = None
    verdict: str = ""
    round_trip_s: str = "0.240"
    #: Where that figure came from. "measured" is the median read round trip
    #: this deployment has actually timed; "assumed" is the caller's parameter
    #: or its default, which nothing timed.
    #:
    #: A MEASURED READ IS A LOWER BOUND ON AN ORDER. An order carries a
    #: signature, is written rather than read, and queues behind a matching
    #: engine, so it is at least as slow. A verdict computed from the read is
    #: therefore OPTIMISTIC — it calls an opportunity tradeable slightly more
    #: often than an order path would — and every surface that draws it has to
    #: say so rather than presenting it as the cost of trading.
    round_trip_source: str = "assumed"
    #: How many reads the median was taken over. Zero when nothing was timed.
    round_trip_samples: int = 0
    notes: list[str] = Field(default_factory=list)
