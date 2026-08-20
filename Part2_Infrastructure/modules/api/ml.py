"""Supervised research runs: start one, list them, read one back with its folds.

Tagged ``research`` rather than ``C · Research`` because these are the machine
learning corpus routes, not the backtest and retrieval ones. The evidence a
verdict rests on — every fold, its purge and its embargo — travels with the
run, because a Sharpe a reader cannot audit is a number they are being asked to
take on trust.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from modules.api.deps import trader_identity
from modules.ml.fit import ML_FIT_KIND, submit_ml_fit
from modules.ml.store import UNREADABLE, get_ml_store
from modules.schemas import (
    DataJobAccepted,
    MLFitRequest,
    MLRunDetail,
    MLRunsResponse,
    MLRunSummary,
)

router = APIRouter(tags=["research"])


@router.post("/api/research/ml/fit", response_model=DataJobAccepted)
async def ml_fit(req: MLFitRequest, actor: str = Depends(trader_identity)) -> DataJobAccepted:
    """Queue one supervised walk-forward and file its evidence.

    The piece that was missing. Everything under ``modules/ml`` was built and
    tested and nothing in production called any of it, so the corpus could only
    ever be empty and the Fitted models panel could only ever say so. This is
    the trigger.

    Queued rather than awaited: a fit is seconds of CPU, and holding a request
    open for it is what the job queue exists to avoid. Poll ``/api/jobs/{id}``.
    A run whose numbers are real but whose filing failed reports
    ``persisted: false`` with the reason, because those are different outcomes.
    """
    record = submit_ml_fit(req.model_dump(), actor=actor)
    return DataJobAccepted(
        job_id=record.job_id, kind=ML_FIT_KIND, status=record.status,
        backend=record.backend, poll=f"/api/jobs/{record.job_id}",
    )


@router.get("/api/research/ml/runs", response_model=MLRunsResponse)
async def ml_runs(
    limit: int = Query(default=25, ge=1, le=100),
    _actor: str = Depends(trader_identity),
) -> MLRunsResponse:
    """Supervised research runs, newest first — model, engine, and the deflated Sharpe.

    `state` separates "no runs" from "no store". An empty list under
    `unavailable` would report a deployment without Supabase as a desk that has
    never run anything, which is the confusion this codebase refuses everywhere
    else it fetches.

    SCOPE. The rows are filtered by `desk_id` in the query, not by row-level
    security. The gateway holds the service-role key, which bypasses RLS, and
    `trader_identity` resolves to an access decision rather than a user — so
    there is no `auth.uid()` here for the table's policy to compare against.
    The deployment is single-desk, which makes that honest today; the day a
    second desk exists this filter is the line that has to change.
    """
    store = get_ml_store()
    if not store.enabled:
        return MLRunsResponse(observed_at=datetime.now(timezone.utc), state="unavailable", runs=[])
    rows = await store.list_runs(limit=limit)
    if rows is None:
        # Configured but unreadable — a bad key, a missing table, a schema-cache
        # miss. Reporting this as an empty list would say "this desk has fitted
        # nothing", which is a claim about the desk rather than about the query.
        return MLRunsResponse(observed_at=datetime.now(timezone.utc), state="unreadable", runs=[])
    return MLRunsResponse(
        observed_at=datetime.now(timezone.utc),
        state="ok",
        runs=[MLRunSummary(**row) for row in rows],
    )


@router.get("/api/research/ml/runs/{run_id}", response_model=MLRunDetail)
async def ml_run_detail(run_id: str, _actor: str = Depends(trader_identity)) -> MLRunDetail:
    """One run with the evidence its verdict rests on: every fold, and the feature set.

    The folds carry their purge and embargo because those are what make the
    out-of-sample figures mean anything. A reader who cannot see them is being
    asked to take the Sharpe on trust.
    """
    store = get_ml_store()
    if not store.enabled:
        raise HTTPException(status_code=503, detail="no research corpus is configured on this deployment")
    row = await store.get_run(run_id)
    if row is UNREADABLE:
        raise HTTPException(status_code=503, detail=f"the research corpus could not be read for {run_id}")
    if row is None:
        raise HTTPException(status_code=404, detail=f"no such ML run: {run_id}")
    return MLRunDetail(**row)
