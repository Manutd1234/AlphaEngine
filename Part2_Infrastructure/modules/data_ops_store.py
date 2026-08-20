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

import re
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
    backend = "sqlite"

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

    # -- the row-oriented interface both backends share ------------------- #
    #
    # PostgREST cannot be handed SQL, so anything that must work on either
    # backend goes through these four. The filter grammar is PostgREST's,
    # because it is the one that can express an operator: a bare value means
    # equality, and "is.null" / "gt.5" / "in.(a,b)" carry their own. SQLite
    # translates; PostgREST passes them through untouched.
    #
    # The SQL methods above stay for SQLite-only paths — the aggregate rollups
    # in data_quality have no PostgREST equivalent without a view, and
    # pretending otherwise here would put a lie in the abstraction.

    #: Identifiers are interpolated into SQL because they cannot be bound as
    #: parameters. Every one is checked against this first, so the `noqa: S608`
    #: below is earned rather than asserted: a table or column name that is not
    #: a bare identifier raises before it reaches a query. Values are always
    #: bound.
    _IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

    _OPS = {
        "eq": "= ?", "neq": "!= ?", "gt": "> ?", "gte": ">= ?",
        "lt": "< ?", "lte": "<= ?",
    }

    @classmethod
    def _ident(cls, *names: str) -> None:
        for name in names:
            for part in name.replace(",", " ").split():
                if part != "*" and not cls._IDENT.match(part):
                    raise ValueError(f"not a bare SQL identifier: {part!r}")

    @classmethod
    def _where(cls, filters: dict[str, Any] | None) -> tuple[str, list[Any]]:
        if not filters:
            return "", []
        clauses, params = [], []
        for column, raw in filters.items():
            cls._ident(column)
            if isinstance(raw, str) and "." in raw:
                op, _, value = raw.partition(".")
                if op == "is" and value == "null":
                    clauses.append(f"{column} IS NULL")
                    continue
                if op == "is" and value == "notnull":
                    clauses.append(f"{column} IS NOT NULL")
                    continue
                if op in cls._OPS:
                    clauses.append(f"{column} {cls._OPS[op]}")
                    params.append(value)
                    continue
            clauses.append(f"{column} = ?")
            params.append(raw)
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def fetch(
        self, table: str, *, columns: str = "*",
        filters: dict[str, Any] | None = None,
        order: str | None = None, limit: int | None = None,
    ) -> list[dict[str, Any]]:
        self._ident(table, columns)
        where, params = self._where(filters)
        sql = f"SELECT {columns} FROM {table}{where}"  # noqa: S608 - identifiers checked above
        if order:
            column, _, direction = order.partition(".")
            self._ident(column)
            sql += f" ORDER BY {column} {'DESC' if direction == 'desc' else 'ASC'}"
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        return self.query(sql, tuple(params))

    def fetch_one(self, table: str, **kwargs: Any) -> dict[str, Any] | None:
        rows = self.fetch(table, limit=1, **kwargs)
        return rows[0] if rows else None

    def add(
        self, table: str, rows: dict[str, Any] | list[dict[str, Any]], *,
        returning: bool = False, on_conflict: str | None = None,
        resolution: str | None = None,
    ) -> list[dict[str, Any]]:
        payload = [rows] if isinstance(rows, dict) else list(rows)
        if not payload:
            return []
        columns = list(payload[0])
        self._ident(table, *columns)
        placeholders = ",".join("?" * len(columns))
        suffix = ""
        if resolution == "ignore-duplicates":
            suffix = " ON CONFLICT DO NOTHING"
        elif resolution == "merge-duplicates":
            target = on_conflict or columns[0]
            assignments = ", ".join(f"{c}=excluded.{c}" for c in columns if c != target)
            suffix = f" ON CONFLICT({target}) DO UPDATE SET {assignments}"
        sql = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders}){suffix}"  # noqa: S608
        out = []
        for row in payload:
            cursor = self.execute(sql, tuple(row[c] for c in columns))
            if returning and cursor.lastrowid is not None:
                found = self.fetch_one(table, filters={"rowid": cursor.lastrowid})
                if found:
                    out.append(found)
        return out

    def patch(self, table: str, *, filters: dict[str, Any], patch: dict[str, Any]) -> list[dict[str, Any]]:
        self._ident(table, *patch)
        where, params = self._where(filters)
        assignments = ", ".join(f"{c}=?" for c in patch)
        cursor = self.execute(
            f"UPDATE {table} SET {assignments}{where}",  # noqa: S608
            tuple(list(patch.values()) + params),
        )
        # The rows themselves, so a compare-and-swap caller reads the same
        # "did my version hold?" answer it reads from PostgREST.
        return self.fetch(table, filters=filters) if cursor.rowcount else []

    def remove(self, table: str, *, filters: dict[str, Any]) -> int:
        self._ident(table)
        where, params = self._where(filters)
        return self.execute(f"DELETE FROM {table}{where}", tuple(params)).rowcount  # noqa: S608

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


def open_data_ops_store(settings: Any = None) -> Any:
    """The store the data-operations tables live in, per configuration.

    Returns a `SqliteStore` or a `PostgrestStore`. The import of the latter is
    deferred into this function on purpose: `data_ops_postgrest` imports httpx,
    and a deployment running the default backend should not pay for a transport
    it never uses — the same reason the Postgres branch validates its
    credentials here rather than at import time.

    What Postgres does NOT buy: a second gateway process. The position book,
    the resting-order book, the token bucket and the kill switch are still
    process-local mutable state, and `test_container_contract.py` still fails
    the build on `--workers`. What it removes is the *storage* half of that
    boundary — these four tables stop being local to one container's filesystem.

    An unknown value is refused rather than defaulted. Falling back to SQLite
    on a typo would give a deployment that believes it is on Postgres, is not,
    and says "sqlite" in a health field nobody reads twice.
    """
    from config import settings as configured

    settings = settings or configured
    backend = getattr(settings, "data_ops_backend", "sqlite")
    if backend == "sqlite":
        return SqliteStore(settings.data_ops_db_path)
    if backend == "postgres":
        from modules.data_ops_postgrest import PostgrestStore

        url = getattr(settings, "supabase_url", "")
        key = getattr(settings, "supabase_service_role_key", "")
        if not url or not key:
            raise ValueError(
                "DATA_OPS_BACKEND=postgres needs SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY; refusing to fall back to sqlite, "
                "which would run a deployment that believes it is on Postgres"
            )
        return PostgrestStore(url, key)
    raise ValueError(f"unknown DATA_OPS_BACKEND: {backend!r} (expected 'sqlite' or 'postgres')")
