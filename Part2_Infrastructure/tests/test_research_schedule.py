"""The reconciliation schedule, against a fake clock.

Four properties, none testable by waiting: the cadence fires, a tick that could
not dispatch backs off instead of retrying on all 120 ticks of the next hour, an
unreachable sweep is REPORTED rather than crashing the loop, and every bounded
structure stays bounded when completions never arrive. `research_reconcile.py`
is a sibling change and may not exist yet, so every test installs its own —
which is also how the ImportError arm is exercised deterministically.
"""

from __future__ import annotations

import sys

import pytest

import modules
from modules.data_jobs import DATA_KIND_PREFIX
from modules.data_scheduler import ScheduleJobIndex
from modules.jobs import RETRYABLE
from modules.research_schedule import (
    DEFAULT_RECONCILE_SCHEDULES,
    ENTRYPOINTS,
    RECONCILE_KIND,
    ReconcileUnavailable,
    ResearchReconcileScheduler,
    parse_reconcile_schedule,
    run_reconcile,
)

HOUR_MS = 3_600_000.0
T0 = 1_800_000_000_000.0  # a plausible wall clock, well past any first-due epoch


class _Clock:
    """Injected time. Nothing in the scheduler reads a real clock."""

    def __init__(self, at_ms: float = T0) -> None:
        self.now_ms = float(at_ms)

    def __call__(self) -> float:
        return self.now_ms

    def advance(self, *, hours: float = 0.0, seconds: float = 0.0) -> None:
        self.now_ms += hours * HOUR_MS + seconds * 1000.0


class _Runs:
    """A ScheduleRunStore that remembers rather than persists."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def record_run(self, schedule_id: str, at_ms: float, job_id: str, outcome: str) -> None:
        self.rows[schedule_id] = {"last_run_at": at_ms, "last_job_id": job_id, "last_outcome": outcome}

    def last_run(self, schedule_id: str):
        return self.rows.get(schedule_id)


class _Record:
    def __init__(self, job_id: str, status: str = "queued", error: str | None = None) -> None:
        self.job_id, self.status, self.error = job_id, status, error


class _Queue:
    """The two things `submit` reads off a JobQueue, and a call log."""

    def __init__(self, *, status: str = "queued", error: str | None = None, backend: str = "in-process") -> None:
        self.backend, self._status, self._error = backend, status, error
        self.calls: list[tuple] = []

    def submit(self, kind, fn, *args, meta=None, **kwargs) -> _Record:
        self.calls.append((kind, args, meta))
        return _Record(f"job-{len(self.calls)}", self._status, self._error)


class _Sweep:
    """A stand-in for `modules.research_reconcile`, with a chosen surface."""

    def __init__(self, **members) -> None:
        self.__dict__.update(members)


def _install(monkeypatch, module) -> None:
    """Put a sibling module in place — or, with None, take it out."""
    if module is None:
        monkeypatch.delattr(modules, "research_reconcile", raising=False)
        monkeypatch.setitem(sys.modules, "modules.research_reconcile", None)
        return
    monkeypatch.setattr(modules, "research_reconcile", module, raising=False)
    monkeypatch.setitem(sys.modules, "modules.research_reconcile", module)


def _scheduler(clock, *, queue=None, runs=None, index=None, expressions=("reconcile:graph@every=6h",)):
    return ResearchReconcileScheduler(
        list(expressions), store=runs if runs is not None else _Runs(),
        queue=queue if queue is not None else _Queue(),
        job_index=index if index is not None else ScheduleJobIndex(),
        clock=clock,
    )


def _graph_sweep(**overrides):
    def reconcile_graph(desk_id: str, limit: int):
        return {"documents_examined": limit, "edges_written": 3, "desk_id": desk_id}

    return _Sweep(reconcile_graph=reconcile_graph, **overrides)


# --------------------------------------------------------------------------- #
# The declaration
# --------------------------------------------------------------------------- #
class TestWhatIsDeclared:
    def test_the_kind_carries_the_prefix_the_completion_hook_filters_on(self):
        """`on_data_job_complete` early-returns on anything else, and it is the
        only caller of `record_schedule_outcome` — so a kind outside this prefix
        would read "queued" for ever and hold its job id in the index."""
        assert RECONCILE_KIND.startswith(DATA_KIND_PREFIX)

    def test_a_failed_sweep_is_not_retried_into_the_same_wall(self):
        assert RECONCILE_KIND not in RETRYABLE, "a sweep waits for its next tick"

    def test_the_planner_is_not_one_of_the_scopes(self):
        """Recorded as a decision, not an omission: reconciliation is for the
        corpus, routing is for questions, and the router writes nothing."""
        assert set(ENTRYPOINTS) == {"graph", "chart_docs"}
        source = (modules.research_schedule.__doc__ or "")
        assert "NOT THE PLANNER" in source and "determinism is not the reason" in source

    def test_the_defaults_parse_and_run_six_hourly(self):
        for expression in DEFAULT_RECONCILE_SCHEDULES:
            schedule = parse_reconcile_schedule(expression)
            assert schedule.valid, schedule.error
            assert schedule.every_ms == 6 * HOUR_MS

    def test_a_cadence_outside_the_closed_vocabulary_is_reported_not_dropped(self):
        schedule = parse_reconcile_schedule("reconcile:graph@every=5m")
        assert not schedule.valid
        assert "every must be one of" in (schedule.error or "")

    def test_an_unknown_scope_says_which_scopes_exist(self):
        schedule = parse_reconcile_schedule("reconcile:everything@every=6h")
        assert not schedule.valid and "scope must be one of" in (schedule.error or "")


# --------------------------------------------------------------------------- #
# The cadence
# --------------------------------------------------------------------------- #
class TestTheCadenceFires:
    def test_a_schedule_that_has_never_run_fires_on_the_first_tick(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        clock, queue = _Clock(), _Queue()
        report = _scheduler(clock, queue=queue).tick()

        assert len(report.submitted) == 1
        assert queue.calls[0][0] == RECONCILE_KIND
        assert queue.calls[0][1][0]["scope"] == "graph"

    def test_it_does_not_fire_again_until_the_cadence_has_elapsed(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        clock, queue = _Clock(), _Queue()
        scheduler = _scheduler(clock, queue=queue)
        scheduler.tick()

        clock.advance(hours=5.9)
        assert scheduler.tick().submitted == (), "fired inside its own interval"

        clock.advance(hours=0.2)
        assert len(scheduler.tick().submitted) == 1
        assert len(queue.calls) == 2

    def test_the_run_row_carries_the_submit_status_for_a_restart_to_find(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        runs = _Runs()
        _scheduler(_Clock(), runs=runs).tick()
        assert runs.rows["research-reconcile-graph"]["last_outcome"] == "queued"

    def test_a_restart_between_ticks_does_not_re_fire(self, monkeypatch):
        """The store is the memory, not the process — a fresh scheduler over
        the same rows sees the schedule as already run."""
        _install(monkeypatch, _graph_sweep())
        clock, runs = _Clock(), _Runs()
        _scheduler(clock, runs=runs).tick()
        clock.advance(hours=1)
        assert _scheduler(clock, runs=runs).tick().submitted == ()


# --------------------------------------------------------------------------- #
# Failure and backoff
# --------------------------------------------------------------------------- #
class TestAFailureBacksOff:
    def test_a_deferred_tick_is_not_retried_on_the_very_next_tick(self, monkeypatch):
        _install(monkeypatch, None)
        clock = _Clock()
        scheduler = _scheduler(clock)

        first = scheduler.tick().outcomes[0]
        assert first.action == "deferred"
        assert first.retry_at_ms == clock.now_ms + 120_000.0, "60s base, doubled once"

        clock.advance(seconds=60)
        assert scheduler.tick().outcomes == (), "retried before its own backoff"

        clock.advance(seconds=61)
        second = scheduler.tick().outcomes[0]
        assert second.action == "deferred"
        assert second.retry_at_ms == clock.now_ms + 240_000.0, "the delay must grow"

    def test_the_delay_stops_growing_at_the_ceiling(self, monkeypatch):
        _install(monkeypatch, None)
        clock = _Clock()
        scheduler = _scheduler(clock)
        delays = []
        for _ in range(9):
            outcome = scheduler.tick().outcomes[0]
            delays.append(outcome.retry_at_ms - clock.now_ms)
            clock.advance(seconds=(outcome.retry_at_ms - clock.now_ms) / 1000.0 + 1)
        assert max(delays) == 3_600_000.0, "an uncapped backoff is a dead loop"
        assert delays[-1] == delays[-2] == 3_600_000.0

    def test_a_job_rejected_at_submit_is_reported_verbatim_and_never_remembered(self, monkeypatch):
        """`_submit_celery` fails the record when the kind is absent from
        TASK_MAP and returns without polling, so no completion hook is coming to
        evict the id. It is not put in the index in the first place."""
        _install(monkeypatch, _graph_sweep())
        queue = _Queue(status="failed", error=f"no celery task registered for kind={RECONCILE_KIND}", backend="celery")
        index, runs = ScheduleJobIndex(), _Runs()
        outcome = _scheduler(_Clock(), queue=queue, runs=runs, index=index).tick().outcomes[0]

        assert outcome.action == "deferred"
        assert "no celery task registered" in outcome.detail
        assert len(index) == 0, "an id nothing will complete must not enter the index"
        assert runs.rows["research-reconcile-graph"]["last_outcome"] == "failed"

    def test_a_dispatched_job_is_remembered_for_the_completion_hook(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        index = ScheduleJobIndex()
        _scheduler(_Clock(), index=index).tick()
        assert index.take("job-1") == "research-reconcile-graph"

    def test_recovery_is_immediate_once_the_sweep_arrives(self, monkeypatch):
        _install(monkeypatch, None)
        clock = _Clock()
        scheduler = _scheduler(clock)
        scheduler.tick()

        _install(monkeypatch, _graph_sweep())
        clock.advance(seconds=121)
        assert len(scheduler.tick().submitted) == 1
        clock.advance(hours=6)
        assert len(scheduler.tick().submitted) == 1, "the backoff must have reset"


# --------------------------------------------------------------------------- #
# An unreachable dependency
# --------------------------------------------------------------------------- #
class TestAnUnreachableDependencyIsReported:
    def test_an_absent_sweep_module_defers_with_the_reason(self, monkeypatch):
        _install(monkeypatch, None)
        report = _scheduler(_Clock()).tick()
        assert "modules.research_reconcile is not importable" in report.outcomes[0].detail
        assert "not importable" in report.summary()

    def test_a_sweep_module_missing_the_function_says_what_it_does_export(self, monkeypatch):
        _install(monkeypatch, _Sweep(reconcile_something_else=lambda: None))
        detail = _scheduler(_Clock()).tick().outcomes[0].detail
        assert "exports none of reconcile_graph, reconcile_edges" in detail
        assert "reconcile_something_else" in detail, "name the surface it does have"

    def test_the_loop_survives_a_sweep_that_cannot_be_resolved(self, monkeypatch):
        _install(monkeypatch, None)
        scheduler = _scheduler(_Clock(), expressions=("reconcile:graph@every=6h", "reconcile:chart_docs@every=6h"))
        report = scheduler.tick()
        assert len(report.outcomes) == 2, "one bad schedule must not take the tick with it"

    def test_the_second_name_is_accepted_while_the_sibling_settles(self, monkeypatch):
        _install(monkeypatch, _Sweep(reconcile_edges=lambda desk_id, limit: {"edges_written": 1}))
        assert len(_scheduler(_Clock()).tick().submitted) == 1

    def test_the_worker_side_raises_rather_than_reporting_a_clean_empty_run(self, monkeypatch):
        _install(monkeypatch, None)
        with pytest.raises(ReconcileUnavailable):
            run_reconcile({"scope": "graph"})


# --------------------------------------------------------------------------- #
# The sweep's own result
# --------------------------------------------------------------------------- #
class TestWhatTheSweepReports:
    def test_only_the_arguments_the_sibling_declares_are_passed(self, monkeypatch):
        seen = {}

        def reconcile_graph(desk_id):
            seen["desk_id"] = desk_id
            return {"edges_written": 0}

        _install(monkeypatch, _Sweep(reconcile_graph=reconcile_graph))
        result = run_reconcile({"scope": "graph", "desk_id": "desk-7", "limit": 5})
        assert seen == {"desk_id": "desk-7"}
        assert result["outcome"] == {"edges_written": 0}
        assert result["entrypoint"].endswith("reconcile_graph")

    def test_an_async_sweep_is_awaited(self, monkeypatch):
        async def reconcile_graph(limit):
            return {"edges_written": limit}

        _install(monkeypatch, _Sweep(reconcile_graph=reconcile_graph))
        assert run_reconcile({"scope": "graph", "limit": 4})["outcome"] == {"edges_written": 4}

    def test_an_empty_sweep_is_reported_not_hidden(self, monkeypatch):
        _install(monkeypatch, _Sweep(reconcile_graph=lambda limit: {"edges_written": 0, "examined": 0}))
        assert run_reconcile({"scope": "graph"})["outcome"]["edges_written"] == 0

    def test_chart_staleness_is_reported_as_not_assessable_with_its_reason(self, monkeypatch):
        """The figures behind a chart sentence are discarded at write time, so
        "stale" is not a measurement this sweep can take. It says so rather than
        folding the unmeasured half into a clean count."""
        _install(monkeypatch, _Sweep(reconcile_chart_docs=lambda limit: {"missing": 2}))
        result = run_reconcile({"scope": "chart_docs"})
        assert result["outcome"] == {"missing": 2}
        assert result["stale_text"]["assessable"] is False
        assert "overwritten" in result["stale_text"]["reason"]

    def test_the_graph_sweep_makes_no_such_claim(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        assert "stale_text" not in run_reconcile({"scope": "graph"})

    def test_the_result_carries_neither_key_the_completion_hook_acts_on(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        result = run_reconcile({"scope": "graph"})
        assert "rows" not in result and "finding" not in result


# --------------------------------------------------------------------------- #
# The bounds
# --------------------------------------------------------------------------- #
class TestTheBoundsHold:
    def test_the_tick_history_evicts_the_oldest_and_never_grows(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        clock = _Clock()
        scheduler = _scheduler(clock)
        for _ in range(80):
            scheduler.tick()
            clock.advance(hours=6)
        assert len(scheduler.reports) == 32
        assert scheduler.reports[0].at_ms > T0, "the oldest ticks were evicted"

    def test_a_stream_of_never_completing_submissions_stays_bounded(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        clock = _Clock()
        index = ScheduleJobIndex(capacity=4)
        scheduler = _scheduler(clock, index=index)
        for _ in range(50):
            scheduler.tick()
            clock.advance(hours=6)
        assert len(index) == 4

    def test_the_per_schedule_state_map_is_closed_at_construction(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        clock = _Clock()
        scheduler = _scheduler(clock)
        for _ in range(20):
            scheduler.tick()
            clock.advance(hours=6)
        assert len(scheduler._state) == 1, "a key per tick would be the leak this avoids"

    def test_a_schedule_this_scheduler_never_declared_is_refused(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        scheduler = _scheduler(_Clock())
        with pytest.raises(ValueError, match="not a registered schedule"):
            scheduler.submit(parse_reconcile_schedule("reconcile:chart_docs@every=1h"))


# --------------------------------------------------------------------------- #
# Every tick reports
# --------------------------------------------------------------------------- #
class TestEveryTickReports:
    def test_an_idle_tick_still_produces_a_report(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        clock = _Clock()
        scheduler = _scheduler(clock)
        scheduler.tick()
        clock.advance(hours=1)

        report = scheduler.tick()
        assert report.outcomes == () and report.considered == 1
        assert "none due" in report.summary()
        assert scheduler.reports[-1] is report, "a tick nobody can see is a stopped scheduler"

    def test_a_submitting_tick_names_the_job_and_the_backend(self, monkeypatch):
        _install(monkeypatch, _graph_sweep())
        summary = _scheduler(_Clock()).tick().summary()
        assert "1 submitted" in summary and "job=job-1" in summary and "in-process" in summary

    def test_a_deferred_tick_names_the_reason_and_the_next_attempt(self, monkeypatch):
        _install(monkeypatch, None)
        summary = _scheduler(_Clock()).tick().summary()
        assert "1 deferred" in summary and "retry_at=" in summary
