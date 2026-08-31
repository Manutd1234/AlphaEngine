"""Bounded blocking work and propagated gateway deadlines.

The FastAPI handlers are asynchronous, while DuckDB, SQLite and the optional
PostgREST data-ops client are synchronous.  These tests hold the seam: blocking
work must leave the event-loop thread, the queue must have a real ceiling, and
a caller's remaining budget must end the wait without pretending a running
thread can be killed safely.
"""

from __future__ import annotations

import asyncio
import threading
import time
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.backend_runtime import (
    BackendDeadlineExceeded,
    BackendRuntime,
    BackendSaturated,
    bind_request_budget,
)
from modules.request_budget import RequestBudgetMiddleware


def _until(predicate, *, timeout_s: float = 1.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.005)
    assert predicate(), "condition did not become true before the test deadline"


async def test_blocking_work_leaves_the_event_loop_thread_and_keeps_it_responsive():
    runtime = BackendRuntime(max_workers=1, max_queued=1, lag_interval_s=0.01)
    runtime.start()
    event_loop_thread = threading.get_ident()
    heartbeat = asyncio.Event()

    async def beat() -> None:
        await asyncio.sleep(0.01)
        heartbeat.set()

    task = asyncio.create_task(beat())
    try:
        worker_thread = await runtime.run("test.thread", lambda: (time.sleep(0.04), threading.get_ident())[1])
        await task
        assert worker_thread != event_loop_thread
        assert heartbeat.is_set(), "the synchronous call blocked the event loop"
        assert runtime.status()["operations"]["test.thread"]["completed"] == 1
    finally:
        await runtime.stop()


def test_idle_runtime_rebinds_after_its_previous_event_loop_closes():
    """Sequential ASGI/test loops may reuse the pool, never its loop primitives."""
    runtime = BackendRuntime(max_workers=1, max_queued=1, lag_interval_s=0.01)

    async def read(value: str) -> str:
        return await runtime.run("test.rebind", lambda: value)

    try:
        assert asyncio.run(read("first")) == "first"
        assert asyncio.run(read("second")) == "second"
        assert runtime.status()["operations"]["test.rebind"]["completed"] == 2
    finally:
        asyncio.run(runtime.stop())


async def test_queue_saturation_is_bounded_and_a_cancelled_queued_job_never_starts():
    runtime = BackendRuntime(max_workers=1, max_queued=1, lag_interval_s=0.01)
    runtime.start()
    first_started = threading.Event()
    release_first = threading.Event()
    queued_started = threading.Event()

    def first() -> str:
        first_started.set()
        release_first.wait(timeout=2)
        return "first"

    def queued() -> str:
        queued_started.set()
        return "queued"

    first_task = asyncio.create_task(runtime.run("test.first", first))
    await asyncio.to_thread(first_started.wait, 1)
    queued_task = asyncio.create_task(runtime.run("test.queued", queued))
    await asyncio.to_thread(_until, lambda: runtime.status()["queue_depth"] == 1)

    try:
        with pytest.raises(BackendSaturated):
            await runtime.run("test.refused", lambda: None, admission_timeout_s=0.02)

        queued_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await queued_task
        assert not queued_started.is_set(), "a cancelled queued read still reached the store"
        assert runtime.status()["saturated_total"] == 1
        assert runtime.status()["cancelled_total"] == 1
    finally:
        release_first.set()
        assert await first_task == "first"
        await runtime.stop()


async def test_request_deadline_bounds_the_wait_and_records_that_the_thread_is_draining():
    runtime = BackendRuntime(max_workers=1, max_queued=1, lag_interval_s=0.01)
    runtime.start()
    started = time.perf_counter()
    try:
        with bind_request_budget("req-deadline-123", "H1", remaining_ms=25):
            with pytest.raises(BackendDeadlineExceeded):
                await runtime.run("test.slow", lambda: time.sleep(0.12))
        assert time.perf_counter() - started < 0.1
        status = runtime.status()
        assert status["deadline_total"] == 1
        assert status["running"] == 1, "a Python thread was reported killed when it was only detached"
    finally:
        await runtime.stop()


async def test_queue_admission_time_is_deducted_before_the_worker_budget_starts():
    runtime = BackendRuntime(max_workers=1, max_queued=0, lag_interval_s=0.01)
    runtime.start()
    release = threading.Event()
    first = asyncio.create_task(runtime.run("test.holder", lambda: release.wait(timeout=1)))
    await asyncio.sleep(0)
    threading.Timer(0.02, release.set).start()
    started = time.perf_counter()
    try:
        with bind_request_budget("req-admission-123", "H1", remaining_ms=35):
            with pytest.raises(BackendDeadlineExceeded):
                await runtime.run(
                    "test.after-admission", lambda: time.sleep(0.03),
                    admission_timeout_s=0.1,
                )
        assert time.perf_counter() - started < 0.05, (
            "queue time was not subtracted before the worker wait began"
        )
    finally:
        release.set()
        await first
        await runtime.stop()


def test_middleware_returns_a_typed_504_with_the_same_request_context():
    runtime = BackendRuntime(max_workers=1, max_queued=1, lag_interval_s=0.01)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        runtime.start()
        try:
            yield
        finally:
            await runtime.stop()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(RequestBudgetMiddleware)

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        await runtime.run("test.http", lambda: time.sleep(0.1))
        return {"ok": True}

    started = time.perf_counter()
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(
            "/slow",
            headers={
                "X-AlphaEngine-Request-Id": "req-http-123456",
                "X-AlphaEngine-Budget-Class": "H1",
                "X-AlphaEngine-Remaining-Budget-Ms": "20",
            },
        )
    assert time.perf_counter() - started < 0.5
    assert response.status_code == 504
    payload = response.json()
    assert payload["code"] == "backend_deadline_exceeded"
    assert payload["error"] == "The gateway exhausted the propagated request budget."
    assert payload["requestId"] == "req-http-123456"
    assert payload["traceId"] == "req-http-123456"
    assert payload["endpointClass"] == "H1"
    assert payload["boundary"] == "test.http"
    assert payload["dependency"] == "backend_worker_pool"
    assert payload["retryable"] is True
    assert payload["budget"]["class"] == "H1"
    assert response.headers["X-AlphaEngine-Request-Id"] == "req-http-123456"
    assert response.headers["X-AlphaEngine-Budget-Class"] == "H1"
    assert "backend;dur=" in response.headers["server-timing"]


async def test_diffusion_store_reads_run_off_the_event_loop(monkeypatch):
    from modules.api import diffusion as api
    from modules.backend_runtime import get_backend_runtime

    threads: list[int] = []

    class Store:
        backend = "sqlite"

        def list_events(self, **_kwargs):
            threads.append(threading.get_ident())
            return [], False

    monkeypatch.setattr(api, "_store", Store)
    try:
        response = await api.diffusion_events(kind=None, symbol=None, limit=20, _actor="test")
        assert response.state == "ok"
        assert threads and threads[0] != threading.get_ident()
    finally:
        await get_backend_runtime().stop()


async def test_diffusion_findings_preserves_typed_deadline_failures(monkeypatch):
    from modules.api import diffusion as api
    from modules.backend_runtime import get_backend_runtime

    monkeypatch.setattr(api, "collect_findings", lambda: time.sleep(0.08))
    try:
        with bind_request_budget("req-findings-123", "H1", remaining_ms=20):
            with pytest.raises(BackendDeadlineExceeded):
                await api.diffusion_findings(_actor="test")
    finally:
        await get_backend_runtime().stop()


async def test_diffusion_findings_preserves_typed_saturation(monkeypatch):
    from modules.api import diffusion as api

    async def saturated(*_args, **_kwargs):
        raise BackendSaturated("diffusion.findings")

    monkeypatch.setattr(api, "run_blocking", saturated)
    with pytest.raises(BackendSaturated):
        await api.diffusion_findings(_actor="test")


async def test_diffusion_stage_write_has_a_server_ceiling(monkeypatch):
    from datetime import datetime, timezone

    from modules.api import diffusion as api
    from modules.backend_runtime import get_backend_runtime
    from modules.schemas import DiffusionStageRecord

    class Store:
        def record_stage(self, *_args, **_kwargs):
            time.sleep(0.08)
            return None

    monkeypatch.setattr(api, "_store", Store)
    monkeypatch.setattr(api, "_STAGE_WRITE_TIMEOUT_S", 0.02)
    body = DiffusionStageRecord(at=datetime.now(timezone.utc))
    try:
        with pytest.raises(BackendDeadlineExceeded):
            await api.diffusion_record_stage("event:1", body, _actor="test")
    finally:
        await get_backend_runtime().stop()


def test_native_self_measure_failure_marks_startup_unready():
    from main import _measure_decision_core_readiness

    class Gateway:
        def run_core_self_measure(self):
            return 0

        def decision_core_status(self):
            return {"selected": "native"}

    reasons: list[str] = []
    runtime = type("Runtime", (), {"mark_unready": reasons.append})()

    assert _measure_decision_core_readiness(Gateway(), runtime) == 0
    assert reasons == ["native decision core self-measure failed"]


def test_python_self_measure_without_samples_remains_valid():
    from main import _measure_decision_core_readiness

    class Gateway:
        def run_core_self_measure(self):
            return 0

        def decision_core_status(self):
            return {"selected": "python"}

    reasons: list[str] = []
    runtime = type("Runtime", (), {"mark_unready": reasons.append})()

    assert _measure_decision_core_readiness(Gateway(), runtime) == 0
    assert reasons == []


def test_process_audit_reopens_without_changing_its_stable_health_shape(tmp_path):
    from modules.audit import AuditLog

    audit = AuditLog(tmp_path / "reopen.duckdb")
    try:
        assert audit.health() == {"backend": audit.backend, "available": True}
        audit.close()
        assert audit.runtime_health()["writable"] is False
        audit.reopen()
        assert audit.health() == {"backend": audit.backend, "available": True}
        assert audit.query("SELECT 1 AS value") == [{"value": 1}]
    finally:
        audit.close()


def test_audit_runtime_health_latches_a_write_failure(tmp_path):
    from modules.audit import AuditLog

    audit = AuditLog(tmp_path / "failure.duckdb")
    try:
        audit._exec("this is not valid SQL")
        failed = audit.runtime_health()
        assert failed["writable"] is False
        assert failed["write_failures"] == 1
        assert failed["last_write_error"]
        audit._exec("CREATE TABLE IF NOT EXISTS runtime_probe(value INTEGER)")
        assert audit.runtime_health()["writable"] is True
    finally:
        audit.close()


def test_job_pool_accepts_work_after_an_asgi_shutdown():
    from modules.jobs import JobQueue

    queue = JobQueue(workers=1)
    queue._persist = lambda _record: None
    queue.shutdown()
    try:
        record = queue.submit("test.restart", lambda: "ready")
        _until(lambda: record.status in {"succeeded", "failed"})
        assert record.status == "succeeded"
        assert record.result == "ready"
    finally:
        queue.shutdown()


def test_sqlite_schema_bundle_is_only_executed_once():
    from modules.data_ops_store import SqliteStore

    store = SqliteStore(":memory:")
    statements: list[str] = []
    store._conn.set_trace_callback(statements.append)
    ddl = ["CREATE TABLE IF NOT EXISTS startup_probe(value INTEGER)"]
    try:
        store.migrate(ddl)
        store.migrate(ddl)
        assert sum("CREATE TABLE" in statement for statement in statements) == 1
    finally:
        store.close()


def test_runtime_metrics_publish_unit_labelled_queue_and_writer_state():
    from modules.metrics.exposition import _Writer
    from modules.metrics.runtime import render_runtime_metrics

    out = _Writer()
    render_runtime_metrics(out)
    body = out.render()
    assert "alphaengine_backend_read_queue_depth" in body
    assert "alphaengine_backend_read_duration_ms" in body
    assert "alphaengine_audit_writable" in body
    assert "alphaengine_single_writer_enforced" in body
