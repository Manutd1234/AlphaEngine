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
