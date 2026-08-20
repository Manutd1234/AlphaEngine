"""The data-operations store, over PostgREST instead of a SQLite file.

Same four tables, same semantics, a different place to keep them. What this
buys is the half of Boundary 1 that is actually removable: the findings,
escalations, schedule runs and work items stop being local to one container's
filesystem. What it does NOT buy is a second gateway process — the position
book, the resting-order book, the token bucket and the kill switch are still
process-local mutable state, and `test_container_contract.py` still fails the
build on `--workers`. That boundary is a design decision with a test behind it.

**Why PostgREST and not a driver.** `supabase_mirror.py` already argues this
for the order mirror and the argument is unchanged here: `psycopg`, `asyncpg`
and `supabase-py` are all rejected by name, the last of which would drag
gotrue/postgrest/realtime/storage3 into the import graph of a deliberately
network-free CI. httpx is already a dependency.

**Why this is synchronous.** `SqliteStore` is sync, and the three stores that
use it are called from sync code inside async routes. Making this async would
mean an await at every call site in three modules and their tests, for a
backend that is not the default. So it mirrors the sync interface — with the
cost stated plainly rather than hidden: a Postgres-backed call blocks the event
loop for the duration of one HTTP round trip, where SQLite blocked it for a
local file read. That is acceptable while SQLite is the default and
`DATA_OPS_BACKEND=postgres` is opt-in; it is the first thing to revisit if it
ever becomes the default.

**The SQLite idioms, and their exact PostgREST equivalents.**

* ``cursor.lastrowid``          → ``Prefer: return=representation``
* ``INSERT … ON CONFLICT DO NOTHING``   → ``Prefer: resolution=ignore-duplicates``
* ``INSERT … ON CONFLICT DO UPDATE``    → ``Prefer: resolution=merge-duplicates``
* ``BEGIN IMMEDIATE`` + ``WHERE version=?`` → ``PATCH ?id=eq.X&version=eq.N``

The last is the interesting one. SQLite needs the transaction because it reads
the version and writes it back; PostgREST puts the version in the WHERE clause
so the update either matches a row or does not, and returns which. That is a
compare-and-swap rather than a lock, and it is correct across processes where
the lock was only ever correct within one.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger("alphaengine.data_ops.postgrest")

#: PostgREST answers a filter that matched nothing with 200 and an empty list,
#: and a malformed request with 4xx. Only the second is an error here.
_TIMEOUT_S = 15.0


class PostgrestError(RuntimeError):
    """A data-ops write or read that did not happen.

    Raised rather than swallowed, deliberately. `AuditLog._exec` swallows
    because a lost TCA snapshot must not take the order path down; this store
    holds a work item somebody just edited and a finding another instance is
    about to read, and a silent failure there is a lie about durable state.
    """


class PostgrestStore:
    """A row-oriented store with the same strictness as `SqliteStore`."""

    backend = "postgres"

    def __init__(self, url: str, key: str, *, desk_id: str = "default") -> None:
        if not url or not key:
            raise ValueError("PostgrestStore needs a Supabase URL and a service-role key")
        self.desk_id = desk_id
        self._client = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            timeout=_TIMEOUT_S,
        )

    # -- plumbing ---------------------------------------------------------- #

    def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            # The URL carries the project ref and the headers carry the key;
            # neither goes into the message. Same rule as TelegramBot._post.
            raise PostgrestError(f"{method} {path}: transport {type(exc).__name__}") from exc
        if response.status_code >= 400:
            raise PostgrestError(f"{method} {path}: HTTP {response.status_code}")
        return response

    @staticmethod
    def _rows(response: httpx.Response) -> list[dict[str, Any]]:
        if not response.content:
            return []
        try:
            body = response.json()
        except ValueError as exc:
            raise PostgrestError("response was not JSON") from exc
        return body if isinstance(body, list) else [body]

    def _scoped(self, filters: dict[str, Any] | None) -> dict[str, str]:
        """Every query is desk-scoped, and callers cannot forget to do it."""
        params = {"desk_id": f"eq.{self.desk_id}"}
        for column, value in (filters or {}).items():
            params[column] = value if isinstance(value, str) and "." in value[:12] else f"eq.{value}"
        return params

    # -- the interface the three stores use -------------------------------- #

    def migrate(self, _ddl: list[str]) -> None:
        """A no-op, and not a silent one.

        SQLite creates its tables on construction because it has nowhere else
        to put the DDL. Postgres has `supabase/migrations/`, applied out of
        band, and a store that issued CREATE TABLE at runtime would be a second
        schema authority racing the first.
        """
        log.debug("postgrest store: schema is owned by supabase/migrations, not by this process")

    def fetch(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: dict[str, Any] | None = None,
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        params = self._scoped(filters)
        params["select"] = columns
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(limit)
        return self._rows(self._send("GET", f"/{quote(table)}", params=params))

    def fetch_one(self, table: str, **kwargs: Any) -> dict[str, Any] | None:
        rows = self.fetch(table, limit=1, **kwargs)
        return rows[0] if rows else None

    def add(
        self,
        table: str,
        rows: dict[str, Any] | list[dict[str, Any]],
        *,
        returning: bool = False,
        on_conflict: str | None = None,
        resolution: str | None = None,
    ) -> list[dict[str, Any]]:
        payload = [rows] if isinstance(rows, dict) else list(rows)
        if not payload:
            return []
        payload = [{"desk_id": self.desk_id, **row} for row in payload]
        prefer = ["return=representation" if returning else "return=minimal"]
        if resolution:
            prefer.append(f"resolution={resolution}")
        if on_conflict and "desk_id" not in on_conflict:
            # Every unique constraint on these tables is (desk_id, <key>), so a
            # caller naming the business key alone would target a constraint
            # that does not exist. Expanded here rather than at six call sites.
            on_conflict = f"desk_id,{on_conflict}"
        params = {"on_conflict": on_conflict} if on_conflict else None
        response = self._send(
            "POST", f"/{quote(table)}", json=payload,
            headers={"Prefer": ",".join(prefer)}, params=params,
        )
        return self._rows(response) if returning else []

    def patch(
        self,
        table: str,
        *,
        filters: dict[str, Any],
        patch: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Returns the rows that changed — empty means the filter matched none.

        That return value is the whole point on the versioned path: a caller
        doing compare-and-swap reads "did my version still hold?" off the
        length, where SQLite read it off `cursor.rowcount` under a lock.
        """
        response = self._send(
            "PATCH", f"/{quote(table)}", json=patch,
            params=self._scoped(filters), headers={"Prefer": "return=representation"},
        )
        return self._rows(response)

    def count(self, table: str, *, filters: dict[str, Any] | None = None) -> int:
        """PostgREST counts in a header, not a column.

        `Prefer: count=exact` puts `0-24/1234` in Content-Range; the total is
        after the slash. Asking for `limit=1` keeps the body to one row rather
        than streaming the table back to count it.
        """
        params = self._scoped(filters)
        params["select"] = "id"
        params["limit"] = "1"
        response = self._send(
            "GET", f"/{quote(table)}", params=params,
            headers={"Prefer": "count=exact"},
        )
        total = response.headers.get("content-range", "").rpartition("/")[2]
        if not total.isdigit():
            raise PostgrestError(f"count for {table}: no exact count in Content-Range")
        return int(total)

    def remove(self, table: str, *, filters: dict[str, Any]) -> int:
        response = self._send(
            "DELETE", f"/{quote(table)}",
            params=self._scoped(filters), headers={"Prefer": "return=representation"},
        )
        return len(self._rows(response))

    def rpc(self, name: str, params: dict[str, Any] | None = None) -> Any:
        response = self._send("POST", f"/rpc/{quote(name)}", json=params or {})
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise PostgrestError(f"rpc {name}: response was not JSON") from exc

    def close(self) -> None:
        self._client.close()
