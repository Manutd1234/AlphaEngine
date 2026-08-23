"""The event ledger over HTTP: what is on the calendar, and when we learned it.

Tagged `diffusion` and not `research`, because `tests/test_api_routers.py`
holds one tag group per router module and `research` already belongs to
`modules/api/ml.py`. The PATHS still sit under `/api/research/` so that
`tests/test_research_security_auth.py` sweeps them: that suite reads the route
table off the live app and fails on any `/api/research/...` route with no entry
in its matrix, which is an auth gate inherited rather than re-implemented.

Every handler answers with a state before a payload. An unconfigured store, an
unreachable one and an empty one are three different things to do something
about, and a bare list says none of them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api.deps import trader_identity
from modules.coherence.diffusion.events import DiffusionEventStore
from modules.schemas import (
    DiffusionEvent,
    DiffusionEventResponse,
    DiffusionEventsResponse,
    DiffusionStageRecord,
)

router = APIRouter(tags=["diffusion"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(value: Any) -> datetime | None:
    if value is None:
        return None
    return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)


def _event(row: dict[str, Any]) -> DiffusionEvent:
    return DiffusionEvent(
        source_ref=str(row["source_ref"]),
        kind=row["kind"],
        symbol=row.get("symbol"),
        title=str(row["title"]),
        release_at=_stamp(row["release_at"]),
        release_at_source=row["release_at_source"],
        release_timing=row.get("release_timing"),
        call_at=_stamp(row.get("call_at")),
        call_at_source=row.get("call_at_source"),
        call_offset_min=row.get("call_offset_min"),
        first_seen_at=_stamp(row["first_seen_at"]),
        revised_count=int(row.get("revised_count") or 0),
        eps_estimate=row.get("eps_estimate"),
        eps_actual=row.get("eps_actual"),
        surprise_pct=row.get("surprise_pct"),
        scheduled=bool(row.get("scheduled", 1)),
        verified_at=_stamp(row.get("verified_at")),
        statement_url=row.get("statement_url"),
    )


def _store() -> DiffusionEventStore:
    return DiffusionEventStore()


@router.get("/api/research/diffusion/events", response_model=DiffusionEventsResponse)
async def diffusion_events(
    kind: str | None = Query(default=None, pattern="^(earnings|fomc|macro)$"),
    symbol: str | None = Query(default=None, max_length=16),
    limit: int = Query(default=50, ge=1, le=200),
    _actor: str = Depends(trader_identity),
) -> DiffusionEventsResponse:
    """The announcements the desk is watching, oldest first.

    An empty ledger is `state: "ok"` with no rows — the calendar pull has not
    run — and is deliberately not the same answer as a store that could not be
    opened. The Events pane renders a different sentence for each.
    """
    try:
        store = _store()
    except Exception as exc:  # noqa: BLE001 - the reason is the answer
        return DiffusionEventsResponse(observed_at=_now(), state="unavailable", reason=str(exc))
    try:
        rows, truncated = store.list_events(
            kind=kind, symbol=symbol.upper() if symbol else None, limit=limit
        )
    except Exception as exc:  # noqa: BLE001
        return DiffusionEventsResponse(observed_at=_now(), state="unreadable",
                                       backend=store.backend, reason=str(exc))
    return DiffusionEventsResponse(
        observed_at=_now(), state="ok", backend=store.backend, truncated=truncated,
        events=[_event(row) for row in rows],
    )


@router.post("/api/research/diffusion/events/{source_ref}/stage",
             response_model=DiffusionEventResponse)
async def diffusion_record_stage(
    source_ref: str,
    body: DiffusionStageRecord,
    _actor: str = Depends(trader_identity),
) -> DiffusionEventResponse:
    """Replace an assumed second-stage time with an observed one.

    The earnings arm has no free feed for when a conference call starts, so the
    ledger carries `release + offset` with `call_at_source:
    "estimated_offset"`. This is how that assumption is retired one event at a
    time; the source it is replaced with travels with it, because a horizon
    measured from a guessed start and one measured from a recorded start are
    not the same measurement.
    """
    try:
        store = _store()
    except Exception as exc:  # noqa: BLE001
        return DiffusionEventResponse(observed_at=_now(), state="unavailable", reason=str(exc))
    now_ms = _now().timestamp() * 1000.0
    row = store.record_stage(source_ref, at_ms=body.at.timestamp() * 1000.0,
                             source=body.source, now_ms=now_ms)
    if row is None:
        return DiffusionEventResponse(observed_at=_now(), state="not_found",
                                      reason=f"no event on the ledger with source_ref {source_ref!r}")
    return DiffusionEventResponse(observed_at=_now(), state="ok", event=_event(row))
