"""``observe`` — pull one snapshot of the watchlist.

The engine's first verb. Everything downstream reads an ``Observation``, and
nothing downstream reaches for the network, so a replay of a recorded tape and
a live poll are the same call with a different driver.

The read is deliberately shaped around Kalshi's economics rather than around
what is convenient: one bulk orderbook call buys up to a hundred books for a
single request's tokens, which is the difference between watching fifty markets
and watching the exchange. The engine's reach is then set by how many tickers
it can name, not by the rate limit.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Sequence

from modules.coherence.drivers.kalshi_parse import Event, Market, ParseError, parse_event, parse_orderbooks
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiRefused, KalshiUnavailable
from modules.coherence.kernel.book import Book

logger = logging.getLogger(__name__)

# One bulk call's worth. Kalshi caps the route at 100 tickers.
BULK_CHUNK = 100

# How many events of one series are read at once. Three keeps a four-family
# panel inside the web gateway's eight-second deadline without turning a poll
# into a burst the exchange sees as a spike.
CONCURRENT_EVENT_READS = 3


@dataclass(frozen=True, slots=True)
class MarketObservation:
    """One market and the book it was quoting, with how the book was obtained."""

    market: Market
    book: Book

    @property
    def ticker(self) -> str:
        return self.market.ticker


@dataclass(slots=True)
class Observation:
    """One poll of one event family.

    ``notes`` carries what went wrong without failing the whole observation: a
    book that could not be read is one missing market, not a dead poll, and the
    surface has to be able to say which.
    """

    ts_ns: int
    event: Event
    markets: list[MarketObservation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    depth: str = "full"

    @property
    def complete(self) -> bool:
        """True when every open market in the event came back with a book."""
        return not self.notes and len(self.markets) == len([m for m in self.event.markets if m.is_open])

    def to_summary(self) -> dict[str, Any]:
        return {
            "event_ticker": self.event.event_ticker,
            "series_ticker": self.event.series_ticker,
            "mutually_exclusive": self.event.mutually_exclusive,
            "exchange_index": self.event.exchange_index,
            "markets_observed": len(self.markets),
            "markets_in_event": len(self.event.markets),
            "depth": self.depth,
            "complete": self.complete,
            "notes": list(self.notes),
        }


async def observe_event(client: KalshiClient, event_ticker: str) -> Observation:
    """Read one event and every book in it.

    Two calls: the event with its nested markets, then one bulk orderbook call
    for all of its tickers. On a 401 from the orderbook route — the access
    Kalshi's own documents disagree about — this falls back to the top-of-book
    fields on the market objects, which are unambiguously public, and marks the
    whole observation ``top_of_book`` so that no depth question is answered
    from data that cannot answer it.
    """
    fetched = await client.event(event_ticker, nested=True)
    try:
        event = parse_event(fetched.payload)
    except ParseError as exc:
        raise KalshiUnavailable(f"{event_ticker} did not parse: {exc}") from exc

    observation = Observation(ts_ns=time.time_ns(), event=event)
    tradable = [market for market in event.markets if market.is_open]
    if not tradable:
        observation.notes.append("no market in this event is currently active")
        return observation

    try:
        books = await _bulk_books(client, [market.ticker for market in tradable])
    except KalshiRefused as exc:
        observation.depth = "top_of_book"
        observation.notes.append(
            f"orderbook route refused an unauthenticated read ({exc.status}); "
            "using the market object's top of book, which cannot answer a depth question"
        )
        observation.markets = [MarketObservation(market=market, book=market.top) for market in tradable]
        return observation

    for market in tradable:
        book = books.get(market.ticker)
        if book is None:
            observation.notes.append(f"{market.ticker} returned no book")
            continue
        observation.markets.append(MarketObservation(market=market, book=book))
    return observation


async def _bulk_books(client: KalshiClient, tickers: Sequence[str]) -> dict[str, Book]:
    """Every book, in chunks of the route's own limit."""
    books: dict[str, Book] = {}
    for start in range(0, len(tickers), BULK_CHUNK):
        chunk = tickers[start : start + BULK_CHUNK]
        fetched = await client.orderbooks(chunk)
        books.update(parse_orderbooks(fetched.payload))
    return books


def _listed_event_tickers(payload: dict[str, Any]) -> list[str]:
    """Unique event tickers in venue order from one markets page."""
    tickers: list[str] = []
    seen: set[str] = set()
    for row in payload.get("markets") or []:
        ticker = str(row.get("event_ticker", ""))
        if ticker and ticker not in seen:
            tickers.append(ticker)
            seen.add(ticker)
    return tickers


def _require_complete_listing(
    series_ticker: str,
    payload: dict[str, Any],
    event_tickers: Sequence[str],
    max_events: int,
) -> None:
    """Refuse known namespace gaps before spending per-event reads."""
    if payload.get("cursor"):
        raise KalshiUnavailable(
            f"{series_ticker} /markets listing has another page; complete read stopped at the first page"
        )
    if len(event_tickers) > max_events:
        raise KalshiUnavailable(
            f"{series_ticker} has {len(event_tickers)} open events; a complete read is capped at {max_events}"
        )


async def _observe_events(
    client: KalshiClient,
    event_tickers: Sequence[str],
) -> tuple[list[Observation], list[str]]:
    """Read events behind one bounded semaphore and retain typed failures."""
    gate = asyncio.Semaphore(CONCURRENT_EVENT_READS)

    async def read(event_ticker: str) -> tuple[Observation | None, str | None]:
        async with gate:
            try:
                return await observe_event(client, event_ticker), None
            except KalshiUnavailable as exc:
                logger.warning("coherence: %s could not be observed (%s)", event_ticker, exc.reason)
                return None, f"{event_ticker}: {exc.reason}"

    results = await asyncio.gather(*(read(ticker) for ticker in event_tickers))
    observations = [observation for observation, _failure in results if observation is not None]
    failures = [failure for _observation, failure in results if failure is not None]
    return observations, failures


def _strict_observation_failures(
    observations: Sequence[Observation],
    failures: Sequence[str],
) -> list[str]:
    """Add every missing open-market path to per-event read failures."""
    strict_failures = list(failures)
    for observation in observations:
        expected = {market.ticker for market in observation.event.markets if market.is_open}
        seen = {market.ticker for market in observation.markets}
        missing = sorted(expected - seen)
        if missing:
            strict_failures.append(
                f"{observation.event.event_ticker}: missing open-market books for {', '.join(missing)}"
            )
    return strict_failures


async def observe_series(
    client: KalshiClient,
    series_ticker: str,
    max_events: int = 12,
    *,
    require_complete: bool = False,
) -> list[Observation]:
    """Every open event in one series, read concurrently.

    ``max_events`` bounds the walk rather than the data: a series with hundreds
    of open events would otherwise spend a poll's whole budget on one series and
    starve the rest of the watchlist. When it bites, the observation says so.

    **The events are read in parallel, and that is a correctness fix rather than
    a speed-up.** Read serially, each event costs two round trips, and a
    four-event series took 10.1 seconds against the web gateway's 8-second
    deadline — so the panel that asks for four families reliably received a
    timeout and sat on its loading state forever. Wall time is now bounded by
    the slowest event rather than by their sum.

    The concurrency is bounded, and the bound is not about politeness: the read
    budget is a token bucket, so an unbounded fan-out does not spend more in
    total but does spend it in one burst, which is the shape a rate limiter is
    least forgiving of.
    """
    fetched = await client.markets(series_ticker, status="open", limit=1000)
    event_tickers = _listed_event_tickers(fetched.payload)

    # A complete namespace already cannot be produced from this listing. Refuse
    # before spending event and orderbook calls on a result strict callers must
    # discard anyway.
    if require_complete:
        _require_complete_listing(series_ticker, fetched.payload, event_tickers, max_events)

    wanted = event_tickers[:max_events]
    observations, failures = await _observe_events(client, wanted)

    # Most consumers can still use the events that answered. A filesystem
    # listing cannot: a skipped event, a capped series or an event with a missing
    # open-market book would each look exactly like a path that does not exist.
    # The Shell opts into this stricter namespace contract so none of those
    # partial reads can become a false `missing` answer. Notes alone are not a
    # namespace gap: the top-of-book fallback still names every market path.
    if require_complete:
        strict_failures = _strict_observation_failures(observations, failures)
        if strict_failures:
            raise KalshiUnavailable("; ".join(strict_failures))

    if len(event_tickers) > max_events:
        for observation in observations:
            observation.notes.append(
                f"{series_ticker} has {len(event_tickers)} open events; this poll read the first {max_events}"
            )
    return observations
