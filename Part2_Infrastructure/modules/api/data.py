"""Data: the contract-finding ledger, the work queue, and replay/backfill jobs.

The ledger routes report what the desk's providers actually delivered, and the
job routes are the only way to ask for bars to be re-fetched. Both take care to
distinguish "nothing to report" from "could not be read" — an empty list is a
claim about the data, not about the query.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from config import settings
from modules.api.deps import trader_identity
from modules.audit import get_audit
from modules.data_jobs import (
    DATA_KIND_PREFIX,
    executor_configured,
    job_view,
    submit_backfill,
    submit_replay,
)
from modules.data_quality import (
    DataQualityFindingsResponse,
    DataQualityView,
    get_data_quality,
)
from modules.data_quality_models import EscalationAck
from modules.data_scheduler import get_scheduler
from modules.jobs import get_queue
from modules.schemas import (
    DataBackfillRequest,
    DataJobAccepted,
    DataJobsResponse,
    DataReplayRequest,
    DataSchedulesResponse,
)
from modules.work_items import (
    VersionConflict,
    WorkItemConflict,
    WorkItemCreate,
    WorkItemPatch,
    WorkItemsResponse,
    WorkItemView,
    get_work_items,
)

router = APIRouter(tags=["data"])


@router.get("/api/data-quality/view", response_model=DataQualityView)
async def data_quality_view(_actor: str = Depends(trader_identity)) -> DataQualityView:
    """The merged, durable contract-finding ledger — the same view the sync returns."""
    return get_data_quality().view()


@router.post("/api/data-quality/escalations/{escalation_id}/ack", response_model=EscalationAck)
async def acknowledge_escalation(escalation_id: int, actor: str = Depends(trader_identity)) -> EscalationAck:
    """Take an open escalation.

    The actor recorded here is whatever `trader_identity` resolved to, which is
    `web:token` or `web:anonymous` — a capability, not a person. That is written
    down rather than dressed up: an acknowledgement from the web says which
    credential took it, and only Telegram, which carries a real user id, can say
    who. A desk that wants a name against an escalation uses `/ack`.

    Returns `taken: false` when there is nothing open with that id. Not an
    error — "already resolved" and "no such escalation" are both "there is
    nothing to take", and neither is a failure.
    """
    taken = await asyncio.to_thread(get_data_quality().acknowledge, escalation_id, actor)
    return EscalationAck(escalation_id=escalation_id, taken=taken, acknowledged_by=actor if taken else None)


@router.get("/api/data-quality/findings", response_model=DataQualityFindingsResponse)
async def data_quality_findings(
    limit: int = Query(default=100, ge=1, le=500),
    provider: str | None = Query(default=None, max_length=64),
    capability: str | None = Query(default=None, max_length=32),
    severity: str | None = Query(default=None, pattern=r"^(fatal|warn|drift|clean)$"),
    since: datetime | None = Query(default=None, description="ISO-8601; only findings observed at or after this"),
    _actor: str = Depends(trader_identity),
) -> DataQualityFindingsResponse:
    """Older findings than the view carries, filtered; newest first."""
    ledger = get_data_quality()
    rows, total = ledger.findings(
        limit=limit,
        provider=provider,
        capability=capability,
        severity=severity,
        since_ms=since.timestamp() * 1000.0 if since else None,
    )
    return DataQualityFindingsResponse(
        findings=rows,
        total=total,
        retention_days=ledger.retention_days,
        window_minutes=ledger.view_window_minutes,
        observed_at=datetime.now(timezone.utc),
    )


@router.get("/api/data/work-items", response_model=WorkItemsResponse)
async def list_work_items(_actor: str = Depends(trader_identity)) -> WorkItemsResponse:
    """The Data tab's work queue — persisted, versioned, audit-logged; seeded rows say so."""
    return get_work_items().response()


@router.post("/api/data/work-items", response_model=WorkItemView)
async def create_work_item(payload: WorkItemCreate, actor: str = Depends(trader_identity)) -> WorkItemView:
    return get_work_items().create(payload, actor=actor)


@router.patch(
    "/api/data/work-items/{item_id}",
    response_model=WorkItemView,
    responses={404: {"description": "unknown item"}, 409: {"model": WorkItemConflict, "description": "stale version"}},
)
async def patch_work_item(item_id: str, patch: WorkItemPatch, actor: str = Depends(trader_identity)) -> WorkItemView:
    """A versioned edit: a stale version is refused with the current row, never overwritten."""
    try:
        updated = get_work_items().patch(item_id, patch, actor=actor)
    except VersionConflict as conflict:
        return JSONResponse(
            status_code=409,
            content=WorkItemConflict(error="version_conflict", current=conflict.current).model_dump(mode="json"),
        )  # type: ignore[return-value]
    if updated is None:
        raise HTTPException(status_code=404, detail=f"no work item {item_id}")
    return updated


@router.post("/api/data/replay", response_model=DataJobAccepted)
async def data_replay(req: DataReplayRequest, actor: str = Depends(trader_identity)) -> DataJobAccepted:
    """Queue a replay: one capability, through the workspace's validated fetch path, cache bypassed."""
    if not executor_configured():
        raise HTTPException(status_code=503, detail="replay executor not configured — set WEB_WORKSPACE_URL on the gateway")
    record = submit_replay(req, actor=actor)
    return DataJobAccepted(job_id=record.job_id, kind="data.replay", status=record.status, backend=record.backend, poll=f"/api/jobs/{record.job_id}")


@router.post("/api/data/backfill", response_model=DataJobAccepted)
async def data_backfill(req: DataBackfillRequest, actor: str = Depends(trader_identity)) -> DataJobAccepted:
    """Queue a backfill: bars for a date range, contract-checked, merged into the bar cache."""
    from modules.data_jobs import INTERVAL_MS, is_equity

    span = int((req.to_at - req.from_at).total_seconds() * 1000 / INTERVAL_MS[req.interval]) + 1
    if span > settings.data_backfill_max_bars:
        raise HTTPException(status_code=422, detail=f"the range spans {span} bars; DATA_BACKFILL_MAX_BARS is {settings.data_backfill_max_bars}")
    if is_equity(req.symbol.upper()) and not executor_configured():
        raise HTTPException(status_code=503, detail="an equity backfill needs the workspace — set WEB_WORKSPACE_URL on the gateway")
    record = submit_backfill(req, actor=actor)
    return DataJobAccepted(job_id=record.job_id, kind="data.backfill", status=record.status, backend=record.backend, poll=f"/api/jobs/{record.job_id}")


@router.get("/api/data/jobs", response_model=DataJobsResponse)
async def data_jobs(limit: int = Query(default=25, ge=1, le=100), _actor: str = Depends(trader_identity)) -> DataJobsResponse:
    """Recent replay and backfill jobs: this process's queue, topped up from the audit log.

    The audit log's `jobs` table had been written since it was added and never
    once read — a repo-wide search for a SELECT against it returned nothing. So
    this route served the queue's in-process dict alone, which dies with the
    process, and after a deploy the desk reported that no job had ever run.

    In-process records win where both exist: they carry progress, message and
    the job's own summary, where a restored row carries only what `record_job`
    writes at terminal state. `restored_from_audit` says how many of the rows
    below are the thinner kind, so a reader is not left wondering why some have
    no summary.
    """
    queue = get_queue()
    live = queue.list(limit, kind_prefix=DATA_KIND_PREFIX)
    views = [job_view(record) for record in live]  # type: ignore[arg-type]
    seen = {view["job_id"] for view in views}

    restored = 0
    for row in get_audit().list_jobs(limit=limit, kind_prefix=DATA_KIND_PREFIX):
        if len(views) >= limit:
            break
        if row["job_id"] in seen:
            continue
        views.append({
            "job_id": row["job_id"],
            "kind": row["kind"],
            "status": row["status"],
            "submitted_at": row["submitted_at"],
            "finished_at": row["finished_at"],
            "backend": row["backend"] or "in-process",
            "error": row["error"],
            "params": {},
            "actor": "",
            "summary": None,
        })
        restored += 1

    return DataJobsResponse(
        observed_at=datetime.now(timezone.utc),
        backend=queue.backend,
        retained_in_process=restored == 0,
        executor_configured=executor_configured(),
        restored_from_audit=restored,
        jobs=views,
    )


@router.get("/api/data/schedules", response_model=DataSchedulesResponse)
async def data_schedules(_actor: str = Depends(trader_identity)) -> DataSchedulesResponse:
    """The configured replay/backfill schedule, valid or not, and when each last ran."""
    return DataSchedulesResponse(
        observed_at=datetime.now(timezone.utc),
        tick_seconds=settings.data_scheduler_tick_s,
        executor_configured=executor_configured(),
        max_backfill_bars=settings.data_backfill_max_bars,
        schedules=get_scheduler().views(),
    )
