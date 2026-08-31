"""Shared, exception-safe SQLite connection configuration."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

# HTTP deadlines belong at the runtime boundary. Storage always gets the exact
# thirty-second budget needed to wait out a lock held by another connection.
BUSY_TIMEOUT_S = 30.0

# SQLite's busy handler does not cover two first-open WAL PRAGMAs racing inside
# one process, so serialize the rare connection setup boundary explicitly.
_OPEN_LOCK = threading.Lock()


def open_sqlite_db(
    path: Path | str, *, busy_timeout_s: float = BUSY_TIMEOUT_S,
) -> sqlite3.Connection:
    """Open a configured connection and close it if any PRAGMA setup fails."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    timeout_s = max(0.0, float(busy_timeout_s))
    with _OPEN_LOCK:
        conn = sqlite3.connect(
            str(path), timeout=timeout_s, check_same_thread=False, isolation_level=None,
        )
        try:
            conn.row_factory = sqlite3.Row
            conn.execute(f"PRAGMA busy_timeout={round(timeout_s * 1_000)}")
            if str(path) != ":memory:":
                conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
        except BaseException:
            conn.close()
            raise
    return conn
