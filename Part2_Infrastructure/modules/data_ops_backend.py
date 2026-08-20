"""Choosing the data-operations backend, and the interface both must answer.

This module exists because the previous arrangement did not work. The factory
lived in `data_ops_store.py`, the config field existed, the tests passed — and
`grep -rn open_data_ops_store modules/ main.py` returned nothing but the
definition. Every production site constructed `SqliteStore` directly through
the `str` path argument, so `DATA_OPS_BACKEND=postgres` selected a backend that
nothing ever asked for. A commit message of mine claimed the setting had
"stopped being inert" while it was still inert everywhere it mattered.

So the factory moved here, next to a Protocol that says what a backend IS, and
next to a cached accessor that is the only thing production calls.

Why a Protocol and not a base class
-----------------------------------
`SqliteStore` and `PostgrestStore` share no implementation — one wraps a
sqlite3 connection, the other an httpx client — and inheriting from a common
ancestor would either be an empty ABC or a place for one backend's assumptions
to leak into the other. What they share is a shape, which is what a Protocol
describes. `test_data_ops_backend.py` checks both against it structurally, so a
method added to one and forgotten on the other fails in CI rather than on
whichever deployment opted in.

Why the store is cached
-----------------------
Four call sites want it, and under Postgres each construction is an
`httpx.Client` with its own connection pool. One of them —
`data_scheduler._record_outcome` — built a fresh store on *every job
completion* and dropped it, which on SQLite was a wasted file open and on
Postgres would be an unclosed pool per job.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

from modules.data_ops_store import SqliteStore

log = logging.getLogger("alphaengine.data_ops")


@runtime_checkable
class DataOpsStore(Protocol):
    """What the three data-operations stores require of a backend.

    The row-oriented half only. The raw-SQL helpers on `SqliteStore` are
    deliberately absent: they are the SQLite-only escape hatch for the quality
    ledger's aggregates, and putting them here would declare an interface
    PostgREST cannot honour.
    """

    backend: str

    def migrate(self, ddl: list[str]) -> None: ...

    def fetch(
        self,
        table: str,
        *,
        columns: str = ...,
        filters: dict[str, Any] | None = ...,
        order: str | None = ...,
        limit: int | None = ...,
    ) -> list[dict[str, Any]]: ...

    def fetch_one(self, table: str, **kwargs: Any) -> dict[str, Any] | None: ...

    def add(
        self,
        table: str,
        rows: dict[str, Any] | list[dict[str, Any]],
        *,
        returning: bool = ...,
        on_conflict: str | None = ...,
        resolution: str | None = ...,
    ) -> list[dict[str, Any]]: ...

    def patch(
        self, table: str, *, filters: dict[str, Any], patch: dict[str, Any],
    ) -> list[dict[str, Any]]: ...

    def remove(self, table: str, *, filters: dict[str, Any]) -> int: ...

    def count(self, table: str, *, filters: dict[str, Any] | None = ...) -> int: ...

    def close(self) -> None: ...


def open_data_ops_store(settings: Any = None) -> DataOpsStore:
    """Build the store this deployment is configured for.

    The import of the httpx-backed store is deferred into the postgres branch
    on purpose: a deployment on the default backend should not pay for a
    transport it never uses.

    Neither failure below falls back. A deployment that believes its durable
    state is in Postgres while it sits on a container filesystem is worse than
    one that refuses to start, because the `backend` field it reports would say
    "sqlite" and nobody reads that field twice.
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


_shared: DataOpsStore | None = None


def get_data_ops_store() -> DataOpsStore:
    """The process's one data-operations store.

    Every production path goes through here. `tests/test_data_ops_backend.py`
    asserts that no module constructs `SqliteStore` directly outside this file,
    which is the check that would have caught the factory having no callers.
    """
    global _shared
    if _shared is None:
        _shared = open_data_ops_store()
        log.info("data-ops backend: %s", _shared.backend)
    return _shared


def clear_data_ops_cache() -> None:
    """Forget the cached store WITHOUT closing it.

    The distinction matters and cost two wrong attempts to find. A test that
    redirects `data_ops_db_path` needs the next lookup to rebuild — that is a
    cache clear. Closing as well takes the handle out from under anything that
    already holds one, which in the suite meant module-scoped fixtures failing
    with "Cannot operate on a closed database" in a file that passed alone.

    Function-scope imports for the same reason as `reset_data_ops_store`.
    """
    global _shared

    from modules import data_quality, work_items

    data_quality._ledger = None
    work_items._store = None
    _shared = None


def reset_data_ops_store() -> None:
    """Drop the cached store AND everything holding it.

    Three singletons keep a reference to this backend — the work-item store,
    the quality ledger and the scheduler's run store. Closing the shared store
    without clearing them leaves each one holding a closed handle, and the next
    call fails with `sqlite3.ProgrammingError: Cannot operate on a closed
    database` somewhere unrelated. That is what caching a resource three other
    modules depend on costs, and the cost is paid here rather than by whoever
    calls reset.

    The imports are function-scope and stay that way: `work_items` and
    `data_quality` both import `get_data_ops_store` from this module, so a
    module-scope import here is a cycle. Same rule as docs/REFACTOR_RULES.md.
    """
    global _shared

    from modules import data_quality, work_items

    data_quality._ledger = None
    work_items._store = None

    if _shared is not None:
        try:
            _shared.close()
        except Exception:  # a store that cannot close must not block a reset
            log.debug("data-ops store close failed during reset", exc_info=True)
    _shared = None
