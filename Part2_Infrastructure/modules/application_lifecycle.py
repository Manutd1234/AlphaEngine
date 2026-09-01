"""FastAPI process lifecycle with failure-safe resource ownership.

Every cleanup is registered before its matching start call.  That matters for
resources whose ``start`` method can create more than one task: if the second
creation fails, the first still belongs to this lifespan and must be stopped.
``AsyncExitStack`` runs the registered callbacks in reverse dependency order;
the small error boundary around each callback ensures one broken stop cannot
strand everything registered before it.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import logging
from collections.abc import Callable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI

from config import settings
from modules.application_context import ApplicationContext, ApplicationMetadata, HealthService
from modules.application_services import ExecutionGatewayService, MarketDataProvider, RiskEngineManager
from modules.audit import get_audit
from modules.backend_runtime import get_backend_runtime
from modules.backtester import VECTORBT_AVAILABLE
from modules.coherence.drivers.kalshi_rest import close_pool as close_kalshi_pool
from modules.coherence.fs.store import reset_store as reset_coherence_store
from modules.coherence.recorder import recorder_loop as coherence_recorder_loop
from modules.coherence.warm import warm_loop as coherence_warm_loop
from modules.data_jobs import on_data_job_complete
from modules.data_ops_backend import reset_data_ops_store
from modules.data_quality import resolve_loop
from modules.data_scheduler import get_scheduler
from modules.jobs import get_queue
from modules.latest_state_stream import LatestStateFeed
from modules.ml.store import get_ml_store
from modules.research_rag import get_rag
from modules.research_schedule import get_research_scheduler
from modules.risk_proxy import get_gateway
from modules.single_writer import claim as claim_single_writer
from modules.single_writer import release as release_single_writer
from modules.single_writer import status as single_writer_status
from modules.supabase_mirror import get_mirror
from modules.tca_engine import get_engine
from modules.telegram import get_bot

log = logging.getLogger("alphaengine")
TELEGRAM_STARTUP_TIMEOUT_S = 10.0


async def _run_cleanup(label: str, callback: Callable[[], Any]) -> None:
    """Run one cleanup without letting its failure skip later callbacks."""
    try:
        result = callback()
        if inspect.isawaitable(result):
            await result
    except Exception:
        log.exception("shutdown cleanup failed: %s", label)


def _register_cleanup(
    stack: AsyncExitStack, label: str, callback: Callable[[], Any],
) -> None:
    stack.push_async_callback(_run_cleanup, label, callback)


async def _cancel_task(task: asyncio.Task[Any]) -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


async def _start_optional_telegram(bot: Any) -> None:
    """Keep optional Telegram I/O inside the container readiness window."""
    try:
        async with asyncio.timeout(TELEGRAM_STARTUP_TIMEOUT_S):
            await bot.start()
    except TimeoutError:
        bot.last_error = "startup: timed out"
        bot.last_error_kind = "startup"
        log.error(
            "telegram startup exceeded %.1fs; gateway startup will continue",
            TELEGRAM_STARTUP_TIMEOUT_S,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # Do not log the exception text: a transport exception can include the
        # bot-token URL. The health shape and log retain only a safe class.
        kind = type(exc).__name__
        bot.last_error = f"startup: {kind}"
        bot.last_error_kind = "startup"
        log.error("telegram startup failed (%s); gateway startup will continue", kind)


def _clear_application_context(app: FastAPI) -> None:
    with contextlib.suppress(AttributeError):
        del app.state.application_context


def _prepare_backend_read_models() -> dict[str, Any]:
    """Apply schemas and verified evidence before a browser poll can race them."""
    from modules.coherence.diffusion.bootstrap import restore_verified_fomc
    from modules.coherence.diffusion.events import DiffusionEventStore
    from modules.coherence.diffusion.runs import AbsorptionRunStore
    from modules.coherence.diffusion.studies import DiffusionStudyStore
    from modules.coherence.diffusion.texts import DiffusionTextStore
    from modules.coherence.fs.store import get_store
    from modules.data_ops_backend import get_data_ops_store

    data_ops = get_data_ops_store()
    stores = (DiffusionEventStore, AbsorptionRunStore, DiffusionTextStore, DiffusionStudyStore)
    for store_type in stores:
        store_type(data_ops)
    bootstrap = restore_verified_fomc(data_ops)
    tape = get_store().health()
    if tape.get("state") != "ok":
        raise RuntimeError(str(tape.get("reason") or "coherence tape is not readable"))
    return {
        "data_ops_backend": data_ops.backend,
        "coherence_tape": tape.get("state"),
        "diffusion_bootstrap": bootstrap.as_dict(),
    }


def _measure_decision_core_readiness(gateway: Any, backend_runtime: Any) -> int:
    """Seed native timing, refusing readiness when the selected core cannot run."""
    samples = gateway.run_core_self_measure()
    if gateway.decision_core_status()["selected"] == "native" and samples == 0:
        backend_runtime.mark_unready("native decision core self-measure failed")
    return samples


@dataclass(slots=True)
class _OwnedResources:
    runtime: Any
    audit: Any
    tca: Any
    gateway: Any
    queue: Any
    bot: Any
    mirror: Any
    rag: Any


async def _open_state(cleanup: AsyncExitStack) -> tuple[Any, Any]:
    """Claim the process, then open the runtime and mutable read models."""
    # RiskGateway.start keeps its defensive claim for direct callers.  This
    # earlier claim is idempotent and gives the entire startup one owner.
    claim_single_writer()
    _register_cleanup(cleanup, "single-writer release", release_single_writer)
    runtime = get_backend_runtime()
    _register_cleanup(cleanup, "backend runtime", runtime.stop)
    runtime.start()
    runtime.mark_starting()
    # Preparation may open either store before failing, so register both first.
    _register_cleanup(cleanup, "data-ops store", reset_data_ops_store)
    _register_cleanup(cleanup, "coherence store", reset_coherence_store)
    try:
        prepared = await runtime.run(
            "startup.read_models", _prepare_backend_read_models,
            timeout_s=5.0, honour_request_deadline=False, dependency="data_ops",
        )
    except Exception as exc:
        runtime.mark_unready(f"{type(exc).__name__}: {exc}")
        log.error("backend read models are not ready (%s)", type(exc).__name__)
    else:
        runtime.mark_ready(prepared)
    audit = get_audit()
    _register_cleanup(cleanup, "audit log", audit.close)
    audit.reopen()
    return runtime, audit


def _compose_application(
    app: FastAPI, cleanup: AsyncExitStack, runtime: Any, audit: Any,
) -> _OwnedResources:
    tca, gateway, queue, bot = get_engine(), get_gateway(), get_queue(), get_bot()
    _register_cleanup(cleanup, "job queue", queue.shutdown)
    market_data, risk_engine = MarketDataProvider(tca), RiskEngineManager(gateway)
    execution_gateway = ExecutionGatewayService(gateway)
    # The symbol allow-list bounds topic cardinality; the feed separately caps
    # connected clients so a reconnect storm cannot multiply queues forever.
    book_stream = LatestStateFeed(
        send_timeout_s=2.0,
        max_topics=max(1, len({symbol.upper() for symbol in settings.symbols})),
        max_consumers=64,
        max_consumers_per_topic=32,
    )
    health = HealthService(
        runtime=runtime, market_data=market_data, risk_engine=risk_engine,
        jobs=queue, audit=audit, telegram=bot, book_stream=book_stream,
        metadata=ApplicationMetadata(
            name=settings.app_name, version=settings.version, environment=settings.environment,
            backtest_engine="vectorbt" if VECTORBT_AVAILABLE else "numpy",
        ),
        writer_status=single_writer_status,
    )
    app.state.application_context = ApplicationContext(
        runtime=runtime, market_data=market_data, execution_gateway=execution_gateway,
        risk_engine=risk_engine, jobs=queue, audit=audit, telegram=bot,
        health=health, book_stream=book_stream,
    )
    _register_cleanup(cleanup, "application context", lambda: _clear_application_context(app))
    gateway.add_alert_hook(bot.broadcast)
    tca.add_alert_hook(bot.broadcast)
    queue.on_complete(bot.push_backtest_result)
    mirror, rag = get_mirror(), get_rag()
    gateway.add_decision_hook(mirror.enqueue)
    gateway.add_decision_hook(rag.on_decision)
    queue.on_complete(rag.on_backtest_complete)
    queue.on_complete(on_data_job_complete)
    return _OwnedResources(runtime, audit, tca, gateway, queue, bot, mirror, rag)


async def _start_owned_services(cleanup: AsyncExitStack, owned: _OwnedResources) -> None:
    for label, resource in (
        ("market-data engine", owned.tca),
        ("risk gateway", owned.gateway),
    ):
        _register_cleanup(cleanup, label, resource.stop)
        await resource.start()
    _register_cleanup(cleanup, "telegram bot", owned.bot.stop)
    await _start_optional_telegram(owned.bot)
    for label, resource in (
        ("supabase mirror", owned.mirror),
        ("research index", owned.rag),
    ):
        _register_cleanup(cleanup, label, resource.stop)
        await resource.start()
    scheduler = get_scheduler()
    _register_cleanup(cleanup, "data scheduler", scheduler.stop)
    scheduler.start()
    research_scheduler = get_research_scheduler()
    _register_cleanup(cleanup, "research reconcile scheduler", research_scheduler.stop)
    research_scheduler.start()
    ml_store = get_ml_store()
    _register_cleanup(cleanup, "ML result store", ml_store.stop)
    await ml_store.start()


def _start_resolve_loop_and_coherence_tasks(cleanup: AsyncExitStack) -> None:
    resolve_task = asyncio.create_task(resolve_loop(), name="data-quality-resolve")
    _register_cleanup(cleanup, "data-quality resolve task", lambda: _cancel_task(resolve_task))
    # The pool closes after both Kalshi tasks, so teardown cannot look like a venue fault.
    _register_cleanup(cleanup, "Kalshi HTTP pool", close_kalshi_pool)
    recorder = asyncio.create_task(coherence_recorder_loop(), name="coherence-recorder")
    _register_cleanup(cleanup, "coherence recorder", lambda: _cancel_task(recorder))
    warm = asyncio.create_task(coherence_warm_loop(), name="coherence-warm")
    _register_cleanup(cleanup, "coherence warm task", lambda: _cancel_task(warm))


def _mark_started(cleanup: AsyncExitStack, owned: _OwnedResources) -> None:
    _measure_decision_core_readiness(owned.gateway, owned.runtime)
    owned.audit.record_risk_event(
        "gateway_start", severity="info", actor="system",
        detail=f"{settings.app_name} v{settings.version}",
        payload={
            "symbols": settings.symbols, "venues": settings.venues,
            "limits": settings.risk_limits_dict(),
        },
    )
    _register_cleanup(
        cleanup, "gateway stop audit event",
        lambda: owned.audit.record_risk_event(
            "gateway_stop", severity="info", actor="system", detail="clean shutdown",
        ),
    )
    log.info("audit log      : %s (%s)", owned.audit.db_path, owned.audit.backend)
    log.info("market data    : %s on %s", ", ".join(settings.venues), ", ".join(settings.symbols))
    log.info("job backend    : %s", owned.queue.stats()["backend"])
    log.info("backtest engine: %s", "vectorbt" if VECTORBT_AVAILABLE else "numpy fallback")
    log.info("telegram       : %s", owned.bot.mode)
    log.info("gateway console: %s", settings.gateway_ui_url)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Own process resources from the writer claim through final release."""
    log.info("=" * 78)
    log.info("%s v%s  [%s]", settings.app_name, settings.version, settings.environment)
    log.info("=" * 78)
    async with AsyncExitStack() as cleanup:
        runtime, audit = await _open_state(cleanup)
        owned = _compose_application(app, cleanup, runtime, audit)
        await _start_owned_services(cleanup, owned)
        _start_resolve_loop_and_coherence_tasks(cleanup)
        _mark_started(cleanup, owned)
        try:
            yield
        finally:
            log.info("shutting down…")
