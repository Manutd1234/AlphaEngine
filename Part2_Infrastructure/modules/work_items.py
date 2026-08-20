"""The Data tab's work queue, persisted.

The queue was browser-session state — nine seeded rows and whatever a reader
added, gone on reload, and honestly labelled as such. It now lives in the
gateway's data-operations SQLite file: every create and status change is a
versioned row (a stale edit is refused with the current row, never
overwritten) and an audit event, and every browser reads the same list.

Boundaries, stated: one gateway process and one file — durable across
restarts and deploys, not a ticket system with a workflow engine behind it.
The nine sample rows are seeded once, marked as such, and only when the table
is empty and ``DATA_WORK_SEED`` is on.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from config import settings
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
    seeded: int
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
]

# (id, kind, priority, status, title, summary, owner, area, age_minutes, sla_hours)
SEED_ITEMS: list[tuple[Any, ...]] = [
    ("BUG-091", "bug", "P0", "progress", "Duplicate SOLUSDT bars in the 4h backfill", "Two timestamps survive normalisation and distort realised volatility.", "Mei", "Market data", 74, 2),
    ("BUG-094", "bug", "P1", "progress", "News timestamps parsed in the browser timezone", "UTC vendor timestamps shift during enrichment and reorder the feed.", "Ravi", "Normalisation", 228, 8),
    ("TKT-322", "ticket", "P1", "intake", "Review changePercent schema drift", "Three Alpha Vantage payloads were served with a renamed secondary field.", "Unassigned", "Data contracts", 96, 8),
    ("REQ-184", "request", "P2", "intake", "Add perpetual funding-rate lineage", "Quant research needs provider and cache provenance on funding snapshots.", "Unassigned", "Research data", 41, 24),
    ("REQ-187", "request", "P2", "intake", "Define an SLO for cross-source spread", "Alert when the quote consensus remains outside tolerance for five minutes.", "Noah", "Observability", 19, 24),
    ("TKT-319", "ticket", "P2", "ready", "Raise the interactive quota reserve", "Protect manual traces while the background bars poll approaches its daily cap.", "Lina", "Capacity", 310, 24),
    ("REQ-179", "request", "P3", "ready", "Expose provider choice in research exports", "Add source, route rank, and cache age to the experiment artifact.", "Ravi", "Lineage", 522, 72),
    ("TKT-311", "ticket", "P3", "resolved", "Publish the failover drill runbook", "Document the bounded outage, expected route change, and restore check.", "Mei", "Runbooks", 1460, None),
    ("BUG-088", "bug", "P2", "resolved", "BTC quote freshness label lagged one poll", "The inspector now reports the response timestamp from the winning request.", "Lina", "Pipeline", 2040, None),
]

SEED_ACTOR = "seed"


def _now_ms() -> float:
    return time.time() * 1000.0


class VersionConflict(Exception):
    def __init__(self, current: WorkItemView) -> None:
        super().__init__(f"{current.id} is at version {current.version}")
        self.current = current


#: Declared once so the seed, the create and the row order cannot drift apart.
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

    def __init__(self, store: Any, *, seed: bool | None = None, now_ms: float | None = None) -> None:
        self._store = SqliteStore(store) if isinstance(store, (str, Path)) else store
        self._store.migrate(_DDL)
        should_seed = settings.data_work_seed if seed is None else seed
        if should_seed and self.count() == 0:
            self._seed(now_ms if now_ms is not None else _now_ms())

    @property
    def backend(self) -> str:
        return self._store.backend

    def close(self) -> None:
        self._store.close()

    @classmethod
    def in_memory(cls, **kwargs: Any) -> "WorkItemStore":
        return cls(":memory:", **kwargs)

    # -- seed --------------------------------------------------------------- #
    def _seed(self, now: float) -> None:
        rows = []
        for item_id, kind, priority, status, title, summary, owner, area, age_minutes, sla_hours in SEED_ITEMS:
            opened = now - age_minutes * 60_000
            sla_due = None if sla_hours is None else now + (sla_hours * 60 - age_minutes) * 60_000
            resolved = now - 60_000 if status == "resolved" else None
            rows.append(dict(zip(_COLUMNS, (
                item_id, kind, priority, status, title, summary, owner, area,
                opened, sla_due, resolved, SEED_ACTOR, now, SEED_ACTOR, 1,
            ), strict=True)))
        self._store.add(_TABLE, rows)
        log.info("work-item store seeded with %d sample rows", len(rows))

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

    def seeded_count(self) -> int:
        return self._store.count(_TABLE, filters={"created_by": SEED_ACTOR})

    def response(self) -> WorkItemsResponse:
        items = self.list()
        return WorkItemsResponse(
            # Read off the store, not written as a literal: a hardcoded "sqlite"
            # keeps reporting sqlite from a Postgres-backed deployment.
            backend=self.backend,
            observed_at=datetime.now(timezone.utc),
            count=len(items),
            seeded=self.seeded_count(),
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
            row = conn.execute(
                "SELECT MAX(CAST(substr(id, ?) AS INTEGER)) AS n FROM data_work_items WHERE id LIKE ?",
                (len(prefix) + 2, f"{prefix}-%"),
            ).fetchone()
            largest = int(row["n"] or 0) if row else 0
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
        _store = WorkItemStore(str(settings.data_ops_db_path))
    return _store
