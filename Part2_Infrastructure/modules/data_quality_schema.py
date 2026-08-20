"""The data-quality ledger's tables, its clock helpers and the `Escalation`.

Split out of ``modules/data_quality.py``. Nothing here knows about the ledger
class; it is the SQL and the value types the three ledger files share.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #

_DDL = [
    """
    CREATE TABLE IF NOT EXISTS data_quality_findings (
        id INTEGER PRIMARY KEY,
        instance TEXT NOT NULL,
        seq INTEGER NOT NULL,
        source TEXT NOT NULL,
        observed_at REAL NOT NULL,
        received_at REAL NOT NULL,
        capability TEXT NOT NULL,
        provider TEXT NOT NULL,
        symbol TEXT,
        key TEXT NOT NULL,
        passed INTEGER NOT NULL,
        fatal INTEGER NOT NULL,
        warn INTEGER NOT NULL,
        drift INTEGER NOT NULL,
        not_evaluated INTEGER NOT NULL,
        checks_json TEXT NOT NULL,
        UNIQUE(instance, seq)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_dq_findings_observed ON data_quality_findings(observed_at)",
    "CREATE INDEX IF NOT EXISTS ix_dq_findings_provider ON data_quality_findings(provider, observed_at)",
    """
    CREATE TABLE IF NOT EXISTS data_quality_escalations (
        id INTEGER PRIMARY KEY,
        rule TEXT NOT NULL,
        provider TEXT NOT NULL,
        opened_at REAL NOT NULL,
        window_minutes INTEGER NOT NULL,
        count INTEGER NOT NULL,
        evaluated INTEGER,
        detail TEXT NOT NULL,
        notified_at REAL,
        channel TEXT,
        resolved_at REAL
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_dq_esc_rule ON data_quality_escalations(rule, provider, opened_at)",
]

#: Columns added after the table shipped.
#:
#: This store has no migration table — `SqliteStore.migrate` runs
#: `CREATE TABLE IF NOT EXISTS` on every construction and there is no ALTER
#: path — so a column added later has to be added conditionally, the way
#: `audit.py` already does for `subscribers`. An unconditional ALTER fails on
#: the second start; a new CREATE would silently not run on an existing file.
_ESCALATION_COLUMNS: tuple[tuple[str, str], ...] = (
    # NULL means unacknowledged, and stays NULL for every row that predates
    # this. An escalation nobody has seen and an escalation from before the
    # column existed are the same fact: nobody has taken it.
    ("acknowledged_at", "REAL"),
    ("acknowledged_by", "TEXT"),
)

_PRUNE_EVERY_MS = 10 * 60_000

_AGGREGATE = (
    "COUNT(*) AS evaluated, SUM(passed) AS passed, SUM(fatal) AS fatal, "
    "SUM(warn) AS warn, SUM(drift) AS drift, SUM(not_evaluated) AS not_evaluated"
)


def _dt(ms: float | None) -> datetime | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)


def _now_ms() -> float:
    return time.time() * 1000.0


class Escalation(BaseModel):
    """A newly opened escalation, as returned to the caller who ingested it."""

    id: int
    rule: Literal["fatal_burst", "fail_rate"]
    provider: str
    opened_at: float
    window_minutes: int
    count: int
    evaluated: int | None
    detail: str
