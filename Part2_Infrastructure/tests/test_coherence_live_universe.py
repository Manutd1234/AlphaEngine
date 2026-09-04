"""Broad live-family discovery uses one listing and chunked book reads."""

from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest
from coherence_fixtures import markets

from modules.coherence.drivers.kalshi_rest import KalshiUnavailable
from modules.coherence.syscalls.live_universe import observe_live_families


def _family(number: int, market_count: int = 1) -> dict:
    event_ticker = f"KXTEST{number}-26SEP"
    rows = []
    for index in range(market_count):
        row = deepcopy(markets("markets_ladder")[0])
        row["event_ticker"] = event_ticker
        row["ticker"] = f"{event_ticker}-M{index}"
        rows.append(row)
    return {
        "event_ticker": event_ticker,
        "series_ticker": f"KXTEST{number}",
        "title": f"Live family {number}",
        "category": "Economics",
        "mutually_exclusive": True,
        "exchange_index": 0,
        "markets": rows,
    }


class Venue:
    def __init__(self, families: list[dict], *, cursor: str = "", books_fail: bool = False) -> None:
        self.families = families
        self.cursor = cursor
        self.books_fail = books_fail
        self.event_calls: list[dict] = []
        self.book_calls: list[list[str]] = []

    async def events(self, **kwargs):
        self.event_calls.append(kwargs)
        return SimpleNamespace(payload={"events": self.families, "cursor": self.cursor})

    async def orderbooks(self, tickers):
        self.book_calls.append(list(tickers))
        if self.books_fail:
            raise KalshiUnavailable("depth route timed out")
        return SimpleNamespace(payload={
            "orderbooks": [
                {
                    "ticker": ticker,
                    "orderbook_fp": {
                        "yes_dollars": [["0.4000", "10.00"]],
                        "no_dollars": [["0.5900", "12.00"]],
                    },
                }
                for ticker in tickers
            ]
        })


@pytest.mark.anyio
async def test_two_hundred_families_need_one_listing_and_bounded_bulk_book_calls() -> None:
    venue = Venue([_family(index) for index in range(200)], cursor="NEXT")

    batch = await observe_live_families(venue)  # type: ignore[arg-type]

    assert len(batch.observations) == 200
    assert venue.event_calls == [{"status": "open", "limit": 200, "nested": True}]
    assert [len(call) for call in venue.book_calls] == [100, 100]
    assert len({item.ts_ns for item in batch.observations}) == 1
    assert batch.observations[0].event.category == "Economics"
    assert any("bounded to the first 200" in note for note in batch.notes)


@pytest.mark.anyio
async def test_family_limit_cannot_turn_one_poll_into_a_cursor_crawl() -> None:
    venue = Venue([_family(index) for index in range(200)])

    await observe_live_families(venue, 999)  # type: ignore[arg-type]

    assert venue.event_calls == [{"status": "open", "limit": 200, "nested": True}]


@pytest.mark.anyio
async def test_books_are_chunked_at_the_venue_limit() -> None:
    venue = Venue([_family(1, 101)])

    batch = await observe_live_families(venue, 1)  # type: ignore[arg-type]

    assert [len(call) for call in venue.book_calls] == [100, 1]
    assert len(batch.observations[0].markets) == 101
    assert batch.observations[0].depth == "full"


@pytest.mark.anyio
async def test_a_depth_failure_keeps_current_top_of_book_and_says_so() -> None:
    venue = Venue([_family(1, 2)], books_fail=True)

    batch = await observe_live_families(venue, 1)  # type: ignore[arg-type]

    observation = batch.observations[0]
    assert len(observation.markets) == 2
    assert observation.depth == "top_of_book"
    assert "2 of 2 full books were unavailable" in observation.notes[0]
    assert "depth route timed out" in observation.notes[0]


@pytest.fixture
def anyio_backend():
    return "asyncio"
