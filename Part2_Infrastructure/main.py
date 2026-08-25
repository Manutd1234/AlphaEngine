"""
AlphaEngine Trading Automation — FastAPI Central Gateway
========================================================

Single process, three modules, and two deliberately independent clients:

    Telegram text companion ─┐                   ┌─ Module A  TCA / L2 order book
                             ├─ FastAPI gateway ─┼─ Module B  Pre-trade risk + kill switch
    Web gateway console ─────┘                   └─ Module C  Async backtest queue
                                     │
                             DuckDB audit log

Run:
    uvicorn main:app --reload --port 8000

Everything is optional except the gateway itself: with no Telegram token the
REST API and web console work unchanged; with no network the market-data layer
falls back to a clearly-tagged synthetic book.

The fifty-two routes now live in ``modules/api/``, one router per tag group.
What stays here is what only one file can hold: the lifespan that fixes
start-up and shutdown ordering, the application object, the middleware stack
(whose order is load-bearing), the console template, and the exception handler
that gives every error the same shape.

This file also stays at THIS path. ``docker/gateway.Dockerfile`` copies the root
modules by name, so a route that moved to a new root package would be missing
from the image with nothing to catch it before a request arrived. See
``modules/api/__init__.py``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import BASE_DIR, settings
from modules.api import (
    audit_router,
    coherence_history_router,
    coherence_lab_router,
    coherence_router,
    data_router,
    diffusion_router,
    meta_router,
    ml_router,
    research_router,
    risk_router,
    tca_router,
    telegram_router,
)
from modules.audit import get_audit
from modules.backtester import VECTORBT_AVAILABLE
from modules.coherence.drivers.kalshi_rest import close_pool as close_kalshi_pool
from modules.coherence.recorder import recorder_loop as coherence_recorder_loop
from modules.data_jobs import on_data_job_complete
from modules.data_quality import resolve_loop
from modules.data_scheduler import get_scheduler
from modules.jobs import get_queue
from modules.metrics import RequestTimingMiddleware
from modules.ml.store import get_ml_store
from modules.research_rag import get_rag
from modules.research_schedule import get_research_scheduler
from modules.risk_proxy import get_gateway
from modules.supabase_mirror import get_mirror
from modules.tca_engine import get_engine
from modules.telegram import get_bot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)-22s %(message)s",
    datefmt="%H:%M:%S",
)
# httpx's INFO request line includes the full Telegram Bot API URL, whose path
# contains the bot token. Application modules log sanitized outcomes already;
# never let the transport echo credentials into process logs.
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("alphaengine")

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


# --------------------------------------------------------------------------- #
# Lifespan — deterministic start-up / shutdown ordering
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=" * 78)
    log.info("%s v%s  [%s]", settings.app_name, settings.version, settings.environment)
    log.info("=" * 78)

    audit = get_audit()
    tca = get_engine()
    gateway = get_gateway()
    queue = get_queue()
    bot = get_bot()

    # Risk alerts, feed outages and finished jobs are pushed through Telegram.
    # A venue going dark is a trading condition, not just a log line: quotes
    # from a stale book are not safe to size against.
    gateway.add_alert_hook(bot.broadcast)
    tca.add_alert_hook(bot.broadcast)
    queue.on_complete(bot.push_backtest_result)

    # Best-effort Postgres mirror: a no-op unless SUPABASE_* is configured.
    # enqueue is put_nowait — it can never slow an order down.
    mirror = get_mirror()
    gateway.add_decision_hook(mirror.enqueue)

    # pgvector research index: backtests are embedded as they complete, and an
    # execution anomaly retrieves its three most similar historical reports.
    rag = get_rag()
    gateway.add_decision_hook(rag.on_decision)
    queue.on_complete(rag.on_backtest_complete)

    # Replay and backfill jobs persist through the gateway's own hook — the
    # finding to the quality ledger, clean bars to the cache — on this loop,
    # never in a worker.
    queue.on_complete(on_data_job_complete)

    await tca.start()
    await gateway.start()
    await bot.start()
    await mirror.start()
    await rag.start()
    scheduler = get_scheduler()
    scheduler.start()
    # Reconciliation, beside the data scheduler and for the same reason: linking
    # happens on write, so the graph is only as complete as the moment each
    # document was written. A document written before its relation existed never
    # gets that edge until something sweeps for it.
    research_reconcile_scheduler = get_research_scheduler()
    research_reconcile_scheduler.start()
    # Built here rather than on the first write: a fit job that has just spent
    # seconds of CPU should not then discover its transport is unconfigured, or
    # pay for a TLS handshake inside the persist it is being timed on.
    await get_ml_store().start()
    # An escalation whose provider went silent used to stay open forever:
    # `_resolve_cleared` only runs inside `ingest`, so nothing swept.
    resolve_task = asyncio.create_task(resolve_loop(), name="data-quality-resolve")

    # The Kalshi book recorder. Idle unless COHERENCE_SERIES and
    # COHERENCE_POLL_S are both set, because a process that starts reaching
    # for an exchange the moment it boots is not something to enable by
    # accident. It records whole ladders rather than prices: depth is
    # forward-only, and a book missed at 14:32 cannot be recovered at 14:33.
    coherence_task = asyncio.create_task(coherence_recorder_loop(), name="coherence-recorder")

    # Time the compiled decision battery once, on a synthetic two-venue book,
    # so the desk's nanosecond figure exists before the first order and after
    # every restart. Core histogram only — the decision (us) histogram waits
    # for real orders. A no-op on the Python engine; never raises.
    gateway.run_core_self_measure()

    audit.record_risk_event(
        "gateway_start", severity="info", actor="system",
        detail=f"{settings.app_name} v{settings.version}",
        payload={"symbols": settings.symbols, "venues": settings.venues, "limits": settings.risk_limits_dict()},
    )

    log.info("audit log      : %s (%s)", audit.db_path, audit.backend)
    log.info("market data    : %s on %s", ", ".join(settings.venues), ", ".join(settings.symbols))
    log.info("job backend    : %s", queue.stats()["backend"])
    log.info("backtest engine: %s", "vectorbt" if VECTORBT_AVAILABLE else "numpy fallback")
    log.info("telegram       : %s", bot.mode)
    log.info("gateway console: %s", settings.gateway_ui_url)

    try:
        yield
    finally:
        log.info("shutting down…")
        audit.record_risk_event("gateway_stop", severity="info", actor="system", detail="clean shutdown")
        await scheduler.stop()
        resolve_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await resolve_task
        coherence_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await coherence_task
        # After the recorder is cancelled, not before: closing the pool out from
        # under an in-flight book read would surface as a transport failure and
        # be recorded as a venue fault.
        await close_kalshi_pool()
        await get_ml_store().stop()
        await bot.stop()
        await rag.stop()
        await mirror.stop()
        await gateway.stop()
        await tca.stop()
        queue.shutdown()
        audit.close()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Unified execution-quality, pre-trade-risk and research gateway. "
        "Module A: cross-venue L2 TCA · Module B: pre-trade risk & kill switch · "
        "Module C: asynchronous parametric backtesting."
    ),
    lifespan=lifespan,
)

# The gateway console and separately deployed web workspace are ordinary web
# clients. Telegram is intentionally not part of web authentication.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added last so it wraps outermost: the latency an operator cares about includes
# whatever CORS and the exception handler spend, not just the handler body.
app.add_middleware(RequestTimingMiddleware)

static_dir = BASE_DIR / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# --------------------------------------------------------------------------- #
# Routes
#
# One router per tag group, in the order those groups first appeared when every
# route was declared in this file. Starlette tries paths in registration order,
# so the order is deliberate rather than alphabetical: no router here claims a
# prefix another one needs, and keeping the historical order is what stops one
# quietly starting to.
#
# `tools/export_openapi.py` renders the snapshot with sorted keys, so this order
# cannot move the committed contract digest by itself. If the digest changes
# after a re-order, something other than the order changed with it.
# --------------------------------------------------------------------------- #
for _router in (
    meta_router,
    data_router,
    ml_router,
    tca_router,
    risk_router,
    research_router,
    audit_router,
    coherence_history_router,
    coherence_lab_router,
    coherence_router,
    diffusion_router,
    telegram_router,
):
    app.include_router(_router)


# --------------------------------------------------------------------------- #
# Web UI
# --------------------------------------------------------------------------- #
@app.get("/", include_in_schema=False)
@app.get("/app", include_in_schema=False)   # aliases: one console, three paths
@app.get("/ui", include_in_schema=False)
async def gateway_console(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "miniapp.html", {"config": _ui_config()})


def _ui_config() -> dict[str, Any]:
    return {
        "symbols": settings.symbols,
        "venues": settings.venues,
        "limits": settings.risk_limits_dict(),
        "probe_notional": settings.default_probe_notional,
        "backtest_max_combos": settings.backtest_max_combos,
        "engine": "vectorbt" if VECTORBT_AVAILABLE else "numpy",
        "version": settings.version,
        # Never serialize a gateway credential into HTML. Protected consoles ask
        # the operator for a bearer token and keep it only in page memory.
        "auth_required": settings.require_auth,
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail, "path": request.url.path})


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=False, log_level="info")
