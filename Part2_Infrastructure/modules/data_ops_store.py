"""One SQLite file for the data-operations state the gateway must not forget.

The audit log is DuckDB, append-only by convention, and its helpers are
deliberately fire-and-forget: ``_exec`` swallows a failed write and ``query``
returns an empty list, because a lost TCA snapshot must never take the order
path down with it. That is the right contract for evidence and the wrong one
for a work item a person just edited or a quality finding another instance is
about to read — those need a write that raises when it fails and an UPDATE
that reports whether it hit a row.

So the durable data-plane state (quality findings, escalations, work items,
schedule runs) lives in its own stdlib ``sqlite3`` file on the same mounted
data volume as the audit database. Same durability across restarts and
deploys; strict semantics; no new dependency and no second process.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any


def open_data_ops_db(path: Path | str) -> sqlite3.Connection:
    """Open (creating) the store with the pragmas a shared-file ledger wants."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


class SqliteStore:
    """A small strict wrapper: one connection, one lock, errors propagate."""

    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        self._conn = open_data_ops_db(path)
        self._lock = threading.Lock()

    def migrate(self, ddl: list[str]) -> None:
        with self._lock:
            for statement in ddl:
                self._conn.execute(statement)

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, params)

    def executemany(self, sql: str, rows: list[tuple[Any, ...]]) -> None:
        if not rows:
            return
        with self._lock:
            self._conn.executemany(sql, rows)

    def query(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            cursor = self._conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def one(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def transaction(self) -> "_Transaction":
        return _Transaction(self)

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class _Transaction:
    """``with store.transaction():`` — BEGIN IMMEDIATE, commit on exit, rollback on error.

    The lock is held for the whole block so a read-modify-write (a versioned
    PATCH, an id allocation) is atomic across the process's threads as well as
    against other connections.
    """

    def __init__(self, store: SqliteStore) -> None:
        self._store = store

    def __enter__(self) -> sqlite3.Connection:
        self._store._lock.acquire()
        self._store._conn.execute("BEGIN IMMEDIATE")
        return self._store._conn

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type is None:
                self._store._conn.execute("COMMIT")
            else:
                self._store._conn.execute("ROLLBACK")
        finally:
            self._store._lock.release()
