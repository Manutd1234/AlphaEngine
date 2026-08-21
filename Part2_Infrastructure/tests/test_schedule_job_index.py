"""The scheduler's in-flight job index: the leak, and the isolation.

``job id -> schedule id`` was a bare module dict. Its only eviction was the
``pop`` in ``record_schedule_outcome``, and that completion is not guaranteed:
``JobQueue._schedule_complete`` closes the hook coroutine outright when the
event loop has gone (shutdown, a synchronous script, a test whose loop has
closed), and ``_submit_celery`` returns without polling when there is no loop.
Every job that took one of those routes left an entry behind for the life of
the process. Nothing could measure that, bound it, or clear it, and no test
could express it, because there was no object to make an assertion about.

The isolation half is the same defect from the other side. Two tests in one
process shared one map with no reset between them — ``tests/test_data_jobs.py``
still reaches into it by name to arrange a case, and nothing ever cleaned up
after that arrangement.

The identity assertion at the end runs the other way. ``_SCHEDULE_BY_JOB`` is
bound to the index's own dict BY OBJECT, so an index that reassigned on reset
instead of clearing would leave that name pointed at a dict the scheduler no
longer writes to — and nothing would report the divergence.
"""

from __future__ import annotations

from modules import data_scheduler as ds
from modules.data_scheduler import DataScheduler, ScheduleJobIndex, parse_schedule


class _Record:
    """The two fields `DataScheduler.submit` reads off a JobRecord."""

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.status = "queued"


class _Runs:
    """A ScheduleRunStore that remembers rather than persists."""

    def __init__(self) -> None:
        self.rows: list[tuple] = []

    def record_run(self, schedule_id, at_ms, job_id, status) -> None:
        self.rows.append((schedule_id, at_ms, job_id, status))

    def last_run(self, _schedule_id):
        return None


class TestTheIndexItself:
    def test_a_remembered_job_is_taken_exactly_once(self):
        index = ScheduleJobIndex()
        index.remember("job-a", "replay:quote:BTCUSDT@every=15m")
        assert index.take("job-a") == "replay:quote:BTCUSDT@every=15m"
        assert index.take("job-a") is None, "a completion must not be recorded twice"

    def test_an_unknown_job_is_none_rather_than_a_guess(self):
        """An operator's manual replay is not a schedule firing.

        Null is not coerced into a nearest match here: attributing a hand-run
        job to some schedule would put a `last_outcome` against a schedule that
        never fired, which is worse than the absence it replaces.
        """
        assert ScheduleJobIndex().take("job-nobody-scheduled") is None

    def test_the_oldest_entry_goes_first_when_the_ceiling_is_reached(self):
        """The oldest is precisely the one whose completion is never coming."""
        index = ScheduleJobIndex(capacity=3)
        for n in range(4):
            index.remember(f"job-{n}", f"schedule-{n}")
        assert len(index) == 3, "the index must not grow without limit"
        assert index.take("job-0") is None, "the oldest entry was dropped"
        assert index.take("job-3") == "schedule-3", "the newest is still there"

    def test_a_never_completing_stream_of_jobs_stays_bounded(self):
        # The shape of the leak: submissions arrive, completions never do.
        index = ScheduleJobIndex(capacity=8)
        for n in range(500):
            index.remember(f"job-{n}", "replay:quote:BTCUSDT@every=15m")
        assert len(index) == 8

    def test_reset_clears_in_place_and_never_rebinds(self):
        """Anything holding this dict by object must keep seeing live entries."""
        index = ScheduleJobIndex()
        held = index.by_job
        index.remember("job-a", "schedule-a")
        index.reset()
        assert index.by_job is held, "reset must clear, not reassign"
        assert held == {}


class TestTwoSchedulersInOneProcess:
    def test_a_scheduler_given_its_own_index_leaves_the_process_one_alone(self, monkeypatch):
        """An EMPTY index is falsy, so this also pins `is not None` over `or`.

        Written with `or`, the injection was silently discarded for every index
        that had not been used yet — which is every index a test hands over —
        and the submission went into the process-wide map after all.
        """
        monkeypatch.setattr(
            "modules.data_jobs.submit_replay",
            lambda _req, *, actor: _Record("job-isolated"),
            raising=False,
        )
        mine = ScheduleJobIndex()
        scheduler = DataScheduler(["replay:quote:BTCUSDT@every=15m"], store=_Runs(), job_index=mine)

        before = dict(ds._SCHEDULE_BY_JOB)
        schedule = parse_schedule("replay:quote:BTCUSDT@every=15m")
        assert scheduler.submit(schedule, now_ms=1_000.0) == "job-isolated"

        assert mine.take("job-isolated") == schedule.id
        assert dict(ds._SCHEDULE_BY_JOB) == before, (
            "a test's scheduler must not write into the process-wide index"
        )

    def test_two_indexes_do_not_see_each_others_jobs(self):
        first, second = ScheduleJobIndex(), ScheduleJobIndex()
        first.remember("job-a", "schedule-a")
        assert second.take("job-a") is None
        assert len(second) == 0


class TestOutcomeRecordingTakesAnIndex:
    def test_the_injected_index_is_the_one_consulted(self, monkeypatch):
        mine = ScheduleJobIndex()
        mine.remember("job-a", "replay:quote:BTCUSDT@every=15m")
        runs = _Runs()

        # Stand in for the module's deferred `ScheduleRunStore(get_data_ops_store())`
        # so this stays a test of the index, not of the SQLite backend.
        monkeypatch.setattr(
            "modules.data_jobs.ScheduleRunStore", lambda _store: runs, raising=False
        )
        monkeypatch.setattr(
            "modules.data_ops_backend.get_data_ops_store", lambda: object(), raising=False
        )

        ds.record_schedule_outcome("job-a", "failed", index=mine)
        assert runs.rows and runs.rows[0][0] == "replay:quote:BTCUSDT@every=15m"
        assert runs.rows[0][3] == "failed", (
            "a schedule whose job failed must not read as a clean run"
        )
        assert len(mine) == 0, "a recorded outcome releases its entry"

    def test_an_unknown_job_writes_no_row_at_all(self, monkeypatch):
        runs = _Runs()
        monkeypatch.setattr(
            "modules.data_jobs.ScheduleRunStore", lambda _store: runs, raising=False
        )
        ds.record_schedule_outcome("job-nobody-scheduled", "succeeded", index=ScheduleJobIndex())
        assert runs.rows == []


def test_the_module_level_dict_is_the_process_indexs_own():
    # The by-object binding. If these ever stop being the same dict, anything
    # reading `_SCHEDULE_BY_JOB` goes stale in silence.
    assert ds._SCHEDULE_BY_JOB is ds._job_index.by_job
