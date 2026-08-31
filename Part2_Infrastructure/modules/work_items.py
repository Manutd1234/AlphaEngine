"""The Data tab's persisted work queue.

Rows exist only after an explicit create request. Every create and status change
is versioned and audit-logged, and a stale edit is refused with the current row
rather than overwritten. A fresh store is empty.

Boundaries, stated: one gateway process and one file — durable across restarts
and deploys, not a ticket system with a workflow engine behind it.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from modules.data_ops_backend import get_data_ops_store
from modules.data_ops_store import SqliteStore

log = logging.getLogger("alphaengine.work_items")

WorkKind = Literal["request", "ticket", "bug"]
WorkPriority = Literal["P0", "P1", "P2", "P3"]
WorkStatus = Literal["intake", "ready", "progress", "resolved"]

KIND_PREFIX: dict[str, str] = {"request": "REQ", "ticket": "TKT", "bug": "BUG"}
# The same SLA the board applied when it minted an item in the browser.
SLA_HOURS: dict[str, float | None] = {"P0": 2, "P1": 8, "P2": 24, "P3": 72}


# --------------------------------------------------------------------------- #
# Wire contract
# --------------------------------------------------------------------------- #
class WorkItemView(BaseModel):
    id: str
    kind: WorkKind
    priority: WorkPriority
    status: WorkStatus
    title: str
    summary: str
    owner: str
    area: str
    # Epoch milliseconds, matching the web's `openedAt: number`.
    opened_at: float
    sla_due_at: float | None
    resolved_at: float | None
    created_by: str
    updated_at: float
    updated_by: str
    version: int


class WorkItemCreate(BaseModel):
    kind: WorkKind
    priority: WorkPriority
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=400)
    owner: str = Field(default="Unassigned", max_length=40)
    area: str = Field(default="Pipeline", max_length=48)
    # None ⇒ the default for the priority; 0 ⇒ no SLA.
    sla_hours: float | None = Field(default=None, ge=0, le=720)


class WorkItemPatch(BaseModel):
    version: int = Field(ge=1)
    status: WorkStatus | None = None
    priority: WorkPriority | None = None
    owner: str | None = Field(default=None, max_length=40)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    summary: str | None = Field(default=None, max_length=400)
    area: str | None = Field(default=None, max_length=48)


class WorkItemsResponse(BaseModel):
    backend: Literal["sqlite", "postgres"]
    observed_at: datetime
    count: int
    items: list[WorkItemView]


class WorkItemConflict(BaseModel):
    error: Literal["version_conflict"]
    current: WorkItemView


# --------------------------------------------------------------------------- #
# Store
# --------------------------------------------------------------------------- #
_DDL = [
    """
    CREATE TABLE IF NOT EXISTS data_work_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('request','ticket','bug')),
        priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2','P3')),
        status TEXT NOT NULL CHECK(status IN ('intake','ready','progress','resolved')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        owner TEXT NOT NULL DEFAULT 'Unassigned',
        area TEXT NOT NULL DEFAULT 'Pipeline',
        opened_at REAL NOT NULL,
        sla_due_at REAL,
        resolved_at REAL,
        created_by TEXT NOT NULL,
        updated_at REAL NOT NULL,
        updated_by TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_work_items_status ON data_work_items(status, priority, opened_at)",
    # SQLite's stand-in for the Postgres sequence: the highest number ever
    # handed out per prefix, so a deleted id is never minted again.
    "CREATE TABLE IF NOT EXISTS data_work_item_ids (prefix TEXT PRIMARY KEY, n INTEGER NOT NULL)",
]

def _now_ms() -> float:
    return time.time() * 1000.0


class VersionConflict(Exception):
    def __init__(self, current: WorkItemView) -> None:
        super().__init__(f"{current.id} is at version {current.version}")
        self.current = current


#: Declared once so create and the persisted row order cannot drift apart.
_COLUMNS = ("id", "kind", "priority", "status", "title", "summary", "owner", "area",
            "opened_at", "sla_due_at", "resolved_at", "created_by", "updated_at",
            "updated_by", "version")

_TABLE = "data_work_items"


class WorkItemStore:
    """Work items on whichever backend is configured.

    Composed with a store rather than subclassing one, for the reason
    `ScheduleRunStore` was: inheriting `SqliteStore` made SQLite the definition
    of the class rather than a setting. Composition also resolves a name clash
    the inheritance had been hiding — this class's own `patch` is a versioned
    business edit, and the row-level `patch` it now calls is `self._store`'s.
    """

    def __init__(self, store: Any) -> None:
        self._store = SqliteStore(store) if isinstance(store, (str, Path)) else store
        self._store.migrate(_DDL)

    @property
    def backend(self) -> str:
        return self._store.backend

    def close(self) -> None:
        self._store.close()

    @classmethod
    def in_memory(cls) -> "WorkItemStore":
        return cls(":memory:")

    # -- read --------------------------------------------------------------- #
    @staticmethod
    def _view(row: dict[str, Any]) -> WorkItemView:
        return WorkItemView(**row)

    def list(self) -> list[WorkItemView]:
        rows = self._store.fetch(_TABLE, order="opened_at.desc")
        # Secondary sort in Python: PostgREST takes one `order` per call and a
        # second key would be a second round trip for a tie-break.
        rows.sort(key=lambda r: (-float(r["opened_at"]), str(r["id"])))
        return [self._view(r) for r in rows]

    def get(self, item_id: str) -> WorkItemView | None:
        row = self._store.fetch_one(_TABLE, filters={"id": item_id})
        return self._view(row) if row else None

    def count(self) -> int:
        return self._store.count(_TABLE)

    def response(self) -> WorkItemsResponse:
        items = self.list()
        return WorkItemsResponse(
            # Read off the store, not written as a literal: a hardcoded "sqlite"
            # keeps reporting sqlite from a Postgres-backed deployment.
            backend=self.backend,
            observed_at=datetime.now(timezone.utc),
            count=len(items),
            items=items,
        )

    # -- write -------------------------------------------------------------- #
    def create(self, payload: WorkItemCreate, *, actor: str, now_ms: float | None = None) -> WorkItemView:
        now = now_ms if now_ms is not None else _now_ms()
        prefix = KIND_PREFIX[payload.kind]
        sla_hours = SLA_HOURS[payload.priority] if payload.sla_hours is None else payload.sla_hours
        sla_due = None if not sla_hours else now + sla_hours * 3_600_000
        item_id = self._next_id(prefix)
        self._store.add(_TABLE, dict(zip(_COLUMNS, (
            item_id, payload.kind, payload.priority, "intake", payload.title.strip(),
            payload.summary.strip(), payload.owner.strip() or "Unassigned",
            payload.area.strip() or "Pipeline", now, sla_due, None, actor, now, actor, 1,
        ), strict=True)))
        created = self.get(item_id)
        assert created is not None
        self._audit("work_item_created", actor, created, {"kind": payload.kind, "priority": payload.priority})
        return created

    def patch(self, item_id: str, patch: WorkItemPatch, *, actor: str, now_ms: float | None = None) -> WorkItemView | None:
        """Apply a versioned edit. Returns None for an unknown id; raises VersionConflict on a stale version."""
        now = now_ms if now_ms is not None else _now_ms()
        changes = {k: v for k, v in patch.model_dump().items() if k != "version" and v is not None}
        current = self._store.fetch_one(_TABLE, filters={"id": item_id})
        if current is None:
            return None
        if int(current["version"]) != patch.version:
            raise VersionConflict(self._view(dict(current)))
        resolved_at = current["resolved_at"]
        if "status" in changes:
            if changes["status"] == "resolved" and current["status"] != "resolved":
                resolved_at = now
            elif changes["status"] != "resolved":
                resolved_at = None
        # The version is in the FILTER, not just the SET. That is what makes
        # this a compare-and-swap rather than a read-then-write: the read above
        # catches the common stale edit, and this catches the one that went
        # stale between the read and the write. The transaction it replaces
        # only ever held across one process's threads; this holds across
        # processes, which is the point of moving off the filesystem.
        changed = self._store.patch(
            _TABLE,
            filters={"id": item_id, "version": patch.version},
            patch={**changes, "resolved_at": resolved_at, "updated_at": now,
                   "updated_by": actor, "version": patch.version + 1},
        )
        if not changed:
            # The row was there a moment ago and the version no longer matches,
            # so another writer won the race between the read and the write.
            fresh = self._store.fetch_one(_TABLE, filters={"id": item_id})
            if fresh is None:
                return None
            raise VersionConflict(self._view(dict(fresh)))
        updated = self.get(item_id)
        assert updated is not None
        self._audit("work_item_updated", actor, updated, {"changes": changes, "version": updated.version})
        return updated

    def delete(self, item_id: str, *, actor: str) -> WorkItemView | None:
        """Remove one row for good. Returns the row as it was, or None for an unknown id.

        Not versioned, deliberately: a delete is the one edit with nothing to
        be stale against — whatever the row said a moment ago, the caller
        wants it gone. The audit event keeps what it said.
        """
        current = self.get(item_id)
        if current is None:
            return None
        removed = self._store.remove(_TABLE, filters={"id": item_id})
        if not removed:
            # Another writer deleted it between the read and the remove;
            # the outcome the caller asked for is the outcome either way.
            return None
        self._audit("work_item_deleted", actor, current, {"version": current.version})
        return current

    def _next_id(self, prefix: str) -> str:
        """One id, allocated so two concurrent creates cannot mint the same one.

        The strategy genuinely differs by backend and is not worth hiding.
        SQLite has no sequences, so it reads MAX and adds one inside a
        transaction. Postgres has them, so it calls `next_work_item_id`, which
        is atomic without a lock and correct across processes — the SQLite form
        is only correct because there is one.
        """
        if self._store.backend == "postgres":
            return str(self._store.rpc("next_work_item_id", {"prefix": prefix}))
        with self._store.transaction() as conn:
            # The floor is the highest id still in the table; the counter is
            # the highest ever minted. A delete lowers the first and not the
            # second, so the number a deleted row carried stays retired — an
            # audit line that names it keeps naming one thing.
            row = conn.execute(
                "SELECT MAX(CAST(substr(id, ?) AS INTEGER)) AS n FROM data_work_items WHERE id LIKE ?",
                (len(prefix) + 2, f"{prefix}-%"),
            ).fetchone()
            largest = int(row["n"] or 0) if row else 0
            minted = conn.execute("SELECT n FROM data_work_item_ids WHERE prefix = ?", (prefix,)).fetchone()
            if minted is not None:
                largest = max(largest, int(minted["n"]))
            conn.execute(
                "INSERT INTO data_work_item_ids (prefix, n) VALUES (?, ?) "
                "ON CONFLICT(prefix) DO UPDATE SET n = excluded.n",
                (prefix, largest + 1),
            )
            return f"{prefix}-{largest + 1:03d}"

    def _audit(self, event: str, actor: str, item: WorkItemView, payload: dict[str, Any]) -> None:
        try:
            from modules.audit import get_audit

            get_audit().record_risk_event(
                event,
                severity="info",
                actor=actor,
                detail=f"{item.id}: {item.title} [{item.status}, {item.priority}]",
                payload={"id": item.id, **payload},
            )
        except Exception as exc:  # pragma: no cover - the audit log is best-effort by design
            log.warning("work-item audit write failed (%s)", type(exc).__name__)

    def reset(self) -> None:
        self._store.remove(_TABLE, filters={"id": "neq.__none__"})


_store: WorkItemStore | None = None


def get_work_items() -> WorkItemStore:
    global _store
    if _store is None:
        _store = WorkItemStore(get_data_ops_store())
    return _store
