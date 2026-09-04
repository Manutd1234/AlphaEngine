"""Efficiently observe a broad page of live Kalshi event families.

One nested event-list response discovers up to 200 families and all of their
active market tickers. Chunked bulk-orderbook reads then hydrate those tickers
at 100 books per call. The page remains bounded at Kalshi's documented maximum;
the recorder expands markets inside that page without turning one poll into an
unbounded exchange crawl.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Sequence

from modules.coherence.drivers.kalshi_parse import ParseError, parse_event, parse_orderbooks
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.kernel.book import Book
from modules.coherence.syscalls.observe import BULK_CHUNK, MarketObservation, Observation

CONCURRENT_BULK_READS = 3


@dataclass(slots=True)
class LiveUniverseBatch:
    """One bounded page, with any page- or schema-level qualifications."""

    observations: list[Observation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    cursor: str = ""


async def _bulk_books(
    client: KalshiClient,
    tickers: Sequence[str],
) -> tuple[dict[str, Book], dict[str, str]]:
    """Read bounded chunks concurrently and retain failures by ticker."""
    gate = asyncio.Semaphore(CONCURRENT_BULK_READS)

    async def read(chunk: Sequence[str]) -> tuple[dict[str, Book], dict[str, str]]:
        async with gate:
            try:
                fetched = await client.orderbooks(chunk)
                return parse_orderbooks(fetched.payload), {}
            except (KalshiUnavailable, ParseError) as exc:
                reason = getattr(exc, "reason", None) or str(exc)
                return {}, {ticker: reason for ticker in chunk}

    chunks = [tickers[start : start + BULK_CHUNK] for start in range(0, len(tickers), BULK_CHUNK)]
    books: dict[str, Book] = {}
    failures: dict[str, str] = {}
    for chunk_books, chunk_failures in await asyncio.gather(*(read(chunk) for chunk in chunks)):
        books.update(chunk_books)
        failures.update(chunk_failures)
    return books, failures


async def observe_live_families(client: KalshiClient, limit: int = 200) -> LiveUniverseBatch:
    """Read one current page of families and every active market in that page.

    A failed full-depth chunk degrades only those tickers to the top-of-book
    fields carried by the same live event response. That preserves a current,
    explicitly qualified family instead of dropping it from the universe.
    """
    bounded = max(1, min(int(limit), 200))
    fetched = await client.events(status="open", limit=bounded, nested=True)
    rows = fetched.payload.get("events") or []
    events = []
    notes: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            notes.append("Kalshi returned a non-object event row; that family was skipped")
            continue
        try:
            events.append(parse_event(row))
        except ParseError as exc:
            ticker = str(row.get("event_ticker") or "unknown family")
            notes.append(f"{ticker} did not parse and was skipped: {exc}")

    tickers = list(dict.fromkeys(
        market.ticker for event in events for market in event.markets if market.is_open
    ))
    books, failures = await _bulk_books(client, tickers) if tickers else ({}, {})
    stamp = time.time_ns()
    observations: list[Observation] = []
    for event in events:
        tradable = [market for market in event.markets if market.is_open]
        observation = Observation(ts_ns=stamp, event=event)
        fallback_reasons: set[str] = set()
        for market in tradable:
            book = books.get(market.ticker)
            if book is None:
                book = market.top
                fallback_reasons.add(failures.get(market.ticker, "no full orderbook returned"))
            observation.markets.append(MarketObservation(market=market, book=book))
        if fallback_reasons:
            observation.depth = "top_of_book"
            observation.notes.append(
                f"{len([m for m in tradable if m.ticker not in books])} of {len(tradable)} full books "
                f"were unavailable; using the same live listing's top of book ({'; '.join(sorted(fallback_reasons))})"
            )
        if not tradable:
            observation.notes.append("no market in this event is currently active")
        observations.append(observation)

    cursor = str(fetched.payload.get("cursor") or "")
    if cursor:
        notes.append(
            f"Kalshi reports another page; this live snapshot is intentionally bounded to the first "
            f"{bounded} open families"
        )
    return LiveUniverseBatch(observations=observations, notes=notes, cursor=cursor)
