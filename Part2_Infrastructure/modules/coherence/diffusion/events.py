"""The event ledger: what the desk knew about an announcement, and when.

Two clocks per row, and conflating them is the defect this table exists to
prevent. `release_at` is what the vendor says the announcement happened;
`first_seen_at` is when this gateway first wrote the row down. A study that
scores an event using a timestamp revised after the fact is a study with
look-ahead in it, so the vendor stamp may move — `revised_count` counts it —
and the ingest clock never does.

The store is composed over `DataOpsStore` rather than over SQLite, for the
reason `ScheduleRunStore` gives: the backend is a setting. Events must exist
on a desk with no Supabase, because the calendar is the input to everything
else here and a research module that only works when a cloud project is
configured is a research module that mostly does not run.

`release_timing` keeps the vendor's own word — BMO, AMC, TAS, TNS, or `exact`
for a decision timed to the minute. It is NOT folded into the timestamp. It is
the only signal in a free feed that says whether a release landed before the
open or after the close, and a study that loses it cannot place its own anchor.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from modules.data_ops_backend import DataOpsStore, get_data_ops_store

EventKind = Literal["earnings", "fomc", "macro"]
StageSource = Literal["vendor", "issuer", "estimated_offset", "parsed_release", "recorded"]

# ``fed_seed`` was the source attached to an authored FOMC calendar that used
# to ship in this package.  It is deliberately absent from the accepted set:
# new rows must originate with a provider/issuer or an explicit observation.
# The string remains only as a read filter below so an existing desk database
# cannot surface an old authored row after the production seed is removed.
STAGE_SOURCES = frozenset({"vendor", "issuer", "estimated_offset", "parsed_release", "recorded"})
_LEGACY_AUTHORED_SOURCE = "fed_seed"

#: What a vendor's session-placement word is allowed to be. `exact` is ours,
#: for a decision stamped to the minute; the rest are Yahoo's own vocabulary.
RELEASE_TIMINGS = ("BMO", "AMC", "TAS", "TNS", "exact")


@dataclass(frozen=True)
class EventUpsert:
    """One calendar row on its way in. Absent fields stay absent."""

    kind: EventKind
    source_ref: str
    title: str
    release_at: float
    release_at_source: StageSource
    symbol: str | None = None
    release_timing: str | None = None
    call_at: float | None = None
    call_at_source: StageSource | None = None
    call_offset_min: float | None = None
    eps_estimate: float | None = None
    eps_actual: float | None = None
    surprise_pct: float | None = None
    scheduled: bool = True
    statement_url: str | None = None

    def __post_init__(self) -> None:
        """Reject source labels that cannot establish where a timestamp came from."""
        if self.release_at_source not in STAGE_SOURCES:
            raise ValueError(f"unsupported release stage source: {self.release_at_source!r}")
        if self.call_at_source is not None and self.call_at_source not in STAGE_SOURCES:
            raise ValueError(f"unsupported call stage source: {self.call_at_source!r}")

    def as_row(self, *, now_ms: float, desk_id: str) -> dict[str, Any]:
        return {
            "desk_id": desk_id,
            "source_ref": self.source_ref,
            "kind": self.kind,
            "symbol": self.symbol,
            "title": self.title,
            "release_at": float(self.release_at),
            "release_at_source": self.release_at_source,
            "release_timing": self.release_timing,
            "call_at": None if self.call_at is None else float(self.call_at),
            "call_at_source": self.call_at_source,
            "call_offset_min": self.call_offset_min,
            "eps_estimate": self.eps_estimate,
            "eps_actual": self.eps_actual,
            "surprise_pct": self.surprise_pct,
            "scheduled": 1 if self.scheduled else 0,
            "statement_url": self.statement_url,
            "first_seen_at": now_ms,
            "last_seen_at": now_ms,
            "revised_count": 0,
            "verified_at": None,
        }


class DiffusionEventStore:
    """Rows in, rows out, and a `first_seen_at` that survives every write."""

    _DDL = [
        """
        CREATE TABLE IF NOT EXISTS diffusion_events (
            source_ref TEXT PRIMARY KEY,
            desk_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            symbol TEXT,
            title TEXT NOT NULL,
            release_at REAL NOT NULL,
            release_at_source TEXT NOT NULL,
            release_timing TEXT,
            call_at REAL,
            call_at_source TEXT,
            call_offset_min REAL,
            eps_estimate REAL,
            eps_actual REAL,
            surprise_pct REAL,
            scheduled INTEGER NOT NULL DEFAULT 1,
            statement_url TEXT,
            first_seen_at REAL NOT NULL,
            last_seen_at REAL NOT NULL,
            revised_count INTEGER NOT NULL DEFAULT 0,
            verified_at REAL
        )
        """,
        "CREATE INDEX IF NOT EXISTS diffusion_events_by_release ON diffusion_events (desk_id, release_at)",
        "CREATE INDEX IF NOT EXISTS diffusion_events_by_symbol ON diffusion_events (desk_id, symbol, release_at)",
    ]

    def __init__(self, store: DataOpsStore | None = None, *, desk_id: str = "default") -> None:
        self._store = store if store is not None else get_data_ops_store()
        self._desk_id = str(getattr(self._store, "desk_id", None) or desk_id)
        self._store.migrate(self._DDL)

    @property
    def backend(self) -> str:
        return self._store.backend

    def upsert(self, event: EventUpsert, *, now_ms: float) -> dict[str, Any]:
        """Write a row, or reconcile it with the one already there.

        Reconciling means three things and never a fourth: `last_seen_at`
        moves, `revised_count` rises if the vendor's own stamp changed, and
        anything the incoming row knows that the stored row does not is
        filled in. `first_seen_at` is never touched — it is the point-in-time
        clock, and a merge that refreshed it would erase the only record of
        what the desk knew before the vendor revised.
        """
        row = event.as_row(now_ms=now_ms, desk_id=self._desk_id)
        existing = self._store.fetch_one("diffusion_events", filters={"source_ref": event.source_ref})
        if existing is None:
            self._store.add("diffusion_events", row)
            return row
        if existing.get("release_at_source") == _LEGACY_AUTHORED_SOURCE:
            # A genuine observation with the same natural key replaces the
            # authored row wholesale.  Keeping the old first-seen clock, call
            # time or generated URL would contaminate the new observation.
            self._store.remove("diffusion_events", filters={"source_ref": event.source_ref})
            self._store.add("diffusion_events", row)
            return row
        patch: dict[str, Any] = {"last_seen_at": now_ms}
        if existing.get("call_at_source") == _LEGACY_AUTHORED_SOURCE:
            # The successor Postgres CHECK is NOT VALID so an honest legacy row
            # can remain, but it is enforced on every later UPDATE. Repair the
            # retired call provenance before any ordinary observation patch so
            # that row cannot become permanently unwritable.
            patch.update({"call_at": None, "call_at_source": None, "call_offset_min": None})
        if _moved(existing.get("release_at"), row["release_at"]):
            patch["release_at"] = row["release_at"]
            patch["revised_count"] = int(existing.get("revised_count") or 0) + 1
        for field in ("release_at_source", "call_at", "call_at_source", "call_offset_min", "release_timing",
                      "eps_estimate", "eps_actual", "surprise_pct", "statement_url", "title"):
            incoming = row.get(field)
            if incoming is not None and existing.get(field) != incoming:
                patch[field] = incoming
        self._store.patch("diffusion_events", filters={"source_ref": event.source_ref}, patch=patch)
        merged = dict(existing)
        merged.update(patch)
        return merged

    def record_stage(self, source_ref: str, *, at_ms: float, source: StageSource = "recorded",
                     now_ms: float) -> dict[str, Any] | None:
        """Set the second stage from something better than an assumption."""
        if source not in STAGE_SOURCES:
            raise ValueError(f"unsupported recorded stage source: {source!r}")
        existing = self.get(source_ref)
        if existing is None:
            return None
        release_at = float(existing["release_at"])
        patch = {
            "call_at": float(at_ms),
            "call_at_source": source,
            "call_offset_min": (float(at_ms) - release_at) / 60_000.0,
            "last_seen_at": now_ms,
        }
        self._store.patch("diffusion_events", filters={"source_ref": source_ref}, patch=patch)
        merged = dict(existing)
        merged.update(patch)
        return merged

    def get(self, source_ref: str) -> dict[str, Any] | None:
        row = self._store.fetch_one("diffusion_events", filters={"source_ref": source_ref})
        if row is None or row.get("release_at_source") == _LEGACY_AUTHORED_SOURCE:
            return None
        return _without_legacy_call(row)

    def list_events(self, *, kind: str | None = None, symbol: str | None = None,
                    from_ms: float | None = None, to_ms: float | None = None,
                    limit: int = 100) -> tuple[list[dict[str, Any]], bool]:
        """Rows in the window, and whether the window was cut short.

        The upper bound is applied here rather than in the store because a
        filter dictionary holds one operator per column and a range needs two.
        That means the store's own `limit` lands BEFORE the clip, so a caller
        can be handed fewer rows than exist without the second flag saying so.
        The flag is that second thing, and every response carries it.
        """
        filters: dict[str, Any] = {
            "desk_id": self._desk_id,
            # Old ``fed_seed`` rows may still exist in a user's durable store.
            # They are historical authored fixtures, not observations, and do
            # not become live data merely because the code that made them is
            # gone.  Filter at the store so they cannot consume a page either.
            "release_at_source": f"neq.{_LEGACY_AUTHORED_SOURCE}",
        }
        if kind is not None:
            filters["kind"] = kind
        if symbol is not None:
            filters["symbol"] = symbol
        if from_ms is not None:
            filters["release_at"] = f"gte.{float(from_ms)}"
        fetched = self._store.fetch(
            "diffusion_events", filters=filters, order="release_at.asc",
            limit=max(1, int(limit)) + 1,
        )
        clipped = [
            _without_legacy_call(row)
            for row in fetched
            if to_ms is None or float(row["release_at"]) <= float(to_ms)
        ]
        truncated = len(clipped) > limit or len(fetched) > len(clipped) and len(fetched) > limit
        return clipped[:limit], truncated

    def count(self) -> int:
        return self._store.count(
            "diffusion_events",
            filters={
                "desk_id": self._desk_id,
                "release_at_source": f"neq.{_LEGACY_AUTHORED_SOURCE}",
            },
        )

    def close(self) -> None:
        self._store.close()


def _moved(stored: Any, incoming: float) -> bool:
    if stored is None:
        return False
    try:
        return abs(float(stored) - float(incoming)) >= 1.0
    except (TypeError, ValueError):
        return False


def _without_legacy_call(row: dict[str, Any]) -> dict[str, Any]:
    """Withhold a call timestamp that came from the retired authored calendar."""
    if row.get("call_at_source") != _LEGACY_AUTHORED_SOURCE:
        return row
    clean = dict(row)
    clean.update({"call_at": None, "call_at_source": None, "call_offset_min": None})
    return clean
