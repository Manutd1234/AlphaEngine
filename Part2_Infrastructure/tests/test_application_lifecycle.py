"""Failure-path contracts for the process-owned FastAPI lifecycle."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI

from modules import application_lifecycle as lifecycle


class _Runtime:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def start(self) -> None:
        self.events.append("runtime.start")

    async def stop(self) -> None:
        self.events.append("runtime.stop")

    def mark_starting(self) -> None:
        self.events.append("runtime.starting")

    def mark_ready(self, _detail) -> None:
        self.events.append("runtime.ready")

    def mark_unready(self, _reason) -> None:
        self.events.append("runtime.unready")

    async def run(self, _label, callback, **_kwargs):
        return callback()

    def status(self) -> dict:
        return {"ready": True}


class _Resource:
    def __init__(
        self, label: str, events: list[str], *, fail_start: bool = False,
        fail_stop: bool = False, hang_start: bool = False,
    ) -> None:
        self.label = label
        self.events = events
        self.fail_start = fail_start
        self.fail_stop = fail_stop
        self.hang_start = hang_start
        self.mode = "disabled"

    async def start(self) -> None:
        self.events.append(f"{self.label}.start")
        if self.fail_start:
            raise RuntimeError(f"{self.label} start failed")
        if self.hang_start:
            await asyncio.Event().wait()

    async def stop(self) -> None:
        self.events.append(f"{self.label}.stop")
        if self.fail_stop:
            raise RuntimeError(f"{self.label} stop failed")

    def add_alert_hook(self, _hook) -> None:
        return None

    def add_decision_hook(self, _hook) -> None:
        return None

    def run_core_self_measure(self) -> int:
        return 1

    def decision_core_status(self) -> dict:
        return {"selected": "python"}

    def broadcast(self, *_args, **_kwargs) -> None:
        return None

    def push_backtest_result(self, *_args, **_kwargs) -> None:
        return None

    def enqueue(self, *_args, **_kwargs) -> None:
        return None

    def on_decision(self, *_args, **_kwargs) -> None:
        return None

    def on_backtest_complete(self, *_args, **_kwargs) -> None:
        return None


class _Scheduler:
    def __init__(self, label: str, events: list[str], *, fail_stop: bool = False) -> None:
        self.label, self.events, self.fail_stop = label, events, fail_stop

    def start(self) -> None:
        self.events.append(f"{self.label}.start")

    async def stop(self) -> None:
        self.events.append(f"{self.label}.stop")
        if self.fail_stop:
            raise RuntimeError(f"{self.label} stop failed")


class _Audit:
    backend = "test"
    db_path = Path("test.duckdb")

    def __init__(self, events: list[str]) -> None:
        self.events = events

    def reopen(self) -> None:
        self.events.append("audit.reopen")

    def close(self) -> None:
        self.events.append("audit.close")

    def record_risk_event(self, event: str, **_kwargs) -> None:
        self.events.append(f"audit.{event}")

    def runtime_health(self) -> dict:
        return {"writable": True}


class _Queue:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    def on_complete(self, _hook) -> None:
        return None

    def stats(self) -> dict:
        return {"backend": "test"}

    def shutdown(self) -> None:
        self.events.append("queue.shutdown")


def _wire(
    monkeypatch, events: list[str], *, fail_start: str | None = None,
    fail_stops: set[str] = frozenset(), hang_start: str | None = None,
) -> None:
    runtime, audit, queue = _Runtime(events), _Audit(events), _Queue(events)
    resources = {
        name: _Resource(
            name, events, fail_start=name == fail_start, fail_stop=name in fail_stops,
            hang_start=name == hang_start,
        )
        for name in ("tca", "gateway", "bot", "mirror", "rag", "ml")
    }
    schedulers = {
        name: _Scheduler(name, events, fail_stop=name in fail_stops)
        for name in ("scheduler", "research_scheduler")
    }
    monkeypatch.setattr(lifecycle, "claim_single_writer", lambda: events.append("writer.claim"))
    monkeypatch.setattr(lifecycle, "release_single_writer", lambda: events.append("writer.release"))
    monkeypatch.setattr(lifecycle, "get_backend_runtime", lambda: runtime)
    monkeypatch.setattr(
        lifecycle, "_prepare_backend_read_models",
        lambda: events.append("read_models.prepare") or {"state": "ready"},
    )
    monkeypatch.setattr(lifecycle, "reset_data_ops_store", lambda: events.append("data_ops.reset"))
    monkeypatch.setattr(
        lifecycle, "reset_coherence_store", lambda: events.append("coherence.reset"),
    )
    monkeypatch.setattr(lifecycle, "get_audit", lambda: audit)
    monkeypatch.setattr(lifecycle, "get_engine", lambda: resources["tca"])
    monkeypatch.setattr(lifecycle, "get_gateway", lambda: resources["gateway"])
    monkeypatch.setattr(lifecycle, "get_queue", lambda: queue)
    monkeypatch.setattr(lifecycle, "get_bot", lambda: resources["bot"])
    monkeypatch.setattr(lifecycle, "get_mirror", lambda: resources["mirror"])
    monkeypatch.setattr(lifecycle, "get_rag", lambda: resources["rag"])
    monkeypatch.setattr(lifecycle, "get_scheduler", lambda: schedulers["scheduler"])
    monkeypatch.setattr(
        lifecycle, "get_research_scheduler", lambda: schedulers["research_scheduler"],
    )
    monkeypatch.setattr(lifecycle, "get_ml_store", lambda: resources["ml"])
    monkeypatch.setattr(
        lifecycle, "_measure_decision_core_readiness", lambda *_args: events.append("core.measure"),
    )

    async def idle() -> None:
        await asyncio.Event().wait()

    async def close_pool() -> None:
        events.append("kalshi.close")

    monkeypatch.setattr(lifecycle, "resolve_loop", idle)
    monkeypatch.setattr(lifecycle, "coherence_recorder_loop", idle)
    monkeypatch.setattr(lifecycle, "coherence_warm_loop", idle)
    monkeypatch.setattr(lifecycle, "close_kalshi_pool", close_pool)


@pytest.mark.asyncio
async def test_optional_telegram_failure_does_not_block_gateway_readiness(monkeypatch):
    events: list[str] = []
    _wire(monkeypatch, events, fail_start="bot")
    app = FastAPI()

    async with lifecycle.lifespan(app):
        assert hasattr(app.state, "application_context")
        assert "mirror.start" in events and "rag.start" in events

    assert events.index("writer.claim") < events.index("read_models.prepare")
    assert events.index("writer.claim") < events.index("audit.reopen")
    assert events.index("audit.reopen") < events.index("tca.start")
    cleanup = [
        event for event in events
        if event.endswith(".stop") or event.endswith(".shutdown") or event.endswith(".close")
        or event.endswith(".reset") or event == "writer.release"
    ]
    assert cleanup == [
        "kalshi.close", "ml.stop", "research_scheduler.stop", "scheduler.stop",
        "rag.stop", "mirror.stop",
        "bot.stop", "gateway.stop", "tca.stop", "queue.shutdown", "audit.close",
        "coherence.reset", "data_ops.reset", "runtime.stop", "writer.release",
    ]
    assert not hasattr(app.state, "application_context")


@pytest.mark.asyncio
async def test_hanging_telegram_start_is_bounded_and_cleaned_once(monkeypatch):
    events: list[str] = []
    _wire(monkeypatch, events, hang_start="bot")
    monkeypatch.setattr(lifecycle, "TELEGRAM_STARTUP_TIMEOUT_S", 0.01)
    app = FastAPI()

    async with asyncio.timeout(0.25):
        async with lifecycle.lifespan(app):
            assert hasattr(app.state, "application_context")
            assert "mirror.start" in events and "rag.start" in events

    assert events.count("bot.start") == 1
    assert events.count("bot.stop") == 1


@pytest.mark.asyncio
async def test_critical_gateway_start_failure_still_aborts_startup(monkeypatch):
    events: list[str] = []
    _wire(monkeypatch, events, fail_start="gateway")
    app = FastAPI()

    with pytest.raises(RuntimeError, match="gateway start failed"):
        async with lifecycle.lifespan(app):
            pytest.fail("a failed risk gateway must never serve requests")

    assert "bot.start" not in events
    assert events.count("gateway.stop") == 1
    assert events.count("tca.stop") == 1


@pytest.mark.asyncio
async def test_cleanup_failure_does_not_skip_later_stops_and_keeps_dependency_order(monkeypatch):
    events: list[str] = []
    _wire(monkeypatch, events, fail_stops={"research_scheduler", "gateway"})
    app = FastAPI()

    async with lifecycle.lifespan(app):
        assert hasattr(app.state, "application_context")
        await asyncio.sleep(0)

    assert events.index("audit.gateway_stop") < events.index("ml.stop")
    assert events.index("research_scheduler.stop") < events.index("scheduler.stop")
    assert events.index("rag.stop") < events.index("mirror.stop") < events.index("bot.stop")
    assert events.index("bot.stop") < events.index("gateway.stop") < events.index("tca.stop")
    # Both stops above raised.  The process-level owners still all release.
    assert events.index("gateway.stop") < events.index("queue.shutdown")
    assert events.index("queue.shutdown") < events.index("audit.close") < events.index("runtime.stop")
    assert events[-1] == "writer.release"
    assert not hasattr(app.state, "application_context")
