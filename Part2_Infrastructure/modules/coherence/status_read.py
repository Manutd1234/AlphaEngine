"""Bounded, concurrent evidence collection for the coherence status route.

Status is the recovery signal for the desk.  It therefore owns a deadline
shorter than the HTTP route, starts every independent dependency together, and
turns dependency failures into explicit degraded evidence instead of allowing
one slow probe to sever the whole response.
"""

from __future__ import annotations

import asyncio
import logging
from importlib.util import find_spec
from typing import Any

from modules.backend_runtime import BackendBoundaryError, current_request_budget, run_blocking
from modules.coherence import tunables
from modules.coherence.drivers import kalshi_auth
from modules.coherence.drivers.kalshi_parse import schema_probe
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.recorder import recorder_state
from modules.coherence.scheduler.budget import get_read_budget
from modules.schemas import CoherenceBudgetStatus, CoherenceRecorderStatus, CoherenceStatus
from modules.schemas_coherence import CoherenceHostStatus, CoherenceShardStatus

log = logging.getLogger("alphaengine.coherence")

# The workspace gives this route an eight-second H2 budget.  The probes share
# this six-second ceiling, leaving room to serialise and return a truthful
# degraded answer before the proxy deadline.
STATUS_PROBE_DEADLINE_S = 6.0
STATUS_RESPONSE_MARGIN_S = 1.25
STATUS_CANCEL_GRACE_S = 0.05


def status_probe_deadline_s() -> float:
    """Fit the probes inside both their own ceiling and the caller's budget."""
    budget = current_request_budget()
    if budget is None:
        return STATUS_PROBE_DEADLINE_S
    return min(STATUS_PROBE_DEADLINE_S, max(0.0, budget.remaining_s() - STATUS_RESPONSE_MARGIN_S))


def _solver_status() -> dict[str, Any]:
    available = find_spec("scipy") is not None
    return {
        "linear_programme": "available" if available else "unavailable",
        "always_available": "closed_form",
        "detail": (
            "SciPy's HiGHS solves the full lattice"
            if available
            else "SciPy is not installed here; closed-form family checks still run and say so"
        ),
    }


def _status_response(
    *,
    notes: list[str],
    hosts: list[CoherenceHostStatus],
    shards: list[CoherenceShardStatus],
    probe: dict[str, Any],
    tape: dict[str, Any],
) -> CoherenceStatus:
    recorder = recorder_state().to_dict()
    reachable = any(host.reachable for host in hosts)
    state = (
        "ok"
        if reachable and probe.get("schema") == "fp-2026"
        else "degraded"
        if reachable
        else "unavailable"
    )
    return CoherenceStatus(
        state=state,
        hosts=hosts,
        shards=shards,
        schema_probe=probe,
        recorder=CoherenceRecorderStatus(
            **{key: value for key, value in recorder.items() if key != "last_error_ts_ns"}
        ),
        budget=CoherenceBudgetStatus(**get_read_budget().status()),
        tape=tape,
        solver=_solver_status(),
        signing=kalshi_auth.status(),
        dry_run=tunables.DRY_RUN,
        notes=notes,
    )


def _unavailable_status(detail: str) -> CoherenceStatus:
    return _status_response(
        notes=[detail],
        hosts=[
            CoherenceHostStatus(host=tunables.PUBLIC_BASE_URL, reachable=False, detail=detail)
        ],
        shards=[],
        probe={"schema": "unavailable", "detail": "no market payload was read"},
        tape={"state": "unavailable", "reason": detail},
    )


def _status_tape_health() -> dict[str, Any]:
    """Resolve and read the tape inside the bounded worker, never on the loop."""
    return get_store().health()


def _task_outcome(task: asyncio.Task[Any], label: str, deadline_s: float) -> Any:
    if not task.done() or task.cancelled():
        return TimeoutError(f"{label} exceeded its {deadline_s:g}s recovery budget")
    try:
        return task.result()
    except Exception as exc:
        return exc


async def _run_status_probes(
    client: KalshiClient,
    watchlist: tuple[str, ...] | list[str],
    deadline_s: float,
) -> tuple[Any, Any | None, Any]:
    """Start all independent reads together and stop all of them together."""
    status_task = asyncio.create_task(client.exchange_status())
    probe_task = asyncio.create_task(client.markets(watchlist[0], limit=1)) if watchlist else None
    tape_task = asyncio.create_task(
        run_blocking(
            "coherence.status.tape-health",
            _status_tape_health,
            timeout_s=deadline_s,
            dependency="coherence_tape",
        )
    )
    tasks: list[asyncio.Task[Any]] = [
        status_task,
        *([probe_task] if probe_task is not None else []),
        tape_task,
    ]
    try:
        await asyncio.wait(tasks, timeout=deadline_s)
    finally:
        pending = [task for task in tasks if not task.done()]
        for task in pending:
            if not task.done():
                task.cancel()
        if pending:
            _, stubborn = await asyncio.wait(pending, timeout=STATUS_CANCEL_GRACE_S)
            for task in stubborn:
                task.add_done_callback(_consume_background_task_result)
    return (
        _task_outcome(status_task, "status probe", deadline_s),
        _task_outcome(probe_task, "schema probe", deadline_s) if probe_task is not None else None,
        _task_outcome(tape_task, "tape health", deadline_s),
    )


def _consume_background_task_result(task: asyncio.Task[Any]) -> None:
    """Retrieve a detached probe result without extending the HTTP deadline."""
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.debug("detached status probe failed: %s", type(exc).__name__)


def _host_evidence(
    outcome: Any,
) -> tuple[list[CoherenceHostStatus], list[CoherenceShardStatus], list[str]]:
    if isinstance(outcome, KalshiUnavailable):
        return (
            [CoherenceHostStatus(host=tunables.PUBLIC_BASE_URL, reachable=False, detail=outcome.reason)],
            [],
            [f"Kalshi was not reachable: {outcome.reason}"],
        )
    if isinstance(outcome, Exception):
        detail = f"{type(outcome).__name__}: {outcome}"
        return (
            [CoherenceHostStatus(host=tunables.PUBLIC_BASE_URL, reachable=False, detail=detail)],
            [],
            [f"Kalshi status probe failed: {detail}"],
        )

    try:
        hosts = [CoherenceHostStatus(host=outcome.host, reachable=True)]
        shards = [
            CoherenceShardStatus(
                exchange_index=int(row.get("exchange_index", 0)),
                description=str(row.get("description", "")),
                exchange_active=bool(row.get("exchange_active")),
                trading_active=bool(row.get("trading_active")),
            )
            for row in outcome.payload.get("exchange_index_statuses") or []
        ]
        return hosts, shards, []
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        return (
            [CoherenceHostStatus(host=tunables.PUBLIC_BASE_URL, reachable=False, detail=detail)],
            [],
            [f"Kalshi status payload failed validation: {detail}"],
        )


def _schema_evidence(outcome: Any | None) -> tuple[dict[str, Any], list[str]]:
    unavailable = {"schema": "unavailable", "detail": "no market payload was read"}
    if outcome is None:
        return unavailable, ["no watchlist configured; set COHERENCE_SERIES to record and certify a series"]
    if isinstance(outcome, KalshiUnavailable):
        return unavailable, [f"schema could not be probed: {outcome.reason}"]
    if isinstance(outcome, Exception):
        return unavailable, [f"schema probe failed: {type(outcome).__name__}: {outcome}"]
    try:
        rows = outcome.payload.get("markets") or []
        return schema_probe(rows[0] if rows else None), []
    except Exception as exc:
        return unavailable, [f"schema probe failed: {type(exc).__name__}: {exc}"]


def _tape_evidence(outcome: Any) -> dict[str, Any]:
    if isinstance(outcome, (TapeUnavailable, BackendBoundaryError, TimeoutError)):
        return {"state": "unavailable", "reason": str(outcome)}
    if isinstance(outcome, Exception):
        return {"state": "unavailable", "reason": f"{type(outcome).__name__}: {outcome}"}
    if not isinstance(outcome, dict):
        return {"state": "unavailable", "reason": "tape health returned an invalid payload"}
    return outcome


async def read_status(watchlist: tuple[str, ...] | list[str]) -> CoherenceStatus:
    """Collect live status while guaranteeing room for the HTTP response."""
    deadline_s = status_probe_deadline_s()
    if deadline_s <= 0:
        return _unavailable_status("request budget was exhausted before live status probes could start")

    status_outcome, schema_outcome, tape_outcome = await _run_status_probes(
        KalshiClient(), watchlist, deadline_s
    )
    hosts, shards, host_notes = _host_evidence(status_outcome)
    probe, schema_notes = _schema_evidence(schema_outcome)
    return _status_response(
        notes=[*host_notes, *schema_notes],
        hosts=hosts,
        shards=shards,
        probe=probe,
        tape=_tape_evidence(tape_outcome),
    )
