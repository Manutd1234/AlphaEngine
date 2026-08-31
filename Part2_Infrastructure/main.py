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
reports no observed book unless the clearly tagged synthetic demo mode was
explicitly enabled.

The committed OpenAPI contract currently exposes 76 paths carrying 79 HTTP
operations; their adapters live in ``modules/api/``, grouped by domain.
What stays here is what only one entrypoint can hold: the application object,
the middleware stack (whose order is load-bearing), the console template, and
the exception handler that gives every error the same shape.  The lifecycle is
implemented in ``modules.application_lifecycle`` so its ownership rules can be
tested without importing the HTTP surface.

This file also stays at THIS path. ``docker/gateway.Dockerfile`` copies the root
modules by name, so a route that moved to a new root package would be missing
from the image with nothing to catch it before a request arrived. See
``modules/api/__init__.py``.
"""

from __future__ import annotations

import logging
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
from modules.application_lifecycle import (
    _measure_decision_core_readiness as _measure_decision_core_readiness,
)
from modules.application_lifecycle import lifespan
from modules.backtester import VECTORBT_AVAILABLE
from modules.metrics import RequestTimingMiddleware
from modules.request_budget import RequestBudgetMiddleware
from modules.risk_proxy import get_gateway as get_gateway
from modules.tca_engine import get_engine as get_engine

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

# Fixed request classes from the Next proxy become monotonic deadlines for
# bounded store work; arbitrary millisecond values are clamped to that class.
app.add_middleware(RequestBudgetMiddleware)

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
    meta_router, data_router, ml_router,
    tca_router, risk_router, research_router, audit_router,
    coherence_history_router, coherence_lab_router, coherence_router,
    diffusion_router, telegram_router,
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
