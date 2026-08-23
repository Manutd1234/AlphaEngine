"""The book tape: append-only, whole ladders, its own file.

Store books, not prices. A current book cannot reconstruct a past one, and
candlesticks cannot tell you what size rested at $0.4700 three hours ago —
depth is forward-only, and missed depth is gone for good. So every poll writes
the whole ladder, and the questions this engine exists to answer (how long does
a dislocation survive? did moving crypto to its own shard change anything?) are
questions about a tape nobody can buy back later.

**Its own DuckDB file, beside the audit ledger rather than inside it.** The
audit log is evidence about decisions: single-writer, append-only by
convention, and deliberately fire-and-forget — ``_exec`` swallows a failed
write because a dropped telemetry row must never break a trade. This tape has
different properties. It is high-volume, it is the input to later analysis
rather than a record of an action, and a gap in it is a hole in a survival
curve. Sharing the ledger's one lock would make a recorder stall look like an
audit failure and vice versa, so the two stay apart.

**A lock conflict is a reported state, not a fallback.** ``AuditStore``
degrades to SQLite when DuckDB refuses; that is right for a ledger that must
accept a write. Here the honest answer is "the tape is unavailable, and this is
why" — a second store quietly recording to a different file would split the
tape in two and neither half would be complete.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Sequence

import duckdb

from modules.coherence.kernel.book import Book

# Whole ladders as JSON text rather than a row per level. A level table would be
# the normalised choice and the wrong one: the unit of truth is the book at an
# instant, every read wants the whole ladder back, and a partially-written book
# is not a smaller book but a false one.
_DDL: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS book_snapshots (
        ts_ns          BIGINT      NOT NULL,
        ticker         VARCHAR     NOT NULL,
        event_ticker   VARCHAR,
        series_ticker  VARCHAR,
        exchange_index INTEGER,
        mutually_exclusive BOOLEAN,
        yes_ladder     VARCHAR     NOT NULL,
        no_ladder      VARCHAR     NOT NULL,
        best_yes_bid   DECIMAL(12,6),
        best_no_bid    DECIMAL(12,6),
        depth          VARCHAR     NOT NULL,
        source         VARCHAR     NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS coherence_index (
        ts_ns          BIGINT      NOT NULL,
        series_ticker  VARCHAR     NOT NULL,
        event_ticker   VARCHAR     NOT NULL,
        exchange_index INTEGER,
        ci             DECIMAL(12,6),
        engine         VARCHAR     NOT NULL,
        detail         VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS violation_episodes (
        component_id      VARCHAR   NOT NULL,
        series_ticker     VARCHAR   NOT NULL,
        event_ticker      VARCHAR   NOT NULL,
        family            VARCHAR   NOT NULL,
        exchange_index    INTEGER,
        opened_ts_ns      BIGINT    NOT NULL,
        closed_ts_ns      BIGINT,
        peak_ci           DECIMAL(12,6),
        peak_net_edge     DECIMAL(12,6),
        samples           VARCHAR   NOT NULL
    )
    """,
)


class TapeUnavailable(RuntimeError):
    """The tape could not be opened or written. Reported, never worked around."""


@dataclass(frozen=True, slots=True)
class BookRow:
    """One book, ready to record. Built by the recorder, read by the store."""

    ts_ns: int
    ticker: str
    event_ticker: str
    series_ticker: str
    exchange_index: int
    #: The exchange's own exclusivity flag, carried onto the tape because it is
    #: the licence for "these prices sum to a dollar" and nothing downstream can
    #: recover it from the ladders.
    mutually_exclusive: bool
    book: Book
    source: str


def _ladder_json(levels: Sequence[Any]) -> str:
    """A ladder as the venue's own ``[[price, size], ...]``, ascending.

    Written back in the venue's shape so a row read years from now needs no
    knowledge of this module to interpret, and so a replay reconstructs exactly
    what the parser saw.
    """
    return json.dumps([[str(level.price), str(level.size)] for level in levels])


class CoherenceStore:
    """One connection, one lock, one file.

    The connection discipline is ``modules/audit/store.py``'s, for its reason:
    DuckDB takes an exclusive lock on the file, so a second connection in the
    same process is a deadlock waiting for a slow query.
    """

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        self._conn: duckdb.DuckDBPyConnection | None = None
        self._unavailable_reason: str | None = None

    def _connect(self) -> duckdb.DuckDBPyConnection:
        if self._conn is not None:
            return self._conn
        try:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = duckdb.connect(str(self.db_path))
        except (duckdb.Error, OSError) as exc:
            self._unavailable_reason = f"{type(exc).__name__}: {exc}"
            raise TapeUnavailable(f"coherence tape at {self.db_path.name} could not be opened: {exc}") from exc
        for statement in _DDL:
            conn.execute(statement)
        self._migrate(conn)
        self._conn = conn
        self._unavailable_reason = None
        return conn

    def _migrate(self, conn: duckdb.DuckDBPyConnection) -> None:
        """Widen an existing tape rather than rebuilding it.

        Columns added after the first tapes existed are added here, never to
        the DDL above: a `CREATE TABLE IF NOT EXISTS` does nothing to a table
        that already exists, so a new column in the DDL would appear on fresh
        databases and be silently missing on every recorder that has been
        running — which is the shape of bug that only shows up on the machine
        with the most history.

        `mutually_exclusive` was added when replay turned out to need it: the
        flag is the exchange's own assertion that a family's prices sum to a
        dollar, and without it a replayed tape can test nothing at all.
        """
        # `information_schema` rather than `PRAGMA table_info`, which returns
        # (cid, name, type, ...) — reading column 0 gets the ordinal and the
        # membership test then always fails, so the ALTER runs every open and
        # raises on the second one.
        columns = {
            row[0]
            for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'book_snapshots'"
            ).fetchall()
        }
        if "mutually_exclusive" not in columns:
            conn.execute("ALTER TABLE book_snapshots ADD COLUMN mutually_exclusive BOOLEAN")

    def record_books(self, rows: Sequence[BookRow]) -> int:
        """Append a poll's worth of books. Returns how many landed.

        Synchronous and blocking on purpose: callers hand this to
        ``asyncio.to_thread`` so the event loop is never held by a disk write.
        """
        if not rows:
            return 0
        with self._lock:
            conn = self._connect()
            conn.executemany(
                """
                INSERT INTO book_snapshots
                    (ts_ns, ticker, event_ticker, series_ticker, exchange_index, mutually_exclusive,
                     yes_ladder, no_ladder, best_yes_bid, best_no_bid, depth, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        row.ts_ns,
                        row.ticker,
                        row.event_ticker,
                        row.series_ticker,
                        row.exchange_index,
                        row.mutually_exclusive,
                        _ladder_json(row.book.yes_bids),
                        _ladder_json(row.book.no_bids),
                        row.book.best_yes_bid,
                        row.book.best_no_bid,
                        row.book.depth,
                        row.source,
                    )
                    for row in rows
                ],
            )
            return len(rows)

    def record_index(
        self,
        ts_ns: int,
        series_ticker: str,
        event_ticker: str,
        exchange_index: int,
        ci: Decimal | None,
        engine: str,
        detail: str | None = None,
    ) -> None:
        """One Coherence Index reading.

        ``ci`` is nullable and stays that way: an event whose books could not be
        read has no index, and a zero there would read as perfectly coherent —
        the most misleading value available.
        """
        with self._lock:
            conn = self._connect()
            conn.execute(
                """
                INSERT INTO coherence_index (ts_ns, series_ticker, event_ticker, exchange_index, ci, engine, detail)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (ts_ns, series_ticker, event_ticker, exchange_index, ci, engine, detail),
            )

    def latest_books(self, tickers: Sequence[str] | None = None, limit: int = 200) -> list[dict[str, Any]]:
        """The most recent snapshot per ticker.

        Fully parameterised, including the ticker list and the limit. An
        f-string here would be safe today — every value is ours — but the habit
        is what the linter objects to, and DuckDB's ``list_contains`` takes a
        list parameter, so there is no reason to build SQL by hand.
        """
        wanted = list(tickers) if tickers else []
        with self._lock:
            conn = self._connect()
            rows = conn.execute(
                """
                SELECT ts_ns, ticker, event_ticker, series_ticker, exchange_index, mutually_exclusive,
                       yes_ladder, no_ladder, best_yes_bid, best_no_bid, depth, source
                FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ts_ns DESC) AS recency
                    FROM book_snapshots
                    WHERE len(?) = 0 OR list_contains(?, ticker)
                )
                WHERE recency = 1
                ORDER BY ticker
                LIMIT ?
                """,
                (wanted, wanted, int(limit)),
            ).fetchall()
        columns = (
            "ts_ns", "ticker", "event_ticker", "series_ticker", "exchange_index", "mutually_exclusive",
            "yes_ladder", "no_ladder", "best_yes_bid", "best_no_bid", "depth", "source",
        )
        return [dict(zip(columns, row, strict=True)) for row in rows]

    def index_series(
        self, series_ticker: str | None = None, since_ts_ns: int = 0, limit: int = 5000
    ) -> list[dict[str, Any]]:
        """The Coherence Index over time, oldest first so a chart can plot it."""
        with self._lock:
            conn = self._connect()
            rows = conn.execute(
                """
                SELECT ts_ns, series_ticker, event_ticker, exchange_index, ci, engine, detail
                FROM coherence_index
                WHERE ts_ns >= ? AND (? IS NULL OR series_ticker = ?)
                ORDER BY ts_ns ASC
                LIMIT ?
                """,
                (int(since_ts_ns), series_ticker, series_ticker, int(limit)),
            ).fetchall()
        columns = ("ts_ns", "series_ticker", "event_ticker", "exchange_index", "ci", "engine", "detail")
        return [dict(zip(columns, row, strict=True)) for row in rows]

    def record_episode(self, episode: Any) -> None:
        """One closed violation episode.

        Written on close rather than on open: an episode with no end has no
        lifetime, and a half-written row would enter the survival curve as a
        zero-length violation — biasing the median toward "too fast to trade",
        which is the direction that would wrongly retire a real opportunity.
        """
        row = episode.to_dict()
        with self._lock:
            conn = self._connect()
            conn.execute(
                """
                INSERT INTO violation_episodes
                    (component_id, series_ticker, event_ticker, family, exchange_index,
                     opened_ts_ns, closed_ts_ns, peak_ci, peak_net_edge, samples)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["component_id"], row["series_ticker"], row["event_ticker"], row["family"],
                    row["exchange_index"], row["opened_ts_ns"], row["closed_ts_ns"],
                    None if row["peak_ci"] is None else Decimal(row["peak_ci"]),
                    None if row["peak_net_edge_dollars"] is None else Decimal(row["peak_net_edge_dollars"]),
                    json.dumps(row["samples"]),
                ),
            )

    def episodes(self, series_ticker: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
        """Closed episodes, newest first."""
        with self._lock:
            conn = self._connect()
            rows = conn.execute(
                """
                SELECT component_id, series_ticker, event_ticker, family, exchange_index,
                       opened_ts_ns, closed_ts_ns, peak_ci, peak_net_edge, samples
                FROM violation_episodes
                WHERE ? IS NULL OR series_ticker = ?
                ORDER BY closed_ts_ns DESC
                LIMIT ?
                """,
                (series_ticker, series_ticker, int(limit)),
            ).fetchall()
        columns = (
            "component_id", "series_ticker", "event_ticker", "family", "exchange_index",
            "opened_ts_ns", "closed_ts_ns", "peak_ci", "peak_net_edge", "samples",
        )
        return [dict(zip(columns, row, strict=True)) for row in rows]

    def counts(self) -> dict[str, int]:
        """How much tape there is. The recorder's proof of life."""
        with self._lock:
            conn = self._connect()
            books = conn.execute("SELECT COUNT(*), COUNT(DISTINCT ticker) FROM book_snapshots").fetchone()
            index_rows = conn.execute("SELECT COUNT(*) FROM coherence_index").fetchone()
            episodes = conn.execute("SELECT COUNT(*) FROM violation_episodes").fetchone()
        return {
            "book_snapshots": int(books[0]),
            "tickers_seen": int(books[1]),
            "coherence_index_rows": int(index_rows[0]),
            "violation_episodes": int(episodes[0]),
        }

    def health(self) -> dict[str, Any]:
        """State, never a zero standing in for an unknown."""
        try:
            counts = self.counts()
        except TapeUnavailable as exc:
            return {"state": "unavailable", "reason": str(exc), "path": self.db_path.name}
        return {"state": "ok", "path": self.db_path.name, **counts}

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None


_STORE: CoherenceStore | None = None


def get_store(db_path: Path | None = None) -> CoherenceStore:
    """The process-wide tape. One writer, or the lock story is a fiction."""
    global _STORE
    if _STORE is None or (db_path is not None and db_path != _STORE.db_path):
        from modules.coherence import tunables

        _STORE = CoherenceStore(db_path or tunables.DB_PATH)
    return _STORE


def reset_store() -> None:
    """Drop the tape handle so a test can point at its own file."""
    global _STORE
    if _STORE is not None:
        _STORE.close()
    _STORE = None
