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


class WorkItemStore(SqliteStore):
    def __init__(self, path: str, *, seed: bool | None = None, now_ms: float | None = None) -> None:
        super().__init__(path)
        self.migrate(_DDL)
        should_seed = settings.data_work_seed if seed is None else seed
        if should_seed and self.count() == 0:
            self._seed(now_ms if now_ms is not None else _now_ms())

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
            rows.append((item_id, kind, priority, status, title, summary, owner, area,
                         opened, sla_due, resolved, SEED_ACTOR, now, SEED_ACTOR, 1))
        self.executemany(
            "INSERT INTO data_work_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows,
        )
        log.info("work-item store seeded with %d sample rows", len(rows))

    # -- read --------------------------------------------------------------- #
    @staticmethod
    def _view(row: dict[str, Any]) -> WorkItemView:
        return WorkItemView(**row)

    def list(self) -> list[WorkItemView]:
        return [self._view(r) for r in self.query("SELECT * FROM data_work_items ORDER BY opened_at DESC, id")]

    def get(self, item_id: str) -> WorkItemView | None:
        row = self.one("SELECT * FROM data_work_items WHERE id=?", (item_id,))
        return self._view(row) if row else None

    def count(self) -> int:
        return int((self.one("SELECT COUNT(*) AS n FROM data_work_items") or {}).get("n") or 0)

    def seeded_count(self) -> int:
        return int((self.one("SELECT COUNT(*) AS n FROM data_work_items WHERE created_by=?", (SEED_ACTOR,)) or {}).get("n") or 0)

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
        # Allocated inside the transaction so two concurrent creates cannot
        # mint the same id — the same rule the browser used (`nextDataWorkId`).
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT MAX(CAST(substr(id, ?) AS INTEGER)) AS n FROM data_work_items WHERE id LIKE ?",
                (len(prefix) + 2, f"{prefix}-%"),
            ).fetchone()
            largest = int(row["n"] or 0) if row else 0
            item_id = f"{prefix}-{largest + 1:03d}"
            conn.execute(
                "INSERT INTO data_work_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (item_id, payload.kind, payload.priority, "intake", payload.title.strip(),
                 payload.summary.strip(), payload.owner.strip() or "Unassigned", payload.area.strip() or "Pipeline",
                 now, sla_due, None, actor, now, actor, 1),
            )
        created = self.get(item_id)
        assert created is not None
        self._audit("work_item_created", actor, created, {"kind": payload.kind, "priority": payload.priority})
        return created

    def patch(self, item_id: str, patch: WorkItemPatch, *, actor: str, now_ms: float | None = None) -> WorkItemView | None:
        """Apply a versioned edit. Returns None for an unknown id; raises VersionConflict on a stale version."""
        now = now_ms if now_ms is not None else _now_ms()
        changes = {k: v for k, v in patch.model_dump().items() if k != "version" and v is not None}
        with self.transaction() as conn:
            current = conn.execute("SELECT * FROM data_work_items WHERE id=?", (item_id,)).fetchone()
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
            sets = ", ".join(f"{k}=?" for k in changes)
            params: list[Any] = [*changes.values(), resolved_at, now, actor, patch.version + 1, item_id, patch.version]
            conn.execute(
                f"UPDATE data_work_items SET {sets}{', ' if sets else ''}resolved_at=?, updated_at=?, updated_by=?, version=? "  # noqa: S608 - column names are the model's own field names
                "WHERE id=? AND version=?",
                params,
            )
        updated = self.get(item_id)
        assert updated is not None
        self._audit("work_item_updated", actor, updated, {"changes": changes, "version": updated.version})
        return updated

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
        self.execute("DELETE FROM data_work_items")


_store: WorkItemStore | None = None


def get_work_items() -> WorkItemStore:
    global _store
    if _store is None:
        _store = WorkItemStore(str(settings.data_ops_db_path))
    return _store
