"""
Immutable-by-convention audit log (DuckDB, SQLite fallback).
============================================================

Every risk decision, kill-switch event, TCA snapshot and backtest run is written
here. The table set is intentionally append-only: nothing in the application
issues UPDATE or DELETE against ``orders``/``risk_events``. Accepted fill rows
contain enough evidence to rebuild the current UTC session's paper position
book, and a ``session_rollover`` row carries the two figures that replay alone
cannot reach — what the sessions before this one banked, and the equity this one
opened on. Operational state such as an engaged kill switch is event history,
not a durable state snapshot, and is deliberately not inferred during that
replay.

``book_reset`` and ``session_rollover`` are both durable replay boundaries, read
back the same way: find the newest one inside the session window, refuse to
guess when two of them share a timestamp, and let the later one win.

DuckDB is used because the same file is directly queryable with analytical SQL
(``SELECT quantile(latency_ms, 0.99) FROM orders``) without an ETL step. A
single connection guarded by a lock is used; all writes are dispatched off the
event loop via ``asyncio.to_thread`` by the callers that care about latency.

The module became a package, split along the section banners the single file
already carried: the table set, the connection and its primitives, the durable
replay boundaries, the append-only writers, the subscriber ledger, the bar
cache and the UI's read models. ``AuditLog`` is assembled from them here, so
``from modules.audit import AuditLog`` and ``get_audit()`` mean exactly what
they always did.

``_utcnow`` is re-exported deliberately and is load-bearing: it is the name
``tests/test_rehydration.py`` patches to arrange a timestamp tie, and every
writer reads the clock back through this module rather than binding its own
copy. See ``clock.py`` for why.
"""

from __future__ import annotations

import logging

from modules.audit.boundaries import ReplayBoundaries as ReplayBoundaries  # noqa: F401
from modules.audit.clock import _KEEP as _KEEP  # noqa: F401
from modules.audit.clock import _audit_timestamp as _audit_timestamp  # noqa: F401
from modules.audit.clock import _utcnow as _utcnow  # noqa: F401 - the rehydration patch point
from modules.audit.ohlcv import OhlcvCache as OhlcvCache  # noqa: F401
from modules.audit.read_models import ReadModels as ReadModels  # noqa: F401
from modules.audit.schema import _DDL as _DDL  # noqa: F401
from modules.audit.store import AuditLedgerConflict as AuditLedgerConflict  # noqa: F401
from modules.audit.store import AuditStore as AuditStore  # noqa: F401
from modules.audit.subscribers import Subscribers as Subscribers  # noqa: F401
from modules.audit.writers import Writers as Writers  # noqa: F401

log = logging.getLogger("alphaengine.audit")


class AuditLog(ReplayBoundaries, Writers, Subscribers, OhlcvCache, ReadModels):
    """Thin, thread-safe wrapper over DuckDB with a SQLite fallback.

    Each base is one concern's methods over the one connection ``AuditStore``
    opens; none of them adds state, so the MRO runs ``AuditStore.__init__``
    once and this class is exactly the object it was as a single file.
    """


_audit: AuditLog | None = None


def get_audit() -> AuditLog:
    global _audit
    if _audit is None:
        _audit = AuditLog()
    return _audit


__all__ = [
    "AuditLedgerConflict",
    "AuditLog",
    "AuditStore",
    "OhlcvCache",
    "ReadModels",
    "ReplayBoundaries",
    "Subscribers",
    "Writers",
    "get_audit",
    "log",
]
