"""The settled-market corpus: forecasts joined to the answers they were about.

``calibration.py`` scores forecasts. This module makes them. A forecast is a
price, an outcome, and — the part that decides whether the score means anything —
a *horizon*: how long before the market closed the price was quoted.

Two sources, and they are not equally good.

**The tape.** ``book_snapshots`` holds every ladder the recorder saw. Join a
snapshot taken an hour before close to the market's settled result and you have
a genuine forecast: a price quoted while the answer was still unknown, scored
against what happened. This is the corpus worth having, and it exists only for
tickers the recorder was watching before they settled — which is why the
recorder runs continuously rather than on demand.

**The last trade.** ``GET /markets?status=settled`` returns ``last_price`` for
markets that have already resolved. It is public, instant, and nearly worthless
as a forecast: the last trade in a market happens seconds before settlement,
when the outcome is largely known, so scoring it measures how fast the exchange
converges rather than whether it was right. It is offered because it is the only
corpus available on a cold tape, and it is labelled ``final_trade`` everywhere it
appears so that nobody mistakes a good score for a good forecast.

The settlements table is written here rather than in ``store.py`` because it is
not part of the recorder's hot path: settlements arrive long after the books do,
in a separate pass, and a table that only one reader uses belongs with that
reader. It borrows the store's single connection under the store's lock, since
DuckDB gives a second writer an error rather than a queue.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

from modules.coherence.fs.store import CoherenceStore
from modules.coherence.kernel.calibration import Forecast

_SETTLEMENTS_DDL = """
CREATE TABLE IF NOT EXISTS settlements (
    ticker         VARCHAR NOT NULL,
    event_ticker   VARCHAR,
    series_ticker  VARCHAR,
    close_ts_ns    BIGINT,
    result         VARCHAR NOT NULL,
    last_price     DECIMAL(12,6),
    recorded_ts_ns BIGINT  NOT NULL
)
"""

#: How long before close a tape price has to have been quoted to count as a
#: forecast. An hour: long enough that the answer is genuinely open on the
#: hourly crypto series, short enough that a day's recording yields a corpus.
DEFAULT_HORIZON_S = 3600

#: A settled market's ``result`` is the venue's own word. Anything outside this
#: set — a void, a dispute, an amendment — is not an outcome to score and is
#: dropped rather than guessed at.
SCORABLE = {"yes", "no"}


@dataclass(frozen=True, slots=True)
class Settlement:
    """One market's answer, as the venue reported it."""

    ticker: str
    event_ticker: str
    series_ticker: str
    close_ts_ns: int | None
    result: str
    last_price: Decimal | None

    @property
    def outcome(self) -> bool | None:
        if self.result not in SCORABLE:
            return None
        return self.result == "yes"


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def ensure_table(store: CoherenceStore) -> None:
    with store.connection() as conn:
        conn.execute(_SETTLEMENTS_DDL)


def record_settlements(store: CoherenceStore, rows: Sequence[Settlement], now_ns: int) -> int:
    """Append settlements, skipping tickers already recorded.

    Append-only like the rest of the tape, but de-duplicated on ticker: a
    market settles once, and a second row for the same ticker would double its
    weight in every score computed afterwards.
    """
    if not rows:
        return 0
    with store.connection() as conn:
        conn.execute(_SETTLEMENTS_DDL)
        known = {
            item[0]
            for item in conn.execute(
                "SELECT ticker FROM settlements WHERE list_contains(?, ticker)",
                ([row.ticker for row in rows],),
            ).fetchall()
        }
        fresh = [row for row in rows if row.ticker not in known and row.outcome is not None]
        for row in fresh:
            conn.execute(
                "INSERT INTO settlements VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    row.ticker,
                    row.event_ticker,
                    row.series_ticker,
                    row.close_ts_ns,
                    row.result,
                    row.last_price,
                    now_ns,
                ),
            )
    return len(fresh)


def tape_forecasts(
    store: CoherenceStore,
    horizon_s: int = DEFAULT_HORIZON_S,
    limit: int = 5000,
) -> list[Forecast]:
    """Prices quoted at least ``horizon_s`` before close, scored against the result.

    One snapshot per ticker — the latest one that still sits outside the
    horizon. Taking every snapshot would weight a market by how long it was
    watched rather than by whether it was right, and a series polled every five
    minutes for a day would drown one polled for an hour.
    """
    horizon_ns = int(horizon_s) * 1_000_000_000
    with store.connection() as conn:
        conn.execute(_SETTLEMENTS_DDL)
        rows = conn.execute(
            """
            SELECT s.ticker, s.series_ticker, b.best_yes_bid, b.best_no_bid, s.result,
                   (s.close_ts_ns - b.ts_ns) / 1000000000 AS horizon_s
            FROM (
                SELECT ticker, ts_ns, best_yes_bid, best_no_bid,
                       ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ts_ns DESC) AS recency
                FROM book_snapshots
            ) b
            JOIN settlements s ON s.ticker = b.ticker
            WHERE s.close_ts_ns IS NOT NULL
              AND b.ts_ns <= s.close_ts_ns - ?
              AND b.recency >= 1
            QUALIFY ROW_NUMBER() OVER (PARTITION BY s.ticker ORDER BY b.ts_ns DESC) = 1
            LIMIT ?
            """,
            (horizon_ns, int(limit)),
        ).fetchall()

    built: list[Forecast] = []
    for ticker, series, yes_bid, no_bid, result, horizon in rows:
        if result not in SCORABLE:
            continue
        bid = _decimal(yes_bid)
        other = _decimal(no_bid)
        # The mid of the two bid ladders, which is the book's own estimate.
        # A one-sided book gives the bid alone; an empty one gives nothing, and
        # nothing is not a forecast of zero.
        if bid is not None and other is not None:
            probability = (bid + (Decimal(1) - other)) / 2
        elif bid is not None:
            probability = bid
        else:
            continue
        built.append(
            Forecast(
                ticker=str(ticker),
                series_ticker=str(series or ""),
                probability=probability,
                outcome=result == "yes",
                horizon_s=int(horizon or 0),
            )
        )
    return built


def final_trade_forecasts(settlements: Sequence[Settlement]) -> list[Forecast]:
    """The cold-tape fallback: last traded price against the result.

    Horizon zero, on purpose. ``calibration.score`` reads that and says in its
    own words that the corpus is not a forecast test.
    """
    built: list[Forecast] = []
    for row in settlements:
        outcome = row.outcome
        if outcome is None or row.last_price is None:
            continue
        built.append(
            Forecast(
                ticker=row.ticker,
                series_ticker=row.series_ticker,
                probability=row.last_price,
                outcome=outcome,
                horizon_s=0,
            )
        )
    return built


def counts(store: CoherenceStore) -> dict[str, int]:
    with store.connection() as conn:
        conn.execute(_SETTLEMENTS_DDL)
        total = conn.execute("SELECT count(*) FROM settlements").fetchone()
    return {"settlements": int(total[0]) if total else 0}
