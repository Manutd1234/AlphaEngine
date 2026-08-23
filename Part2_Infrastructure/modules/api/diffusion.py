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

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api.deps import trader_identity
from modules.coherence.diffusion.events import DiffusionEventStore
from modules.coherence.diffusion.findings import collect as collect_findings
from modules.coherence.diffusion.runs import AbsorptionRunStore
from modules.schemas import (
    DiffusionAbsorptionResponse,
    DiffusionEvent,
    DiffusionEventResponse,
    DiffusionEventsResponse,
    DiffusionFindingsResponse,
    DiffusionStageRecord,
)
from modules.schemas_diffusion import (
    DiffusionCalendar,
    DiffusionFinding,
    DiffusionGate,
    DiffusionHorizonCell,
    DiffusionStageRun,
    DiffusionStageSummary,
    DiffusionStudy,
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


def _runs() -> AbsorptionRunStore:
    return AbsorptionRunStore()


def _run(row: dict[str, Any]) -> DiffusionStageRun:
    cells = [
        DiffusionHorizonCell(
            horizon=str(cell.get("horizon")), state=cell.get("state", "unavailable"),
            abnormal_return=cell.get("abnormal_return"), absorbed=cell.get("absorbed"),
            bars=cell.get("bars"), reason=cell.get("reason"),
        )
        for cell in json.loads(row.get("points_json") or "[]")
    ]
    return DiffusionStageRun(
        run_id=str(row["run_id"]), source_ref=str(row["source_ref"]), symbol=str(row["symbol"]),
        stage=row["stage"], interval=str(row["interval"]), signal_state=row["signal_state"],
        signal_reason=row.get("signal_reason"), t0=_stamp(row["t0_ms"]),
        terminal_return=row.get("terminal_return"), half_life_s=row.get("half_life_s"),
        half_life_state=row.get("half_life_state"), half_life_vol=row.get("half_life_vol"),
        control_percentile=row.get("control_percentile"),
        controls_used=int(row.get("controls_used") or 0),
        measured_horizons=int(row.get("measured_horizons") or 0),
        of_horizons=int(row.get("of_horizons") or 0),
        market_adjusted=bool(row.get("market_adjusted")),
        data_hash=row.get("data_hash"), params_version=str(row.get("params_version") or ""),
        cells=cells,
    )


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _curve(runs: list[DiffusionStageRun], stage: str, horizons: list[str]) -> list[float | None]:
    """Mean absorbed fraction at each horizon, over the stages that measured it.

    A horizon nobody measured is None rather than zero: zero absorbed is a real
    reading and "we never looked" is not, and a chart that draws the second as
    the first invents a flat start to every curve.
    """
    out: list[float | None] = []
    for horizon in horizons:
        seen = [
            cell.absorbed
            for run in runs
            if run.stage == stage and run.signal_state == "ok"
            for cell in run.cells
            if cell.horizon == horizon and cell.absorbed is not None
        ]
        out.append(sum(seen) / len(seen) if seen else None)
    return out


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


@router.get("/api/research/diffusion/findings", response_model=DiffusionFindingsResponse)
async def diffusion_findings(
    _actor: str = Depends(trader_identity),
) -> DiffusionFindingsResponse:
    """Every headline relationship this module measured, positive and null alike.

    The nulls sit in the same table as the positive result at the same weight.
    A results surface that shows only what worked is a claim; one that shows
    what did not is a result, and the reader can see how many events sit behind
    each row and how often a shuffled pairing did as well.
    """
    try:
        gathered = collect_findings()
    except Exception as exc:  # noqa: BLE001 - the reason is the answer
        return DiffusionFindingsResponse(observed_at=_now(), state="unavailable", reason=str(exc))
    return DiffusionFindingsResponse(
        observed_at=_now(), state="ok", backend=gathered.get("backend"),
        calendar=DiffusionCalendar(**gathered["calendar"]),
        gate=DiffusionGate(**gathered["gate"]) if gathered.get("gate") else None,
        study=DiffusionStudy(**gathered["study"]) if gathered.get("study") else None,
        findings=[
            DiffusionFinding(
                name=row["name"], question=row["question"], stage=row["stage"], n=row["n"],
                t_statistic=row["t"], correlation=row["r"], shuffled_p=row["p"],
                verdict=row["verdict"], note=row["note"],
            )
            for row in gathered["findings"]
        ],
    )


@router.get("/api/research/diffusion/absorption", response_model=DiffusionAbsorptionResponse)
async def diffusion_absorption(
    limit: int = Query(default=200, ge=1, le=600),
    source_ref: str | None = Query(default=None, max_length=64),
    _actor: str = Depends(trader_identity),
) -> DiffusionAbsorptionResponse:
    """Every measured stage, the mean decay curve, and the attrition behind it.

    The refusals travel with the measurements. Most FOMC decisions move neither
    stage two pre-event sigmas, so a summary that reported only the stages that
    cleared the floor would describe a quarter of the sample as though it were
    all of it.
    """
    try:
        ledger = _runs()
    except Exception as exc:  # noqa: BLE001
        return DiffusionAbsorptionResponse(observed_at=_now(), state="unavailable", reason=str(exc))
    try:
        rows, truncated = ledger.list_runs(limit=limit, source_ref=source_ref)
    except Exception as exc:  # noqa: BLE001
        return DiffusionAbsorptionResponse(observed_at=_now(), state="unreadable",
                                           backend=ledger.backend, reason=str(exc))
    runs = [_run(row) for row in rows]
    horizons: list[str] = []
    for run in runs:
        for cell in run.cells:
            if cell.horizon not in horizons:
                horizons.append(cell.horizon)
    summaries: list[DiffusionStageSummary] = []
    for stage in ("release", "call"):
        stage_runs = [run for run in runs if run.stage == stage]
        measured = [run for run in stage_runs if run.signal_state == "ok"]
        summaries.append(DiffusionStageSummary(
            stage=stage,
            measured=len(measured),
            no_signal=sum(1 for run in stage_runs if run.signal_state == "no_signal"),
            other=sum(1 for run in stage_runs if run.signal_state not in {"ok", "no_signal"}),
            median_half_life_s=_median([run.half_life_s for run in measured if run.half_life_s]),
            median_control_percentile=_median(
                [run.control_percentile for run in measured if run.control_percentile is not None]),
            reason=None if measured else "no stage of this kind cleared the signal floor",
        ))
    return DiffusionAbsorptionResponse(
        observed_at=_now(), state="ok", backend=ledger.backend, truncated=truncated,
        horizons=horizons, release_curve=_curve(runs, "release", horizons),
        call_curve=_curve(runs, "call", horizons), stages=summaries, runs=runs,
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
