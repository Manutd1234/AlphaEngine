"""Where each schedule last fired, on whichever backend is configured.

Lifted out of `data_jobs.py` when it stopped subclassing `SqliteStore`. Two
reasons, and the second is the real one: `data_jobs.py` is over the 400-line
ceiling and the ratchet only turns one way, but more than that, a store that
now has to work over two backends is its own concern rather than a footnote in
the module that runs the queue.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from modules.data_ops_store import SqliteStore


class ScheduleRunStore:
    """Restart safety for the scheduler: when each schedule last fired.

    Composed with a backend rather than subclassing one. It was
    `ScheduleRunStore(SqliteStore)`, which made SQLite not a choice but the
    definition of the class — `DATA_OPS_BACKEND` could select a PostgrestStore
    all it liked and this would still open a file. Both stores now answer the
    same five row-oriented methods, so the backend is genuinely a setting.

    A `str` still constructs a SQLite store, so the fifteen existing call sites
    and their tests did not have to move in the same commit that changed the
    shape.
    """

    _DDL = [
        """
        CREATE TABLE IF NOT EXISTS data_schedule_runs (
            schedule_id TEXT PRIMARY KEY,
            last_run_at REAL,
            last_job_id TEXT,
            last_outcome TEXT
        )
        """,
    ]

    def __init__(self, store: Any) -> None:
        self._store = SqliteStore(store) if isinstance(store, (str, Path)) else store
        self._store.migrate(self._DDL)

    @property
    def backend(self) -> str:
        return self._store.backend

    def close(self) -> None:
        self._store.close()

    def last_run(self, schedule_id: str) -> dict[str, Any] | None:
        return self._store.fetch_one("data_schedule_runs", filters={"schedule_id": schedule_id})

    def record_run(self, schedule_id: str, at_ms: float, job_id: str, outcome: str) -> None:
        # ON CONFLICT DO UPDATE on SQLite; Prefer: resolution=merge-duplicates
        # on PostgREST. One call, because the stores translate their own idiom.
        self._store.add(
            "data_schedule_runs",
            {
                "schedule_id": schedule_id, "last_run_at": at_ms,
                "last_job_id": job_id, "last_outcome": outcome,
            },
            on_conflict="schedule_id", resolution="merge-duplicates",
        )
