"""One market's quotes OVER TIME, and the four ways the tape is allowed to be empty.

`/api/coherence/books` answers what a market is quoted at now, and every book
pane on the desk draws that. It cannot answer the question a reader asks next —
what has it BEEN quoted at — and until this route nothing read `book_snapshots`
as a series at all, though the recorder has been filling it since it was
switched on. Depth is forward-only: a book nobody recorded at 14:32 cannot be
recovered at 14:33 from any endpoint, which is the whole reason the recorder
runs before any strategy code exists.

Four properties are worth a suite rather than a comment, and each is a way this
series could quietly start lying:

**THE IMPLIED ASK IS DERIVED AND MUST STAY NAMED AS SUCH.** Kalshi sends two BID
ladders and no asks, so the YES ask a reader trades against is a dollar less the
NO bid. It is computed on the Python side because that is this codebase's
reference for fixed-point arithmetic, and it is called `implied_yes_ask` so
nothing downstream can mistake it for a quote the venue sent.

**A MISSING SIDE STAYS MISSING.** A market with no NO bid has no implied ask.
Zero there is a free option — the most expensive coerced null this codebase
could have.

**THE NEWEST ROWS ARE THE ONES KEPT.** `ORDER BY ts_ns ASC LIMIT n` returns the
OLDEST n when the tape is longer than the limit, which is the wrong end for
"what has this been doing lately". The query takes the newest and reverses them,
so a reader gets the most recent window in plotting order.

**AN EMPTY SERIES HAS FOUR MEANINGS AND THEY ARE NOT INTERCHANGEABLE.**
`unavailable` is an outage; `unconfigured` means the recorder never ran here;
`empty` means the tape is real and holds nothing for this market; `ok` is a
series. Every one of them reaches a reader as "no data" otherwise, and only one
of them is normal. That is the same distinction `RfqPane`'s four-state table
defends on the desk.

Written before the implementation, per the slice's RED step.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.api import coherence_history as route_module
from modules.coherence import tunables
from modules.coherence.fs.quotes_history import book_history, recorded_tickers
from modules.coherence.fs.store import BookRow, CoherenceStore
from modules.coherence.kernel.book import Book, Level


@pytest.fixture
def store(tmp_path) -> CoherenceStore:
    """A private DuckDB file per test, so the desk's own tape is never touched."""
    return CoherenceStore(tmp_path / "coherence.duckdb")


def book(ticker: str, yes: str | None, no: str | None) -> Book:
    """One book with at most one level a side. `None` means nobody is bidding."""
    return Book(
        ticker=ticker,
        yes_bids=() if yes is None else (Level(price=Decimal(yes), size_hundredths=100),),
        no_bids=() if no is None else (Level(price=Decimal(no), size_hundredths=100),),
        depth="full",
    )


def row(ticker: str, ts_ns: int, yes: str | None, no: str | None) -> BookRow:
    return BookRow(
        ts_ns=ts_ns,
        ticker=ticker,
        event_ticker="KXHIGHNY-26AUG26",
        series_ticker="KXHIGHNY",
        exchange_index=0,
        mutually_exclusive=True,
        book=book(ticker, yes, no),
        source="test",
    )


class TestTheSeries:
    def test_it_comes_back_oldest_first(self, store: CoherenceStore) -> None:
        # A chart plots left to right. Newest-first would draw every series
        # backwards while every individual point stayed correct.
        store.record_books([row("KXA", ts, "0.40", "0.55") for ts in (3_000, 1_000, 2_000)])

        assert [p["ts_ns"] for p in book_history(store, "KXA")] == [1_000, 2_000, 3_000]

    def test_it_keeps_the_newest_rows_when_the_tape_is_longer_than_the_limit(
        self, store: CoherenceStore
    ) -> None:
        # The trap this exists for: `ORDER BY ts_ns ASC LIMIT 2` is the OLDEST
        # two, which answers a question nobody asked.
        store.record_books([row("KXA", ts, "0.40", "0.55") for ts in (1_000, 2_000, 3_000, 4_000)])

        assert [p["ts_ns"] for p in book_history(store, "KXA", limit=2)] == [3_000, 4_000]

    def test_one_ticker_never_carries_another_s_rows(self, store: CoherenceStore) -> None:
        store.record_books([row("KXA", 1_000, "0.40", "0.55"), row("KXB", 1_000, "0.10", "0.85")])

        assert [p["ticker"] for p in book_history(store, "KXA")] == ["KXA"]
        assert book_history(store, "KXA")[0]["best_yes_bid"] == "0.4000"

    def test_since_narrows_the_window(self, store: CoherenceStore) -> None:
        store.record_books([row("KXA", ts, "0.40", "0.55") for ts in (1_000, 2_000, 3_000)])

        assert [p["ts_ns"] for p in book_history(store, "KXA", since_ts_ns=2_000)] == [2_000, 3_000]


class TestTheImpliedAsk:
    def test_it_is_a_dollar_less_the_no_bid(self, store: CoherenceStore) -> None:
        store.record_books([row("KXA", 1_000, "0.40", "0.55")])

        point = book_history(store, "KXA")[0]
        assert point["best_no_bid"] == "0.5500"
        assert point["implied_yes_ask"] == "0.4500"
        # And it is NOT the YES bid, which is the number a reader would confuse
        # it with on a venue that sent asks.
        assert point["best_yes_bid"] == "0.4000"

    def test_an_unquoted_no_side_has_no_implied_ask(self, store: CoherenceStore) -> None:
        # Zero here is a free option. The dash is the whole point.
        store.record_books([row("KXA", 1_000, "0.40", None)])

        point = book_history(store, "KXA")[0]
        assert point["best_no_bid"] is None
        assert point["implied_yes_ask"] is None

    def test_an_unquoted_yes_side_still_carries_the_ask(self, store: CoherenceStore) -> None:
        # The two sides fail independently: no YES bid does not stop the NO
        # ladder implying an offer, and a row that dropped both would hide it.
        store.record_books([row("KXA", 1_000, None, "0.55")])

        point = book_history(store, "KXA")[0]
        assert point["best_yes_bid"] is None
        assert point["implied_yes_ask"] == "0.4500"


class TestWhatTheTapeHolds:
    def test_an_unrecorded_ticker_comes_back_empty(self, store: CoherenceStore) -> None:
        store.record_books([row("KXA", 1_000, "0.40", "0.55")])

        assert book_history(store, "KXNOBODY") == []

    def test_and_the_tape_can_say_what_it_does_hold(self, store: CoherenceStore) -> None:
        # So a reader who mistyped a ticker is shown the list rather than left
        # to guess whether the ticker was wrong or the recorder was off.
        store.record_books([row("KXA", 1_000, "0.40", "0.55"), row("KXB", 2_000, "0.10", "0.85")])

        # Newest activity first: the markets still being quoted are the ones a
        # reader is most likely to have meant.
        assert recorded_tickers(store) == ["KXB", "KXA"]

    def test_a_tape_with_no_books_at_all_lists_nothing(self, store: CoherenceStore) -> None:
        assert recorded_tickers(store) == []
        assert book_history(store, "KXA") == []


class TestWhichKindOfNothing:
    """The four states, and the ONE that was wrong when it was first written.

    Every one of these reaches a reader as "no data" otherwise, and the route
    exists to keep them apart. The order the branch asks its questions in is the
    property under test, and it is not a detail: the first implementation read
    ``COHERENCE_POLL_S`` first, so a deployment with a full tape and the recorder
    switched off — which is the commonest state a desk is ever in — reported that
    it had never recorded a book. Caught by running the route against this desk's
    own 43,302-row tape rather than by reading it.
    """

    @staticmethod
    async def ask(store: CoherenceStore, ticker: str, monkeypatch, *, poll: int, series: bool):
        monkeypatch.setattr(route_module, "get_store", lambda: store)
        monkeypatch.setattr(tunables, "POLL_SECONDS", poll)
        monkeypatch.setattr(tunables, "watchlist_configured", lambda: series)
        return await route_module.coherence_books_history(
            ticker=ticker, since_ts_ns=0, limit=600, _actor="test"
        )

    @pytest.mark.asyncio
    async def test_a_full_tape_with_the_recorder_off_is_not_unconfigured(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        # THE DEFECT, pinned. The tape holds books; the recorder is off. That is
        # a deployment that recorded yesterday, not one that never recorded.
        store.record_books([row("KXA", 1_000, "0.40", "0.55")])

        answer = await self.ask(store, "KXNOBODY", monkeypatch, poll=0, series=False)

        assert answer.state == "empty"
        assert answer.recorded == ["KXA"], "the reader is not told what the tape DOES hold"

    @pytest.mark.asyncio
    async def test_an_empty_tape_with_no_recorder_is_unconfigured(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        answer = await self.ask(store, "KXA", monkeypatch, poll=0, series=False)

        assert answer.state == "unconfigured"
        assert "COHERENCE_POLL_S" in answer.notes[0]

    @pytest.mark.asyncio
    async def test_an_empty_tape_with_a_running_recorder_is_merely_empty(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        # Configured and nothing written yet: the first poll has not landed.
        # Nothing is broken and nothing needs setting, so it must not read as
        # either an outage or a misconfiguration.
        answer = await self.ask(store, "KXA", monkeypatch, poll=15, series=True)

        assert answer.state == "empty"
        assert answer.recorded == []
        assert "not landed" in answer.notes[0]

    @pytest.mark.asyncio
    async def test_a_recorded_market_comes_back_ok(
        self, store: CoherenceStore, monkeypatch
    ) -> None:
        store.record_books([row("KXA", ts, "0.40", "0.55") for ts in (1_000, 2_000)])

        answer = await self.ask(store, "KXA", monkeypatch, poll=15, series=True)

        assert answer.state == "ok"
        assert [p.ts_ns for p in answer.points] == [1_000, 2_000]
        assert answer.points[0].implied_yes_ask == "0.4500"
