"""The recorded tape, served through the interface the live driver has.

The only honest backtest available here, and it is nearly free because the
kernel is pure: ``certify`` takes an ``Observation`` and never asks where it
came from, so replaying a tape and polling the exchange are the same call with
a different source. If they were not — if the kernel reached for a clock or a
socket anywhere — a replay would be testing a second implementation and telling
you nothing about the first.

What this makes possible is the question the engine cannot answer live: **did
the cost model earn its complexity?** Run the same tape with a fee component
switched off and see whether the P&L distribution moves. Most sophistication in
this space has never been ablated, and the parts that survive an ablation are a
much shorter list than the parts that get written.

One property is load-bearing and asserted: replaying the same tape twice must
produce identical decisions. Any drift means something in the path is reading a
clock, and a backtest whose answer depends on when it ran is not evidence.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterator, Sequence

from modules.coherence.drivers.kalshi_parse import Event, Market
from modules.coherence.kernel.book import Book, parse_orderbook
from modules.coherence.kernel.grid import parse_price_ranges
from modules.coherence.syscalls.observe import MarketObservation, Observation

# Rows within this many nanoseconds of each other were written by one poll.
# Half a second is far longer than a poll's own duration and far shorter than
# any polling interval worth using, so it separates polls without splitting one.
POLL_WINDOW_NS = 500_000_000

# A replayed market carries no live grid, so a penny grid stands in. It is used
# only for display — replay does not place orders, so nothing snaps to it — and
# it is named rather than silent so a reader is not told the tape recorded
# something it did not.
REPLAY_GRID = [{"start": "0.0000", "end": "1.0000", "step": "0.0100"}]


@dataclass(frozen=True, slots=True)
class TapeRow:
    """One recorded book, as the store hands it back."""

    ts_ns: int
    ticker: str
    event_ticker: str
    series_ticker: str
    exchange_index: int
    mutually_exclusive: bool | None
    yes_ladder: str
    no_ladder: str
    depth: str
    source: str

    def to_book(self) -> Book:
        return parse_orderbook(
            self.ticker,
            {"yes_dollars": json.loads(self.yes_ladder), "no_dollars": json.loads(self.no_ladder)},
            depth=self.depth if self.depth in {"full", "top_of_book"} else "full",
        )


def rows_from_store(store, since_ts_ns: int = 0, limit: int = 50_000) -> list[TapeRow]:
    """Every recorded book, oldest first.

    Reads through the store's own query rather than touching DuckDB here: the
    tape's schema is the store's business, and a second reader that knew the
    column order would break silently the first time it changed.
    """
    with store._lock:  # noqa: SLF001 - replay is part of the store's own surface
        conn = store._connect()  # noqa: SLF001
        rows = conn.execute(
            """
            SELECT ts_ns, ticker, event_ticker, series_ticker, exchange_index, mutually_exclusive,
                   yes_ladder, no_ladder, depth, source
            FROM book_snapshots
            WHERE ts_ns >= ?
            ORDER BY ts_ns ASC
            LIMIT ?
            """,
            (int(since_ts_ns), int(limit)),
        ).fetchall()
    return [TapeRow(*row) for row in rows]


def group_into_polls(rows: Sequence[TapeRow]) -> Iterator[list[TapeRow]]:
    """Split a flat tape back into the polls that wrote it.

    Grouped by proximity in time rather than by an id, because the recorder does
    not write one: the books of a poll share a timestamp to the nanosecond when
    they came from one bulk call, and a window absorbs the case where they did
    not.
    """
    batch: list[TapeRow] = []
    anchor: int | None = None
    for row in rows:
        if anchor is None or row.ts_ns - anchor <= POLL_WINDOW_NS:
            anchor = anchor if anchor is not None else row.ts_ns
            batch.append(row)
            continue
        yield batch
        batch, anchor = [row], row.ts_ns
    if batch:
        yield batch


def observations_from(rows: Sequence[TapeRow]) -> Iterator[Observation]:
    """One poll's rows into one Observation per event family.

    The market objects are reconstructed with only what the tape recorded. What
    it did not record — strike types, settlement sources — is absent rather
    than invented, which limits replay to the constraint families that need
    only prices. That is a real limit and it is better than a fabricated strike.
    """
    grid = parse_price_ranges(REPLAY_GRID, "replay-penny-grid")
    for batch in group_into_polls(rows):
        by_event: dict[str, list[TapeRow]] = {}
        for row in batch:
            by_event.setdefault(row.event_ticker, []).append(row)
        for event_ticker, event_rows in by_event.items():
            first = event_rows[0]
            markets = tuple(
                Market(
                    ticker=row.ticker,
                    event_ticker=row.event_ticker,
                    series_ticker=row.series_ticker,
                    status="active",
                    strike_kind="unknown",
                    floor_strike=None,
                    cap_strike=None,
                    grid=grid,
                    exchange_index=row.exchange_index,
                    yes_sub_title=row.ticker.split("-")[-1],
                    top=row.to_book(),
                )
                for row in event_rows
            )
            event = Event(
                event_ticker=event_ticker,
                series_ticker=first.series_ticker,
                title=event_ticker,
                # Read from the tape rather than assumed. Older rows recorded
                # before the column existed carry NULL, and those replay as
                # non-exclusive — which under-tests them rather than asserting
                # a summation the recorder never saw.
                mutually_exclusive=bool(first.mutually_exclusive),
                exchange_index=first.exchange_index,
                settlement_sources=(),
                markets=markets,
            )
            observation = Observation(ts_ns=first.ts_ns, event=event, depth=first.depth)
            observation.markets = [
                MarketObservation(market=market, book=market.top) for market in markets
            ]
            observation.notes.append(
                "replayed from the tape: strike types and settlement sources were not recorded, "
                "so the ladder and bucket families are not tested here"
                + ("" if first.mutually_exclusive is not None else
                   "; this row predates the exclusivity column and replays as non-exclusive")
            )
            yield observation


def tape_span(rows: Sequence[TapeRow]) -> tuple[int, int, Decimal]:
    """``(first_ts, last_ts, seconds)`` — how much history there is."""
    if not rows:
        return 0, 0, Decimal(0)
    first, last = rows[0].ts_ns, rows[-1].ts_ns
    return first, last, (Decimal(last - first) / Decimal(1_000_000_000)).quantize(Decimal("0.001"))
