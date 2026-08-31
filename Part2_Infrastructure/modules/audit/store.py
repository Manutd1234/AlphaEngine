"""The connection and the primitives every other concern is built on.

One DuckDB handle (SQLite when DuckDB will not load) behind one lock. The
migration of columns added after the first databases existed lives here too,
because it is a property of *this* connection rather than of any one table.

Everything below in the package is a subclass of :class:`AuditStore` that adds
one concern's methods; ``AuditLog`` in ``__init__.py`` is where they meet.

Two failures that are not one failure
-------------------------------------
``_connect`` used to catch every exception out of ``duckdb.connect`` and fall
back to SQLite at a different path. That is right for one of the two things
that exception can mean and catastrophic for the other.

* **DuckDB is not available here** — not installed, or no wheel for this
  platform. The SQLite fallback is exactly what it is for, and nothing is lost
  but analytical SQL.
* **Another live process already holds this database.** DuckDB reports that as
  an IO error too, so it went down the same path: the second gateway did not
  fail, it opened a *private* ledger at ``<db>.sqlite`` and began writing a
  divergent history, while ``/health`` reported ``backend: sqlite`` as though
  somebody had chosen it. An append-only ledger silently forking in two is the
  worst thing this subsystem can do, and the bare ``except Exception`` was the
  reason it was silent.

The second is now :class:`AuditLedgerConflict` and it is raised. It is defence
in depth behind ``modules/single_writer.py``, which takes a ``flock(2)`` claim
in ``RiskGateway.start()`` — the claim covers the gateway, and this covers
every other way an ``AuditLog`` gets opened, of which there are several (the
Telegram bot, the job runner, ``tools/``, and the tests).

``backend`` keeps meaning what it says: ``"duckdb"`` or ``"sqlite"``, and it is
still only ``"sqlite"`` when SQLite is genuinely what is underneath.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from config import settings
from modules.audit.schema import _DDL
from modules.data_ops_store import open_sqlite_db

log = logging.getLogger("alphaengine.audit")


class AuditLedgerConflict(RuntimeError):
    """Another live process already holds this audit database.

    Raised, never fallen back from. A conflict is positive evidence of a second
    writer on one ledger, and the honest response to evidence is to stop — not
    to open a second ledger beside it and let the two disagree in private.
    """


#: DuckDB has no typed exception for a held file lock: it is an ``IOException``
#: like any other IO error, so the message is the only signal. Matched on the
#: two phrases it is built from rather than on the whole string, which also
#: carries the database path, the holder's executable and its PID.
#:
#: Both markers are lock-specific. Nothing else DuckDB reports says "could not
#: set lock on file", so a non-lock IO error — a corrupt file, a full disk,
#: an unreadable directory — still takes the fallback it always took.
_LOCK_CONFLICT_MARKERS: tuple[str, ...] = (
    "conflicting lock is held",
    "could not set lock on file",
)


def _is_lock_conflict(exc: BaseException) -> bool:
    """Is this DuckDB refusing because someone else has the file open?"""
    text = str(exc).lower()
    return any(marker in text for marker in _LOCK_CONFLICT_MARKERS)


class AuditStore:
    """Thread-safe DuckDB handle with a SQLite fallback, and nothing above it."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = Path(db_path or settings.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._closed = False
        self._write_failures = 0
        self._read_failures = 0
        self._last_write_error: str | None = None
        self._last_read_error: str | None = None
        self.backend = "duckdb"
        self._conn = self._connect()
        try:
            self._migrate()
        except BaseException:
            self._closed = True
            self._conn.close()
            raise

    # -- connection ------------------------------------------------------- #
    def _connect(self):
        try:
            import duckdb
        except ImportError as exc:
            # DuckDB is genuinely not here. This is the fallback's whole reason
            # to exist, and it costs analytical SQL and nothing else.
            return self._sqlite_fallback(f"not importable ({exc})")

        try:
            return duckdb.connect(str(self.db_path))
        except Exception as exc:
            if _is_lock_conflict(exc):
                raise AuditLedgerConflict(
                    f"another live process already holds the audit ledger at "
                    f"{self.db_path}. This process will NOT open a second ledger "
                    f"beside it: the table set is append-only and two writers "
                    f"produce two histories that silently disagree. Stop the "
                    f"other process, or give this one its own DATA_DIR. "
                    f"DuckDB said: {exc}"
                ) from exc
            # Anything else — a corrupt file, an unreadable directory, a wheel
            # that will not load on this platform — keeps the behaviour it had.
            return self._sqlite_fallback(str(exc))

    def _sqlite_fallback(self, reason: str):
        """Open the SQLite twin, and say in the log why DuckDB was not used."""
        log.warning("DuckDB unavailable (%s); falling back to SQLite", reason)
        self.backend = "sqlite"
        return open_sqlite_db(self.db_path.with_suffix(".sqlite"))

    def _migrate(self) -> None:
        with self._lock:
            for ddl in _DDL:
                stmt = ddl
                if self.backend == "sqlite":
                    stmt = stmt.replace("TIMESTAMP", "TEXT").replace("DOUBLE", "REAL")
                self._conn.execute(stmt)

            # Subscriber delivery is authorised by Telegram *user* ID, never
            # by chat ID.  Older databases did not persist that ownership
            # metadata.  Add the column without inferring an owner from the
            # legacy ``username`` field: existing rows remain NULL and are
            # intentionally fail-closed until an authorised user explicitly
            # re-subscribes or updates their watch.
            subscriber_cursor = self._conn.execute("SELECT * FROM subscribers LIMIT 0")
            subscriber_columns = {
                str(column[0]).lower() for column in (subscriber_cursor.description or [])
            }
            if "user_id" not in subscriber_columns:
                self._conn.execute("ALTER TABLE subscribers ADD COLUMN user_id VARCHAR")

            # Which web desk pass bound this chat, and when. Same rule as the
            # column above: existing rows stay NULL, and a NULL ``web_identity``
            # grants nothing — a chat that predates linking is exactly as
            # unbound as it was before the column existed.
            #
            # ``linked_at`` rides alongside because a guest binding has to
            # expire. The desk pass it mirrors is a browser-session cookie the
            # gateway cannot watch die, so the grant carries its own clock
            # instead of an unbounded one nobody can revoke.
            for column, sql_type in (("web_identity", "VARCHAR"), ("linked_at", "TIMESTAMP")):
                if column not in subscriber_columns:
                    self._conn.execute(
                        f"ALTER TABLE subscribers ADD COLUMN {column} "  # noqa: S608
                        f"{'TEXT' if self.backend == 'sqlite' and sql_type == 'TIMESTAMP' else sql_type}"
                    )

            # Which desk role a chat speaks for, so a risk breach can reach the
            # people whose job it is. NULL is not "no role" in the sense of
            # "receives nothing" — it is the pre-existing state, and the
            # delivery rule treats it as "receives everything", so adding this
            # column cannot silently mute a chat that was subscribed before it
            # existed. Opting IN to a narrower role is a deliberate act (/role);
            # being opted out by a migration would not be.
            if "role" not in subscriber_columns:
                self._conn.execute("ALTER TABLE subscribers ADD COLUMN role VARCHAR")

            # Reproducibility metadata added after the first databases existed.
            # Older rows keep NULL rather than being back-filled with a guess: a
            # fabricated data hash would claim two runs saw the same bars.
            run_cursor = self._conn.execute("SELECT * FROM backtest_runs LIMIT 0")
            run_columns = {str(column[0]).lower() for column in (run_cursor.description or [])}
            for column, sql_type in (("data_hash", "VARCHAR"), ("label", "VARCHAR"), ("pbo", "DOUBLE")):
                if column not in run_columns:
                    self._conn.execute(
                        f"ALTER TABLE backtest_runs ADD COLUMN {column} "  # noqa: S608
                        f"{'REAL' if self.backend == 'sqlite' and sql_type == 'DOUBLE' else sql_type}"
                    )

            # Order lifecycle columns added when resting orders arrived. Legacy
            # rows keep NULL rather than being back-filled: before this schema
            # every accepted order filled in the same call, so a NULL status is
            # correctly read as "filled" by the blotter and — importantly — is
            # still treated as ambiguous by the rehydration guard below, which
            # fails closed on an accepted row with no fill evidence.
            order_cursor = self._conn.execute("SELECT * FROM orders LIMIT 0")
            order_columns = {str(column[0]).lower() for column in (order_cursor.description or [])}
            for column, sql_type in (
                ("status", "VARCHAR"),
                ("time_in_force", "VARCHAR"),
                ("decided_at", "TIMESTAMP"),
            ):
                if column not in order_columns:
                    self._conn.execute(
                        f"ALTER TABLE orders ADD COLUMN {column} "  # noqa: S608
                        f"{'TEXT' if self.backend == 'sqlite' and sql_type == 'TIMESTAMP' else sql_type}"
                    )

            if self.backend == "sqlite":
                self._conn.commit()

    # -- primitives ------------------------------------------------------- #
    def _exec(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        # A worker thread can outlive shutdown; writing to a closed handle is an
        # expected race, not an incident. Drop it quietly rather than log-spam.
        if self._closed:
            log.debug("audit write after close ignored")
            return
        if self.backend == "sqlite":
            sql = sql.replace("?", "?")
            params = tuple(p.isoformat() if isinstance(p, datetime) else p for p in params)
        try:
            with self._lock:
                self._conn.execute(sql, params)
                if self.backend == "sqlite":
                    self._conn.commit()
                self._last_write_error = None
        except Exception as exc:  # never let audit failures break the trade path
            with self._lock:
                self._write_failures += 1
                self._last_write_error = type(exc).__name__
            log.error("audit write failed: %s", exc)

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        if self._closed:
            return []
        try:
            with self._lock:
                cur = self._conn.execute(sql, params)
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall()
                self._last_read_error = None
            return [dict(zip(cols, row, strict=True)) for row in rows]
        except Exception as exc:
            with self._lock:
                self._read_failures += 1
                self._last_read_error = type(exc).__name__
            log.error("audit query failed: %s", exc)
            return []

    def health(self) -> dict[str, Any]:
        """Cheap process-local storage state without exposing its filesystem path.

        The operations snapshot is polled frequently, so it must not contend
        with order-path writes by issuing a probe query on every request. An
        open connection reports available; write failures remain authoritative
        in the audit error logs and metrics.
        """
        return {"backend": self.backend, "available": not self._closed}

    def runtime_health(self) -> dict[str, Any]:
        """Extended process telemetry without changing the stable snapshot shape."""
        return {
            **self.health(),
            "writable": not self._closed and self._last_write_error is None,
            "write_failures": self._write_failures,
            "read_failures": self._read_failures,
            "last_write_error": self._last_write_error,
            "last_read_error": self._last_read_error,
        }

    def reopen(self) -> None:
        """Reopen a process-owned ledger for a repeated ASGI lifespan."""
        with self._lock:
            if not self._closed:
                return
            self.backend = "duckdb"
            self._conn = self._connect()
            self._closed = False
        try:
            self._migrate()
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        with self._lock:
            self._closed = True
            try:
                self._conn.close()
            except Exception:  # noqa: S110 - shutdown must not raise
                # Reached only while the process is already going down, where a
                # raised error would mask whatever caused the shutdown. The
                # ``_closed`` flag above has already stopped new writes.
                pass
