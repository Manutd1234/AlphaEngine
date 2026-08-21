"""Reconciliation on a cadence — the sweep the event-driven corpus cannot do.

Linking on write, describing on render and planning per query all fire as one
document is written, so the graph is only ever as complete as the corpus was at
that instant: a document written before its sibling never gets the edge, an
entity that becomes linkable later never links backwards, a run indexed before
its walk-forward existed has no chart document for it. Nothing sweeps for that.
This module is the SCHEDULE; the sweep is `modules/research_reconcile.py`,
imported lazily, so a desk without it reports the absence and keeps ticking.

NOT CELERY BEAT. `celery_tasks` is imported only when a broker is configured, so
a beat reconciler would not exist on the default deployment — and reconciliation
that runs only on the scaled topology is not reconciliation. beat is also a
second scheduler process and a second cadence declaration beside
`DATA_SCHEDULES`, while `DataScheduler` already has restart safety
(`ScheduleRunStore`, keyed by schedule id) and an injected clock. The WORK still
reaches Celery for free: `JobQueue.submit` routes to the broker when there is
one and to the in-process pool when there is not.

WHY THE ARM IS HERE. `parse_schedule` takes only replay and backfill and
`DataScheduler.submit` hardcodes the same two; the third arm each is owed
belongs to a file this change may not edit. So it is here, built from the
scheduler's own parts rather than copies of them — `DataSchedule` computes the
next due time, `ScheduleRunStore` holds the last run, `ScheduleJobIndex` the
in-flight job ids, `JobQueue` the backend, and `parse_schedule` ITSELF parses
the cadence, so the closed vocabulary keeps one implementation. No second
broker, registry or store. When that arm lands, delete
`parse_reconcile_schedule` and move these expressions into `DATA_SCHEDULES`.

WHY `data.reconcile`. `on_data_job_complete` early-returns unless the kind
starts with `data.` and is the only caller of `record_schedule_outcome`, so a
`research.reconcile` would read "queued" for ever — the defect that hook fixed —
and would hold its job id in `ScheduleJobIndex` until capacity eviction,
restoring by a naming choice the leak that class closes. Absent from
`jobs.RETRYABLE` on purpose: a failed sweep waits for its next tick rather than
retrying into the same wall. Absent from `celery_tasks.TASK_MAP` too, a real gap
on a broker desk — `_submit_celery` fails the record at submit time and `submit`
below reports THAT reason verbatim, rather than copying the rule here.

NOT THE PLANNER, and determinism is not the reason: `plan` is a pure function
of the query and answers identically every time. (1) There is no query — a
scheduled planner would have to invent the question, a worse version of the
router's own rule that routing never invents an answer. (2) It would fill with
unasked-for plans the audit ledger that exists so a session replays. (3)
`max_calls` bounds one plan, not the plan-per-tick loop a scheduler is, which
sits outside every bound the router enforces. (4) It is read-only: nothing.

CHART DOCS, ONE HALF SWEEPABLE. A MISSING one is detectable with no figures at
all: a run card retains `oos_sharpe`, and `<job_id>:walk_forward` either exists
or does not. STALE chart TEXT is not — `metrics` is overwritten to
`{"chart": <name>}` at write time, so the figures behind the sentence are
discarded and the sentence is the only copy of its own inputs. Each chart sweep
reports that half NOT ASSESSABLE, with the reason, never folded into a clean
count. The fix is a retained field on the write path, not a sweep.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from config import settings
from modules.backoff import Backoff
from modules.data_scheduler import DataSchedule, ScheduleJobIndex, _job_index, parse_schedule

log = logging.getLogger("alphaengine.research_schedule")

#: The queue kind. The `data.` prefix is load-bearing — see the module note.
RECONCILE_KIND = "data.reconcile"

#: Scope -> the function it calls in `modules/research_reconcile.py`. The FIRST
#: name is the agreed one; the second is accepted because that module is being
#: written alongside this one and an unsettled name must not become a silent
#: no-op. When neither resolves, the sweep reports what the module DOES export.
ENTRYPOINTS: dict[str, tuple[str, ...]] = {
    "graph": ("reconcile_graph", "reconcile_edges"),
    "chart_docs": ("reconcile_chart_docs", "reconcile_charts"),
    "communities": ("reconcile_communities",),
}

#: Six-hourly is the honest default: the backlog a sweep clears accumulates at
#: the rate documents are written out of order, not at the rate a clock ticks.
DEFAULT_RECONCILE_SCHEDULES: tuple[str, ...] = (
    "reconcile:graph@every=6h",
    # Daily: a partition only moves when the edge set does. chart_docs stays unscheduled.
    "reconcile:communities@every=1d",
)

#: Carries a cadence into `parse_schedule`: the desk's own parser validates it, not a second copy.
_CADENCE_PROBE = "replay:quote:BTCUSDT"

#: The four dials. BATCH is documents per sweep — bounded work per tick, never a
#: full-corpus scan, because edge derivation is O(n²) over what it is given and a
#: backlog drains across ticks. HISTORY is ticks retained, oldest evicted first,
#: since a tick history is otherwise a leak that grows for as long as the process
#: stays healthy. BACKOFF defers a tick that could not dispatch, in seconds
#: doubling to the ceiling, so an unreachable dependency is retried within the
#: hour of arriving and not on all 120 ticks of it. HEARTBEAT is how often an idle
#: tick still logs at INFO — silence is indistinguishable from a stopped
#: scheduler, and a line every 30 seconds buries the ones that matter.
RECONCILE_BATCH = 200
_REPORT_HISTORY = 32
_BACKOFF_BASE_S, _BACKOFF_CEILING_S = 60.0, 3_600.0
_IDLE_HEARTBEAT = 20
_TERMINAL = ("succeeded", "failed", "cancelled")

_STALE_TEXT_UNASSESSABLE = (
    "not assessable from the corpus: a chart document's metrics are overwritten to "
    "{'chart': <name>} at write time, so the figures behind the sentence are discarded "
    "and there is nothing to compare it against. Retaining them on the write path "
    "would make this a comparison; a wider sweep cannot."
)


class ReconcileUnavailable(RuntimeError):
    """The sweep could not be attempted, carrying why in its message."""


@dataclass(frozen=True)
class ScheduleOutcome:
    """What one schedule did on one tick. `deferred` is never a silent skip."""

    schedule_id: str
    action: str  # submitted | deferred
    detail: str
    job_id: str | None = None
    retry_at_ms: float | None = None

    def line(self) -> str:
        at = datetime.fromtimestamp(self.retry_at_ms / 1000.0, tz=timezone.utc) if self.retry_at_ms else None
        return (f"{self.schedule_id} {self.action}{f' job={self.job_id}' if self.job_id else ''}"
                f"{f' retry_at={at:%H:%M:%SZ}' if at else ''}: {self.detail}")


@dataclass(frozen=True)
class TickReport:
    """Every tick reports, including the ones that did nothing."""

    at_ms: float
    considered: int
    outcomes: tuple[ScheduleOutcome, ...] = ()

    @property
    def submitted(self) -> tuple[str, ...]:
        return tuple(o.job_id for o in self.outcomes if o.action == "submitted" and o.job_id)

    def summary(self) -> str:
        head = f"research reconcile: {self.considered} schedule(s) considered"
        if not self.outcomes:
            return f"{head}, none due"
        deferred = len(self.outcomes) - len(self.submitted)
        return (f"{head}, {len(self.submitted)} submitted, {deferred} deferred — "
                + "; ".join(o.line() for o in self.outcomes))


def parse_reconcile_schedule(expression: str) -> DataSchedule:
    """`reconcile:<scope>@every=<15m|1h|6h|1d>`, or `@daily=HH:MM` in UTC. The
    scope rides in `capability` because `DataSchedule` is not this module's
    dataclass to widen; an invalid entry comes back `valid=False` with its
    reason, never dropped."""
    spec, _, cadence = expression.partition("@")
    parts = spec.split(":")
    scope = parts[1] if len(parts) == 2 and parts[0] == "reconcile" else ""
    probe = parse_schedule(f"{_CADENCE_PROBE}@{cadence}")
    if not scope:
        error = "expression must be reconcile:<scope>@<cadence>"
    elif scope not in ENTRYPOINTS:
        error = f"scope must be one of {', '.join(sorted(ENTRYPOINTS))}"
    else:
        error = probe.error
    return DataSchedule(
        id=f"research-reconcile-{scope or 'unknown'}", kind="reconcile", expression=expression,
        valid=error is None, cadence=probe.cadence, error=error, capability=scope or None,
        every_ms=probe.every_ms, daily_hhmm=probe.daily_hhmm,
    )


def _resolve(scope: str) -> tuple[Callable[..., Any], str]:
    """The sweep for `scope`, or `ReconcileUnavailable` saying exactly why."""
    names = ENTRYPOINTS.get(scope)
    if not names:
        raise ReconcileUnavailable(f"unknown scope {scope!r}")
    try:
        from modules import research_reconcile  # lazy: a sibling module, possibly absent
    except ImportError as exc:
        raise ReconcileUnavailable(f"modules.research_reconcile is not importable: {exc}") from exc
    for name in names:
        if callable(fn := getattr(research_reconcile, name, None)):
            return fn, name
    exported = sorted(n for n in dir(research_reconcile) if not n.startswith("_"))
    raise ReconcileUnavailable(
        f"modules.research_reconcile exports none of {', '.join(names)}; it has {exported}")


def _invoke(fn: Callable[..., Any], **offered: Any) -> Any:
    """Call `fn` with whichever of `offered` it declares — the sibling's
    signature is not this module's to dictate."""
    params = inspect.signature(fn).parameters
    if not any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        offered = {k: v for k, v in offered.items() if k in params}
    out = fn(**offered)
    return asyncio.run(out) if inspect.iscoroutine(out) else out


def run_reconcile(params: dict[str, Any], *, job_id: str | None = None) -> dict[str, Any]:
    """One sweep, in the job pool or in a Celery worker, unchanged.

    Raises `ReconcileUnavailable` rather than returning a clean run that did
    nothing, so the job records `failed` WITH the reason. Carries no `rows` and
    no `finding`: the two keys `on_data_job_complete` acts on."""
    scope = str(params.get("scope") or "")
    limit = int(params.get("limit") or RECONCILE_BATCH)
    fn, name = _resolve(scope)
    out = _invoke(fn, desk_id=str(params.get("desk_id") or settings.supabase_desk_id),
                  limit=limit, now_ms=params.get("now_ms"), job_id=job_id)
    result: dict[str, Any] = {
        "scope": scope, "limit": limit, "entrypoint": f"modules.research_reconcile.{name}",
        "outcome": out if isinstance(out, dict) else {"returned": out},
    }
    if scope == "chart_docs":
        # Reported every time, never folded into the counts above.
        result["stale_text"] = {"assessable": False, "reason": _STALE_TEXT_UNASSESSABLE}
    return result


@dataclass
class _ScheduleState:
    """Per-schedule failure state: one entry per DECLARED schedule, built at
    construction and never added to at runtime. That is the bound — a map keyed
    by job id, symbol or query is keyed by something unbounded; this one is
    keyed by a closed list the constructor fixes."""

    backoff: Backoff
    deferred_until_ms: float | None = None


class ResearchReconcileScheduler:
    """When the sweep runs; where it runs stays `JobQueue`'s decision. The clock
    is injected — `now_ms` on every method, `clock` for the loop — so a cadence
    is testable without waiting six hours for it."""

    def __init__(
        self, expressions: list[str] | tuple[str, ...] | None = None, *,
        store: Any | None = None, job_index: ScheduleJobIndex | None = None,
        queue: Any | None = None, clock: Callable[[], float] | None = None,
        tick_s: float | None = None,
    ) -> None:
        self.schedules = [parse_reconcile_schedule(e) for e in
                          (DEFAULT_RECONCILE_SCHEDULES if expressions is None else expressions)]
        self._store, self._queue = store, queue
        # `is not None`, never `or`: ScheduleJobIndex defines __len__, so an EMPTY
        # injected index is falsy and `or` would write into the process-wide one.
        self._index = job_index if job_index is not None else _job_index
        self._clock = clock if clock is not None else (lambda: time.time() * 1000.0)
        self.tick_s = tick_s if tick_s is not None else settings.data_scheduler_tick_s
        self._state = {s.id: _ScheduleState(Backoff(base_s=_BACKOFF_BASE_S, ceiling_s=_BACKOFF_CEILING_S))
                       for s in self.schedules}
        self.reports: deque[TickReport] = deque(maxlen=_REPORT_HISTORY)
        self._idle_ticks = 0
        self._task: asyncio.Task[None] | None = None
        for s in self.schedules:
            if not s.valid:
                log.warning("reconcile schedule %r ignored: %s", s.expression, s.error)

    def _runs(self) -> Any:  # resolved late, so a test can hand over its own
        if self._store is None:
            from modules.data_jobs import ScheduleRunStore
            from modules.data_ops_backend import get_data_ops_store

            self._store = ScheduleRunStore(get_data_ops_store())
        return self._store

    def _jobs(self) -> Any:
        if self._queue is None:
            from modules.jobs import get_queue

            self._queue = get_queue()
        return self._queue

    def _now(self, now_ms: float | None) -> float:
        return float(now_ms) if now_ms is not None else float(self._clock())

    def next_attempt_ms(self, schedule: DataSchedule, now_ms: float | None = None) -> float | None:
        """The cadence, pushed out by any deferral currently in force."""
        if not schedule.valid:
            return None
        last = self._runs().last_run(schedule.id)
        due = schedule.next_due_ms(last["last_run_at"] if last else None, self._now(now_ms))
        deferred = self._state[schedule.id].deferred_until_ms
        return due if due is None or deferred is None else max(due, deferred)

    def due(self, now_ms: float | None = None) -> list[DataSchedule]:
        now = self._now(now_ms)
        return [s for s in self.schedules
                if (at := self.next_attempt_ms(s, now)) is not None and at <= now]

    def _defer(self, schedule: DataSchedule, now: float, why: str, job_id: str | None = None) -> ScheduleOutcome:
        state = self._state[schedule.id]
        state.deferred_until_ms = now + state.backoff.failed() * 1000.0
        return ScheduleOutcome(schedule.id, "deferred", why, job_id, state.deferred_until_ms)

    def _dispatched(self, schedule: DataSchedule, detail: str, job_id: str) -> ScheduleOutcome:
        state = self._state[schedule.id]
        state.backoff.succeeded()
        state.deferred_until_ms = None
        return ScheduleOutcome(schedule.id, "submitted", detail, job_id)

    def submit(self, schedule: DataSchedule, *, now_ms: float | None = None) -> ScheduleOutcome:
        if schedule.id not in self._state:
            raise ValueError(f"{schedule.id} is not a registered schedule of this scheduler")
        now = self._now(now_ms)
        # Pre-flight, so an absent sweep is a REPORTED deferral rather than a
        # job that fails in a worker. Whether the corpus itself is reachable is
        # the sweep's own finding to report, not a precondition guessed here.
        try:
            _resolve(schedule.capability or "")
        except ReconcileUnavailable as exc:
            return self._defer(schedule, now, str(exc))
        params = {"scope": schedule.capability or "", "limit": RECONCILE_BATCH, "now_ms": now}
        record = self._jobs().submit(RECONCILE_KIND, run_reconcile, params,
                                     meta={"actor": "research-reconcile-scheduler", "params": params})
        # Recorded whatever happened: one that fired and failed must not read
        # as one that never fired.
        self._runs().record_run(schedule.id, now, record.job_id, record.status)
        if record.status in _TERMINAL:
            # Already over at submit — a rejected Celery dispatch, or a pool
            # that finished first. No completion hook is coming to evict this
            # id, so it is never remembered in the first place.
            if record.status == "failed":
                return self._defer(schedule, now, record.error or "failed at submit", record.job_id)
            return self._dispatched(schedule, f"{record.status} at submit", record.job_id)
        self._index.remember(record.job_id, schedule.id)
        return self._dispatched(schedule, f"dispatched on {getattr(self._jobs(), 'backend', '?')}", record.job_id)

    def tick(self, now_ms: float | None = None) -> TickReport:
        """Submit whatever is due, isolating each schedule from the others."""
        now = self._now(now_ms)
        outcomes: list[ScheduleOutcome] = []
        for schedule in self.due(now):
            try:
                outcomes.append(self.submit(schedule, now_ms=now))
            except Exception as exc:
                outcomes.append(self._defer(schedule, now, f"{type(exc).__name__}: {exc}"))
        report = TickReport(at_ms=now, considered=len(self.schedules), outcomes=tuple(outcomes))
        self.reports.append(report)
        self._log(report)
        return report

    def _log(self, report: TickReport) -> None:
        self._idle_ticks = 0 if report.outcomes else self._idle_ticks + 1
        loud = bool(report.outcomes) or self._idle_ticks % _IDLE_HEARTBEAT == 1
        log.log(logging.INFO if loud else logging.DEBUG, "%s", report.summary())
        for outcome in report.outcomes:
            if outcome.action == "deferred" and self._state[outcome.schedule_id].backoff.exhausted:
                log.warning("research reconcile: %s has deferred to its ceiling — %s",
                            outcome.schedule_id, outcome.detail)

    async def loop(self, tick_s: float | None = None) -> None:
        interval = tick_s if tick_s is not None else self.tick_s
        while True:
            try:
                await asyncio.to_thread(self.tick)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("research reconcile tick failed (%s)", type(exc).__name__)
            await asyncio.sleep(max(1.0, interval))

    def start(self) -> None:  # one line in the lifespan, beside get_scheduler()
        if self._task is None and any(s.valid for s in self.schedules):
            self._task = asyncio.create_task(self.loop(), name="research-reconcile")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            log.debug("research reconcile scheduler cancelled")
        except Exception as exc:
            log.warning("research reconcile scheduler stopped with %s", type(exc).__name__)
        self._task = None


_reconciler: ResearchReconcileScheduler | None = None


def get_research_scheduler() -> ResearchReconcileScheduler:
    global _reconciler
    if _reconciler is None:
        _reconciler = ResearchReconcileScheduler()
    return _reconciler
