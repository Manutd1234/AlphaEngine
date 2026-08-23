"""Replay and backfill jobs, the bar contract's Python mirror, and the scheduler.

Network is mocked with an httpx MockTransport; persistence runs against
throwaway stores. The parity fixture is shared with the web suite so the two
bar contracts cannot drift apart.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from config import settings
from modules.data_jobs import (
    ScheduleRunStore,
    check_bars_rows,
    on_data_job_complete,
    run_backfill,
    run_replay,
)
from modules.data_scheduler import DataScheduler, parse_schedule
from modules.jobs import JobRecord

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "web" / "tests" / "fixtures" / "bars-contract-parity.json"
NOW = 1_700_000_000_000.0


@pytest.fixture
def setting():
    """Settings is a frozen dataclass; override a field for one test and put it back."""
    originals: list[tuple[str, object]] = []

    def _set(name: str, value: object) -> None:
        originals.append((name, getattr(settings, name)))
        object.__setattr__(settings, name, value)

    yield _set
    for name, value in reversed(originals):
        object.__setattr__(settings, name, value)


class TestBarContractParity:
    def test_the_python_mirror_agrees_with_the_shared_fixture(self):
        cases = json.loads(FIXTURE.read_text())["cases"]
        assert len(cases) >= 5
        for case in cases:
            rows = [tuple(bar) for bar in case["bars"]]
            result = check_bars_rows(rows, case["requested"])
            assert result["passed"] is case["passed"], case["name"]
            assert sorted(v["check"] for v in result["violations"]) == sorted(case["checks"]), case["name"]


def _transport(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestReplay:
    def test_a_clean_answer_yields_a_finding_for_the_ledger(self, setting):
        setting("web_workspace_url", "https://desk.test")

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/system/inspect"
            assert request.url.params["refresh"] == "1"
            assert request.url.params["capability"] == "quote"
            return httpx.Response(200, json={
                "ok": True, "symbol": "BTCUSDT", "capability": "quote",
                "cache": {"key": "quote:BTCUSDT:*", "state": "miss"},
                "provenance": {"provider": "binance", "latencyMs": 42, "contract": {"passed": True, "violations": [], "notEvaluated": []}},
                "attempts": [], "error": None,
            })

        out = run_replay({"symbol": "btcusdt", "capability": "quote"}, client=_transport(handler))
        assert out["outcome"] == "clean"
        assert out["provider"] == "binance"
        assert out["finding"]["provider"] == "binance" and out["finding"]["passed"] is True
        assert out["finding"]["symbol"] == "BTCUSDT"

    def test_the_four_other_outcomes(self, setting):
        setting("web_workspace_url", "https://desk.test")
        bodies = {
            "flagged": {"ok": True, "cache": {"key": "k"}, "provenance": {"provider": "fmp", "contract": {"passed": True, "violations": [{"check": "quote.freshness", "severity": "warn", "message": "old"}], "notEvaluated": []}}, "attempts": []},
            "rejected": {"ok": True, "cache": {"key": "k"}, "provenance": {"provider": "fmp", "contract": {"passed": False, "violations": [{"check": "quote.price_positive", "severity": "fatal", "message": "no price"}], "notEvaluated": []}}, "attempts": []},
            "unanswered": {"ok": False, "cache": {"key": "k"}, "provenance": None, "attempts": [{"provider": "fmp", "reason": "failed"}], "error": "no provider could serve quote"},
            "not_applicable": {"ok": False, "reason": "not_applicable", "cache": {"key": "k"}, "provenance": None, "attempts": [], "error": "Fundamentals describe an issuer"},
        }
        for expected, body in bodies.items():
            out = run_replay({"symbol": "AAPL", "capability": "quote"}, client=_transport(lambda _r, b=body: httpx.Response(200, json=b)))
            assert out["outcome"] == expected, expected
            if expected in ("unanswered", "not_applicable"):
                assert out["finding"] is None, "no contract, no finding"

    def test_unconfigured_executor_is_a_clear_error(self, setting):
        setting("web_workspace_url", "")
        setting("paper_equity_quote_url", "")
        with pytest.raises(RuntimeError, match="WEB_WORKSPACE_URL"):
            run_replay({"symbol": "AAPL", "capability": "quote"})


class TestBackfill:
    def test_crypto_pages_binance_forward_and_checks_the_series(self, setting):
        setting("binance_rest_url", "https://binance.test")
        hour = 3_600_000
        start = 1_700_000_000_000 - (1_700_000_000_000 % hour)   # an aligned kline boundary
        calls: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/v3/klines"
            cursor = int(request.url.params["startTime"])
            calls.append(cursor)
            limit = int(request.url.params["limit"])
            end = int(request.url.params["endTime"])
            rows = []
            # Klines are aligned to the interval, at or after startTime — the
            # vendor's behaviour, which the pager relies on to make progress.
            t = ((cursor + hour - 1) // hour) * hour
            while t <= end and len(rows) < min(limit, 3):   # three per page to force paging
                rows.append([t, "1", "2", "0.5", "1.5", "10", t + hour - 1, "0", 1, "0", "0", "0"])
                t += hour
            return httpx.Response(200, json=rows)

        params = {
            "symbol": "BTCUSDT", "interval": "1h",
            "from_at": datetime.fromtimestamp(start / 1000, tz=timezone.utc).isoformat(),
            "to_at": datetime.fromtimestamp((start + 7 * hour) / 1000, tz=timezone.utc).isoformat(),
        }
        progress: list[tuple[float, str]] = []
        out = run_backfill(params, progress=lambda pct, msg="": progress.append((pct, msg)), client=_transport(handler))
        assert out["source"] == "binance" and out["outcome"] == "clean"
        assert out["rows_fetched"] == 8 and len(out["rows"]) == 8
        # Paged forward by startTime — each cursor is the last open + 1 ms —
        # and it stops as soon as the cursor passes endTime, so a range that
        # ends on a kline boundary costs no extra request.
        assert calls == [start, start + 2 * hour + 1, start + 5 * hour + 1]
        assert out["first_ts"] == start and out["last_ts"] == start + 7 * hour
        assert out["finding"]["capability"] == "bars"
        assert progress and progress[-1][0] == 0.95

    def test_a_range_over_the_cap_is_refused(self, setting):
        setting("data_backfill_max_bars", 10)
        params = {"symbol": "BTCUSDT", "interval": "15m", "from_at": "2026-01-01T00:00:00Z", "to_at": "2026-01-02T00:00:00Z"}
        with pytest.raises(ValueError, match="cap"):
            run_backfill(params)

    def test_an_equity_goes_through_the_workspace_and_filters_to_the_range(self, setting):
        setting("web_workspace_url", "https://desk.test")
        hour = 3_600_000
        start = 1_700_000_000_000

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/ohlcv"
            assert request.url.params["symbol"] == "AAPL"
            bars = [{"t": start + i * hour, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for i in range(-2, 8)]
            return httpx.Response(200, json={"bars": bars, "provenance": {"provider": "massive"}})

        params = {
            "symbol": "AAPL", "interval": "1h",
            "from_at": datetime.fromtimestamp(start / 1000, tz=timezone.utc).isoformat(),
            "to_at": datetime.fromtimestamp((start + 5 * hour) / 1000, tz=timezone.utc).isoformat(),
        }
        out = run_backfill(params, client=_transport(handler))
        assert out["source"] == "web-registry" and out["provider"] == "massive"
        assert out["rows_fetched"] == 6, "two bars before the range were dropped, and the rest of the ten trimmed to the range"
        assert out["outcome"] == "clean"


class TestCompletionHook:
    def test_persists_the_finding_and_the_clean_bars_then_drops_the_rows(self, tmp_path, monkeypatch):
        from modules import audit as audit_module
        from modules import data_quality as dq
        from modules.audit import AuditLog
        from modules.data_quality import DataQualityLedger

        ledger = DataQualityLedger.in_memory()
        store = AuditLog(tmp_path / "hook.duckdb")
        monkeypatch.setattr(dq, "get_data_quality", lambda: ledger)
        monkeypatch.setattr(audit_module, "get_audit", lambda: store)
        try:
            hour = 3_600_000
            rows = [(1_700_000_000_000 + i * hour, 1.0, 2.0, 0.5, 1.5, 10.0) for i in range(6)]
            record = JobRecord(job_id="job1", kind="data.backfill", status="succeeded", result={
                "outcome": "clean", "symbol": "BTCUSDT", "interval": "1h", "rows": rows,
                "finding": {"capability": "bars", "provider": "binance", "symbol": "BTCUSDT", "key": "bars:BTCUSDT:1h:backfill", "passed": True, "violations": [], "not_evaluated": 0},
            })
            asyncio.run(on_data_job_complete(record))
            assert "rows" not in record.result, "rows are persisted, not retained in the job result"
            assert record.result["rows_written"] == 6
            assert record.result["persisted_at"]
            view = ledger.view()
            assert view.total.evaluated == 1
            assert view.recent[0].source == "backfill" and view.recent[0].instance == "gateway:job1"
            coverage = store.ohlcv_coverage("BTCUSDT", "1h")
            assert coverage["rows"] == 6
        finally:
            store.close()

    def test_a_rejected_backfill_records_the_finding_but_writes_no_bars(self, tmp_path, monkeypatch):
        from modules import audit as audit_module
        from modules import data_quality as dq
        from modules.audit import AuditLog
        from modules.data_quality import DataQualityLedger

        ledger = DataQualityLedger.in_memory()
        store = AuditLog(tmp_path / "hook2.duckdb")
        monkeypatch.setattr(dq, "get_data_quality", lambda: ledger)
        monkeypatch.setattr(audit_module, "get_audit", lambda: store)
        try:
            record = JobRecord(job_id="job2", kind="data.backfill", status="succeeded", result={
                "outcome": "rejected", "symbol": "BTCUSDT", "interval": "1h", "rows": [(1, 1, 2, 0.5, 1.5, 10), (1, 1, 2, 0.5, 1.5, 10)],
                "finding": {"capability": "bars", "provider": "binance", "symbol": "BTCUSDT", "key": "k", "passed": False,
                            "violations": [{"check": "bars.unique_timestamps", "severity": "fatal", "message": "dup"}], "not_evaluated": 0},
            })
            asyncio.run(on_data_job_complete(record))
            assert record.result["rows_written"] == 0
            assert ledger.view().recent[0].severity == "fatal"
            assert store.ohlcv_coverage("BTCUSDT", "1h")["rows"] == 0
        finally:
            store.close()

    def test_upsert_merges_by_range_instead_of_wiping(self, tmp_path):
        from modules.audit import AuditLog

        store = AuditLog(tmp_path / "merge.duckdb")
        try:
            day = timedelta(days=1)
            base = datetime(2026, 1, 1)
            deep = [(base + i * day, 1.0, 2.0, 0.5, 1.5, 10.0) for i in range(30)]
            store.upsert_ohlcv("ETHUSDT", "1d", deep)
            assert store.ohlcv_coverage("ETHUSDT", "1d")["rows"] == 30
            # A later live fetch of the newest 5 bars used to delete all 30.
            recent = [(base + i * day, 9.0, 9.0, 9.0, 9.0, 1.0) for i in range(25, 30)]
            store.cache_ohlcv("ETHUSDT", "1d", recent)
            assert store.ohlcv_coverage("ETHUSDT", "1d")["rows"] == 30
            newest = store.load_ohlcv("ETHUSDT", "1d", 1)[0]
            assert float(newest["close"]) == 9.0, "the range that was re-fetched is replaced"
        finally:
            store.close()


class TestScheduler:
    def test_grammar_valid_and_invalid_entries(self):
        ok = parse_schedule("replay:quote:BTCUSDT@every=1h")
        assert ok.valid and ok.kind == "replay" and ok.symbol == "BTCUSDT" and ok.every_ms == 3_600_000
        daily = parse_schedule("backfill:ETHUSDT:1h:2d@daily=03:30")
        assert daily.valid and daily.kind == "backfill" and daily.lookback_ms == 2 * 86_400_000 and daily.daily_hhmm == (3, 30)
        bad = parse_schedule("replay:quote:BTCUSDT@every=7m")
        assert not bad.valid and "every must be" in (bad.error or "")
        worse = parse_schedule("nonsense")
        assert not worse.valid and worse.error

    def test_due_and_restart_safety(self, tmp_path, monkeypatch):
        submitted: list[str] = []
        runs = ScheduleRunStore(str(tmp_path / "runs.sqlite"))
        sched = DataScheduler(["replay:quote:BTCUSDT@every=1h", "bad@nope"], store=runs)

        class _Rec:
            def __init__(self, job_id): self.job_id, self.status = job_id, "queued"

        monkeypatch.setattr("modules.data_jobs.submit_replay", lambda req, actor: (submitted.append(req.symbol), _Rec(f"j{len(submitted)}"))[1])
        first = sched.tick(NOW)
        assert first == ["j1"], "due immediately when never run"
        assert sched.tick(NOW + 60_000) == [], "not due again inside the hour"
        assert sched.tick(NOW + 3_600_000) == ["j2"]
        # A restart with the same store does not re-fire what already ran.
        again = DataScheduler(["replay:quote:BTCUSDT@every=1h", "bad@nope"], store=ScheduleRunStore(str(tmp_path / "runs.sqlite")))
        assert again.tick(NOW + 3_660_000) == []
        views = again.views(NOW + 3_660_000)
        assert [v.valid for v in views] == [True, False]
        assert views[0].last_job_id == "j2" and views[1].error


def _point_at(monkeypatch, path):
    """`settings` is a frozen dataclass; replace the object, not a field."""
    from dataclasses import replace

    import config

    monkeypatch.setattr(config, "settings", replace(config.settings, data_ops_db_path=path))


class TestScheduleOutcomes:
    """`last_outcome` records what the job did, not what it was when queued."""

    def test_a_failed_job_marks_its_schedule_failed(self, tmp_path, monkeypatch):
        from modules.data_jobs import ScheduleRunStore
        from modules.data_scheduler import _SCHEDULE_BY_JOB, record_schedule_outcome

        store = ScheduleRunStore(str(tmp_path / "runs.sqlite"))
        _point_at(monkeypatch, tmp_path / "runs.sqlite")

        store.record_run("replay:quote:BTCUSDT@every=15m", 1_000.0, "job-a", "queued")
        _SCHEDULE_BY_JOB["job-a"] = "replay:quote:BTCUSDT@every=15m"
        record_schedule_outcome("job-a", "failed")

        row = store.last_run("replay:quote:BTCUSDT@every=15m")
        assert row is not None
        assert row["last_outcome"] == "failed", (
            "a schedule whose job failed still reads as a clean run"
        )
        assert row["last_job_id"] == "job-a"

    def test_an_unknown_job_is_ignored_rather_than_guessed(self, tmp_path, monkeypatch):
        from modules.data_scheduler import record_schedule_outcome

        _point_at(monkeypatch, tmp_path / "runs.sqlite")
        # A job the scheduler did not submit — an operator replay, say. Writing
        # a row for it would attribute a manual action to a schedule.
        record_schedule_outcome("job-not-scheduled", "succeeded")


class TestATickIsolatesItsSchedules:
    def test_one_bad_schedule_does_not_stop_the_others(self, monkeypatch):
        from modules.data_scheduler import DataScheduler, parse_schedule

        scheduler = DataScheduler([
            "replay:quote:AAA@every=15m",
            "replay:quote:BBB@every=15m",
            "replay:quote:CCC@every=15m",
        ])
        due = [parse_schedule(s) for s in (
            "replay:quote:AAA@every=15m",
            "replay:quote:BBB@every=15m",
            "replay:quote:CCC@every=15m",
        )]
        monkeypatch.setattr(scheduler, "due", lambda now_ms=None: due)

        calls: list[str] = []

        def _submit(schedule, *, now_ms=None):
            calls.append(schedule.symbol or "")
            if schedule.symbol == "BBB":
                raise RuntimeError("this symbol is not routable")
            return f"job-{schedule.symbol}"

        monkeypatch.setattr(scheduler, "submit", _submit)

        submitted = scheduler.tick(now_ms=1_000.0)

        assert calls == ["AAA", "BBB", "CCC"], "the tick stopped at the failing schedule"
        assert submitted == ["job-AAA", "job-CCC"]


class TestJobHistorySurvivesARestart:
    """The audit `jobs` table was write-only until this.

    Tested without `TestClient`, deliberately. Using it as a context manager
    runs the lifespan, and shutdown CLOSES the shared audit handle — so once any
    test file in the session has done that, every later write is swallowed by
    `_exec` and every later read returns nothing. That is correct behaviour for
    an audit log that must never break the trade path, and it makes the app
    fixture unusable for asserting on audit contents. The two halves are
    asserted where they live instead.
    """

    def test_the_jobs_table_can_be_read_back(self, tmp_path):
        from datetime import datetime

        from modules.audit import AuditLog

        audit = AuditLog(str(tmp_path / "jobs.duckdb"))
        try:
            audit.record_job(
                "old", "data.backfill", "succeeded",
                datetime(2026, 8, 19, 9, 0), datetime(2026, 8, 19, 9, 1), "in-process", None,
            )
            audit.record_job(
                "new", "data.replay", "failed",
                datetime(2026, 8, 20, 9, 0), datetime(2026, 8, 20, 9, 1), "in-process", "provider refused",
            )
            audit.record_job(
                "other", "backtest", "succeeded",
                datetime(2026, 8, 20, 10, 0), datetime(2026, 8, 20, 10, 1), "in-process", None,
            )

            rows = audit.list_jobs(limit=10, kind_prefix="data.")
            assert [r["job_id"] for r in rows] == ["new", "old"], "not newest-first, or the prefix leaked"
            assert rows[0]["error"] == "provider refused"
            assert all(r["kind"].startswith("data.") for r in rows)

            assert len(audit.list_jobs(limit=10)) == 3, "the unfiltered read lost a row"
            assert len(audit.list_jobs(limit=1, kind_prefix="data.")) == 1, "limit ignored"
        finally:
            audit.close()

    @pytest.mark.asyncio
    async def test_the_route_tops_the_queue_up_and_says_it_did(self, monkeypatch):
        from modules.api import data as data_routes  # where the handler reads its singletons

        class _Audit:
            def list_jobs(self, limit=25, kind_prefix=None):
                return [{
                    "job_id": "restored-1", "kind": "data.backfill", "status": "succeeded",
                    "submitted_at": datetime(2026, 8, 19, 9, 0),
                    "finished_at": datetime(2026, 8, 19, 9, 1),
                    "backend": "in-process", "error": None,
                }]

        class _Queue:
            backend = "in-process"

            def list(self, limit, kind_prefix=None):
                return []

        monkeypatch.setattr(data_routes, "get_audit", lambda: _Audit())
        monkeypatch.setattr(data_routes, "get_queue", lambda: _Queue())

        body = await data_routes.data_jobs(limit=25, _actor="test")

        assert [job.job_id for job in body.jobs] == ["restored-1"]
        assert body.restored_from_audit == 1
        assert body.retained_in_process is False, (
            "the response claims it holds every job it is reporting, and it does not"
        )
        row = body.jobs[0]
        # `record_job` writes seven columns at terminal state and nothing else.
        # Inventing a progress figure or an empty summary would make a thin row
        # look like a complete one.
        assert row.summary is None
        assert row.params == {}

    @pytest.mark.asyncio
    async def test_a_live_job_wins_over_its_restored_row(self, monkeypatch):
        from modules.api import data as data_routes

        class _Audit:
            def list_jobs(self, limit=25, kind_prefix=None):
                return [{
                    "job_id": "dupe", "kind": "data.replay", "status": "succeeded",
                    "submitted_at": datetime(2026, 8, 19, 9, 0),
                    "finished_at": datetime(2026, 8, 19, 9, 1),
                    "backend": "in-process", "error": None,
                }]

        class _Record:
            job_id = "dupe"

        class _Queue:
            backend = "in-process"

            def list(self, limit, kind_prefix=None):
                return [_Record()]

        monkeypatch.setattr(data_routes, "get_audit", lambda: _Audit())
        monkeypatch.setattr(data_routes, "get_queue", lambda: _Queue())
        monkeypatch.setattr(data_routes, "job_view", lambda record: {
            "job_id": record.job_id, "kind": "data.replay", "status": "succeeded",
            "submitted_at": datetime(2026, 8, 19, 9, 0), "finished_at": None,
            "backend": "in-process", "error": None,
            "params": {"symbol": "BTCUSDT"}, "actor": "operator",
            "summary": {"outcome": "clean"},
        })

        body = await data_routes.data_jobs(limit=25, _actor="test")

        assert len(body.jobs) == 1, "the same job was listed twice"
        assert body.restored_from_audit == 0
        # The in-process record carries progress, params and the job's summary;
        # the restored row carries none of those. The richer one has to win.
        assert body.jobs[0].summary == {"outcome": "clean"}
        assert body.retained_in_process is True
