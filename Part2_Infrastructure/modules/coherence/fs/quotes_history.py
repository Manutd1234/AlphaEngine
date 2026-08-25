"""One market's quotes over time, read back off the tape the recorder writes.

``store.latest_books`` answers "what is this quoted at" — the newest snapshot
per ticker, which is what every book pane on the desk draws. Nothing has ever
read the same table as a SERIES, and the rows are right there: the recorder
writes a ``book_snapshots`` row per watched market per poll, and has since it
was switched on. Depth is forward-only, so a book nobody recorded at 14:32
cannot be recovered at 14:33 from any endpoint — the whole reason the recorder
runs before any strategy code exists. This module is the first reader of what
that bought.

Beside ``calibration_store`` rather than inside ``store.py`` for the reason that
module gives twice over: ``store.py`` is at its length ceiling, and a query with
one reader belongs beside that reader. It borrows the store's connection under
the store's lock, because DuckDB gives a second writer an error rather than a
queue.

**THE LADDERS ARE NOT PARSED HERE.** Each row carries whole ``yes_ladder`` and
``no_ladder`` JSON, and a caller wanting depth can have them — but a time series
of best bids does not need them, and decoding two JSON documents per row across
a thousand rows to reach two numbers already in their own columns would be
paying for the parse twice. ``best_yes_bid`` and ``best_no_bid`` are columns
because the recorder found them worth promoting.

**THE IMPLIED ASK IS DERIVED HERE AND SAID TO BE DERIVED.** Kalshi sends two BID
ladders and no asks at all, so the YES ask a reader would trade against is
``1 − best_no_bid`` — the identity the Books section exists to make believable.
It is computed here rather than in the browser because the arithmetic is
fixed-point and Python is this codebase's reference for it; the field is named
``implied_yes_ask`` rather than ``yes_ask`` so nothing downstream can mistake it
for a quote the venue sent.

**A MISSING SIDE STAYS MISSING.** A market with no NO bid has no implied ask,
and the row carries a null rather than a zero — a zero here is a free option and
would be the most expensive kind of coerced null this codebase has.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from modules.coherence.fs.store import CoherenceStore
from modules.coherence.kernel.money import format_dollars

#: The columns read, in the order the rows come back.
COLUMNS: tuple[str, ...] = (
    "ts_ns",
    "ticker",
    "event_ticker",
    "series_ticker",
    "best_yes_bid",
    "best_no_bid",
    "depth",
    "source",
)

#: One dollar, in the fixed-point scale the wire and the kernel share.
_ONE = Decimal(1)


def _implied_ask(no_bid: Any) -> str | None:
    """A dollar less the NO bid, or nothing at all.

    Null in, null out, and never a zero: a market quoting no NO bid has no
    implied YES ask, and printing 0.0000 would offer a free option.
    """
    if no_bid is None:
        return None
    return format_dollars(_ONE - Decimal(str(no_bid)))


def book_history(
    store: CoherenceStore,
    ticker: str,
    since_ts_ns: int = 0,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    """One ticker's recorded books, oldest first so a chart can plot it.

    ``ORDER BY ts_ns ASC`` with a ``LIMIT`` returns the OLDEST rows when the tape
    is longer than the limit, which is the wrong end for a reader asking what a
    market has been doing. So the newest are taken first and the list is
    reversed here — the caller gets the most recent ``limit`` readings, in
    plotting order.

    Fully parameterised, including the ticker: an f-string would be safe today
    because every value is ours, but the habit is what the linter objects to and
    the ticker is the one value that comes from a query string.
    """
    with store.connection() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(COLUMNS)} FROM book_snapshots "  # noqa: S608 - a fixed tuple, never input
            "WHERE ticker = ? AND ts_ns >= ? ORDER BY ts_ns DESC LIMIT ?",
            (str(ticker), int(since_ts_ns), int(limit)),
        ).fetchall()

    out: list[dict[str, Any]] = []
    for row in reversed(rows):
        record = dict(zip(COLUMNS, row, strict=True))
        yes_bid = record["best_yes_bid"]
        no_bid = record["best_no_bid"]
        out.append(
            {
                "ts_ns": int(record["ts_ns"]),
                "ticker": str(record["ticker"]),
                "event_ticker": None if record["event_ticker"] is None else str(record["event_ticker"]),
                "series_ticker": None if record["series_ticker"] is None else str(record["series_ticker"]),
                "best_yes_bid": None if yes_bid is None else format_dollars(Decimal(str(yes_bid))),
                "best_no_bid": None if no_bid is None else format_dollars(Decimal(str(no_bid))),
                "implied_yes_ask": _implied_ask(no_bid),
                "depth": str(record["depth"]),
                "source": str(record["source"]),
            }
        )
    return out


def recorded_tickers(store: CoherenceStore, limit: int = 500) -> list[str]:
    """Every ticker the tape holds a book for, newest activity first.

    So a reader who asks for a market nobody recorded can be told what WAS
    recorded, rather than being handed an empty series and left to guess whether
    the ticker was wrong or the recorder was off. Those are different answers and
    the route says which.
    """
    with store.connection() as conn:
        rows = conn.execute(
            "SELECT ticker, max(ts_ns) AS newest FROM book_snapshots "
            "GROUP BY ticker ORDER BY newest DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [str(row[0]) for row in rows]
