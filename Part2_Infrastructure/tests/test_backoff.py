"""The shape four hand-rolled loops each wrote separately."""

from __future__ import annotations

import pytest

from modules.backoff import Backoff


class TestTheCurve:
    def test_healthy_waits_the_base_interval(self):
        assert Backoff(base_s=2.5, ceiling_s=30.0).delay_s == 2.5

    def test_it_doubles_per_consecutive_failure(self):
        b = Backoff(base_s=1.0, ceiling_s=64.0)
        assert [b.failed() for _ in range(4)] == [2.0, 4.0, 8.0, 16.0]

    def test_the_ceiling_holds(self):
        b = Backoff(base_s=1.0, ceiling_s=30.0)
        for _ in range(50):
            b.failed()
        assert b.delay_s == 30.0, "an uncapped curve reaches hours and the loop is dead in silence"

    def test_a_very_long_outage_does_not_overflow_before_the_clamp(self):
        b = Backoff(base_s=1.0, ceiling_s=30.0)
        b.failures = 5_000
        assert b.delay_s == 30.0


class TestRecovery:
    def test_success_restores_the_base_immediately(self):
        b = Backoff(base_s=1.0, ceiling_s=30.0)
        for _ in range(3):
            b.failed()
        assert b.delay_s > 1.0
        b.succeeded()
        assert b.delay_s == 1.0, "a recovered loop is still reporting an outage that has ended"


class TestExhaustion:
    def test_it_says_when_it_has_stopped_recovering(self):
        b = Backoff(base_s=1.0, ceiling_s=4.0)
        assert not b.exhausted
        for _ in range(2):
            b.failed()
        assert b.exhausted


class TestRefusals:
    @pytest.mark.parametrize(("base", "ceiling"), [(0.0, 10.0), (-1.0, 10.0), (10.0, 1.0)])
    def test_a_nonsense_configuration_is_refused_at_construction(self, base, ceiling):
        with pytest.raises(ValueError):
            Backoff(base_s=base, ceiling_s=ceiling)


class TestJobRetry:
    """Retry is opt-in per kind, and a retried job says how many attempts it took."""

    def test_a_retryable_kind_recovers_without_the_caller_knowing(self, monkeypatch):
        import modules.jobs as jobs

        monkeypatch.setattr(jobs, "RETRY_BASE_S", 0.001)
        monkeypatch.setattr(jobs, "RETRY_CEILING_S", 0.002)
        queue = jobs.JobQueue()
        attempts = {"n": 0}

        def flaky() -> str:
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise RuntimeError("provider hiccup")
            return "done"

        record = queue.submit("data.backfill", flaky)
        _wait(record)

        assert record.status == "succeeded"
        assert record.result == "done"
        assert record.attempt == 3, "the job did not retry"
        assert record.error is None, "a recovered job still reports the error it recovered from"

    def test_a_kind_that_is_not_opted_in_runs_once(self, monkeypatch):
        import modules.jobs as jobs

        monkeypatch.setattr(jobs, "RETRY_BASE_S", 0.001)
        queue = jobs.JobQueue()
        attempts = {"n": 0}

        def always_fails() -> None:
            attempts["n"] += 1
            raise RuntimeError("nope")

        # `backtest` is deliberately absent from RETRYABLE: it pushes a corpus
        # card and a Telegram message on completion, and repeating those is
        # visible to a reader.
        record = queue.submit("backtest", always_fails)
        _wait(record)

        assert record.status == "failed"
        assert record.attempt == 1, "a kind whose idempotence was never argued was retried"
        assert attempts["n"] == 1

    def test_exhausting_the_attempts_keeps_the_last_error(self, monkeypatch):
        import modules.jobs as jobs

        monkeypatch.setattr(jobs, "RETRY_BASE_S", 0.001)
        monkeypatch.setattr(jobs, "RETRY_CEILING_S", 0.002)
        queue = jobs.JobQueue()

        def always_fails() -> None:
            raise RuntimeError("gateway refused")

        record = queue.submit("data.replay", always_fails)
        _wait(record)

        assert record.status == "failed"
        assert record.attempt == 2, "data.replay is opted in for two attempts"
        assert "gateway refused" in (record.error or "")


def _wait(record, timeout: float = 5.0) -> None:
    import time as _time

    deadline = _time.monotonic() + timeout
    while record.status in ("queued", "running") and _time.monotonic() < deadline:
        _time.sleep(0.01)
