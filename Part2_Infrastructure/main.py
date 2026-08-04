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
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import (
    Body,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import BASE_DIR, settings
from modules import research
from modules.audit import get_audit
from modules.backtester import VECTORBT_AVAILABLE, run_backtest
from modules.jobs import get_queue
from modules.metrics import RequestTimingMiddleware, render_metrics
from modules.portfolio import build_equity_history, build_portfolio
from modules.risk_proxy import get_gateway
from modules.schemas import (
    BacktestRequest,
    KillSwitchRequest,
    OrderRequest,
    RiskDecision,
    RiskState,
    TCAReport,
    VenueBook,
)
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

    await tca.start()
    await gateway.start()
    await bot.start()

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
        await bot.stop()
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
# Auth
# --------------------------------------------------------------------------- #
async def trader_identity(
    authorization: str | None = Header(default=None),
    x_alphaengine_token: str | None = Header(default=None, alias="X-AlphaEngine-Token"),
) -> str:
    """Resolve the caller to an audit actor.

    The dedicated server-to-server header is preferred because some public
    tunnel and access proxies reserve or rewrite ``Authorization``. Standard
    bearer auth remains supported for direct clients. ``REQUIRE_AUTH=1`` turns
    the anonymous path into a 401. Telegram has its own user allow-list and
    never authenticates web requests.
    """
    presented = x_alphaengine_token.strip() if x_alphaengine_token else None
    if presented is None and authorization and authorization.startswith("Bearer "):
        presented = authorization.removeprefix("Bearer ").strip()

    if presented is not None:
        if hmac.compare_digest(presented, settings.web_api_token):
            return "web:token"
        raise HTTPException(status_code=401, detail="invalid gateway token")

    if settings.require_auth:
        raise HTTPException(status_code=401, detail="authentication required")
    return "web:anonymous"


# --------------------------------------------------------------------------- #
# Meta
# --------------------------------------------------------------------------- #
@app.get("/health", tags=["meta"])
async def health() -> dict[str, Any]:
    tca, gateway, queue, bot = get_engine(), get_gateway(), get_queue(), get_bot()
    state = gateway.state()
    return {
        "status": "halted" if state.kill_switch_active else "ok",
        "app": settings.app_name,
        "version": settings.version,
        "environment": settings.environment,
        "modules": {
            "A_tca": tca.health(),
            "B_risk": {
                "kill_switch_active": state.kill_switch_active,
                "halted_symbols": state.halted_symbols,
                "orders_accepted": state.orders_accepted,
                "orders_rejected": state.orders_rejected,
                "drawdown_budget_used_pct": round(state.drawdown_budget_used_pct, 4),
            },
            "C_backtest": {**queue.stats(), "engine": "vectorbt" if VECTORBT_AVAILABLE else "numpy"},
        },
        "telegram": bot.health(),
        "audit": {"backend": get_audit().backend, "path": str(get_audit().db_path)},
    }


@app.get("/metrics", tags=["meta"], response_class=PlainTextResponse)
async def metrics() -> PlainTextResponse:
    """Prometheus text exposition of the same state ``/health`` reports.

    Unauthenticated, like ``/health``: a scrape target that needs a credential
    is a scrape target that silently stops working, and this exposes no more
    than the health endpoint already does. A deployment that wants the metrics
    private restricts ``/metrics`` at the reverse proxy, where the rest of its
    ingress policy already lives.
    """
    return PlainTextResponse(render_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")


@app.get("/api/config", tags=["meta"])
async def api_config(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    return {
        "symbols": settings.symbols,
        "venues": settings.venues,
        "limits": settings.risk_limits_dict(),
        "default_probe_notional": settings.default_probe_notional,
        "book_depth": settings.book_depth,
        "backtest": {
            "engine": "vectorbt" if VECTORBT_AVAILABLE else "numpy",
            "max_combos": settings.backtest_max_combos,
            "default_fee_bps": settings.backtest_fee_bps,
            "default_slippage_bps": settings.backtest_slippage_bps,
        },
        "telegram_enabled": settings.telegram_enabled,
    }


# --------------------------------------------------------------------------- #
# Module A — TCA
# --------------------------------------------------------------------------- #
@app.get("/api/book/{symbol}", response_model=list[VenueBook], tags=["A · TCA"])
async def get_book(symbol: str, depth: int = Query(default=15, ge=1, le=50)) -> list[VenueBook]:
    books = get_engine().get_books(symbol.upper(), depth=depth)
    if not books:
        raise HTTPException(404, f"no feed configured for {symbol.upper()}")
    return books


@app.get("/api/tca/{symbol}", response_model=TCAReport, tags=["A · TCA"])
async def get_tca(
    symbol: str,
    side: str = Query(default="BUY", pattern="^(BUY|SELL|buy|sell)$"),
    notional: float = Query(default=None, gt=0),
) -> TCAReport:
    report = get_engine().tca_report(symbol.upper(), side.upper(), notional)
    if not report.per_venue:
        raise HTTPException(503, f"no live book for {symbol.upper()} — check /health")
    return report


@app.websocket("/ws/book/{symbol}")
async def ws_book(ws: WebSocket, symbol: str) -> None:
    """Push the consolidated ladder + live TCA at ~4Hz for the DOM visualiser."""
    await ws.accept()
    symbol = symbol.upper()
    tca = get_engine()
    try:
        while True:
            books = tca.get_books(symbol, depth=15)
            payload = {
                "type": "book",
                "symbol": symbol,
                "consolidated_mid": tca.consolidated_mid(symbol),
                "venues_online": tca.venues_online(symbol),
                "books": [b.model_dump(mode="json") for b in books],
            }
            report = tca.tca_report(symbol, "BUY", settings.default_probe_notional)
            if report.per_venue:
                payload["tca"] = report.model_dump(mode="json")
            await ws.send_json(payload)
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("ws closed: %s", exc)
        with contextlib.suppress(Exception):
            await ws.close()


# --------------------------------------------------------------------------- #
# Module B — Risk gateway
# --------------------------------------------------------------------------- #
@app.post("/api/orders", response_model=RiskDecision, tags=["B · Risk"])
async def submit_order(order: OrderRequest, actor: str = Depends(trader_identity)) -> RiskDecision:
    """The only way an order reaches a venue. Returns the full check vector for
    both accepted and rejected orders — a rejection is a result, not an error."""
    return await get_gateway().submit(order, source=actor)


@app.get("/api/risk/state", response_model=RiskState, tags=["B · Risk"])
async def risk_state(_actor: str = Depends(trader_identity)) -> RiskState:
    return get_gateway().state()


@app.get("/api/portfolio", tags=["B · Risk"])
async def portfolio(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    """Portfolio-manager view: exposure, concentration, risk headroom, attribution.

    Distinct from `/api/risk/state`, which answers a trader's question about the
    next order. This answers a PM's: where is the book concentrated, which limit
    binds first, and what is producing the P&L.
    """
    payload = build_portfolio(get_gateway(), get_audit())
    payload["gateway"] = {
        "environment": settings.environment,
        "version": settings.version,
        "authoritative": True,
    }
    return payload


@app.get("/api/portfolio/history", tags=["B · Risk"])
async def portfolio_history(
    limit: int = Query(default=500, ge=1, le=5000),
    session_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    """The equity curve as persisted by the risk monitor, plus period returns.

    `/api/portfolio` is a snapshot — it cannot answer "what did the book do this
    month" because that is history, not state. This reads the append-only
    equity_snapshots table, so the curve survives a browser reload and a gateway
    restart alike.
    """
    return build_equity_history(get_audit(), limit=limit, session_date=session_date)


@app.get("/api/risk/limits", tags=["B · Risk"])
async def risk_limits(_actor: str = Depends(trader_identity)) -> dict[str, float]:
    return settings.risk_limits_dict()


@app.post("/api/risk/kill", tags=["B · Risk"])
async def engage_kill(req: KillSwitchRequest = Body(default=KillSwitchRequest()),
                      actor: str = Depends(trader_identity)) -> dict[str, Any]:
    kill = await get_gateway().trigger_kill(reason=req.reason, actor=actor, symbol=req.symbol)
    return {"kill_switch_active": kill.active, "halted_symbols": sorted(kill.halted_symbols),
            "reason": kill.reason, "actor": actor}


@app.post("/api/risk/resume", tags=["B · Risk"])
async def release_kill(req: KillSwitchRequest = Body(default=KillSwitchRequest()),
                       actor: str = Depends(trader_identity)) -> dict[str, Any]:
    # KillSwitchRequest already carries a reason; the resume path used to drop
    # it, leaving the audit trail with a halt that explains itself and a resume
    # that does not.
    kill = await get_gateway().release_kill(actor=actor, symbol=req.symbol, reason=req.reason)
    return {"kill_switch_active": kill.active, "halted_symbols": sorted(kill.halted_symbols),
            "reason": req.reason, "actor": actor}


@app.post("/api/risk/reset", tags=["B · Risk"])
async def reset_book(actor: str = Depends(trader_identity)) -> dict[str, Any]:
    get_gateway().reset_book(actor=actor)
    return {"ok": True, "actor": actor}


# --------------------------------------------------------------------------- #
# Module C — Backtesting
# --------------------------------------------------------------------------- #
@app.post("/api/backtest", tags=["C · Research"])
async def submit_backtest(req: BacktestRequest, actor: str = Depends(trader_identity)) -> dict[str, Any]:
    record = get_queue().submit(
        "backtest", run_backtest, req.model_dump(),
        meta={"chat_id": req.notify_chat_id, "symbol": req.symbol, "actor": actor},
    )
    return {"job_id": record.job_id, "status": record.status, "backend": record.backend,
            "poll": f"/api/jobs/{record.job_id}"}


@app.get("/api/jobs", tags=["C · Research"])
async def list_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    queue = get_queue()
    return {"stats": queue.stats(), "jobs": [j.to_status().model_dump(mode="json") for j in queue.list(limit)]}


@app.get("/api/jobs/{job_id}", tags=["C · Research"])
async def job_status(job_id: str, _actor: str = Depends(trader_identity)) -> dict[str, Any]:
    record = get_queue().get(job_id)
    if not record:
        raise HTTPException(404, f"unknown job {job_id}")
    out = record.to_status().model_dump(mode="json")
    if record.status == "succeeded":
        out["result"] = record.result
    return out


# --------------------------------------------------------------------------- #
# OpenBB research bridge
#
# OpenBB is a Python library, not a hosted API, so this gateway is where it
# runs; the Vercel portal's `openbb` provider adapter is a client of these
# routes. Failures return {"ok": false} with HTTP 200 on purpose: a missing
# downstream key inside OpenBB is a routing signal for the portal's registry,
# not a gateway error its circuit breaker should count against this process.
# --------------------------------------------------------------------------- #
@app.get("/api/research/openbb/health", tags=["C · Research"])
async def openbb_health(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    return await research.openbb_status_async()


@app.get("/api/research/openbb/quote", tags=["C · Research"])
async def openbb_quote(
    symbol: str = Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    asset: str = Query(default="equity", pattern=r"^(equity|crypto)$"),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    return await research.quote(symbol.upper(), asset)


@app.get("/api/research/openbb/bars", tags=["C · Research"])
async def openbb_bars(
    symbol: str = Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    asset: str = Query(default="equity", pattern=r"^(equity|crypto)$"),
    interval: str = Query(default="1d", pattern=r"^(15m|1h|4h|1d)$"),
    limit: int = Query(default=500, ge=10, le=5000),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    return await research.bars(symbol.upper(), asset, interval, limit)


@app.get("/api/research/openbb/news", tags=["C · Research"])
async def openbb_news(
    symbols: str = Query(default="", max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    parsed = [s.strip().upper() for s in symbols.split(",") if s.strip()][:6]
    return await research.news(parsed, limit)


@app.get("/api/research/openbb/fundamentals", tags=["C · Research"])
async def openbb_fundamentals(
    symbol: str = Query(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    _actor: str = Depends(trader_identity),
) -> dict[str, Any]:
    return await research.fundamentals(symbol.upper())


# --------------------------------------------------------------------------- #
# Audit
# --------------------------------------------------------------------------- #
@app.get("/api/audit/orders", tags=["audit"])
async def audit_orders(
    limit: int = Query(default=50, ge=1, le=500),
    _actor: str = Depends(trader_identity),
) -> list[dict[str, Any]]:
    return get_audit().recent_orders(limit)


@app.get("/api/audit/events", tags=["audit"])
async def audit_events(
    limit: int = Query(default=50, ge=1, le=500),
    _actor: str = Depends(trader_identity),
) -> list[dict[str, Any]]:
    return get_audit().recent_events(limit)


@app.get("/api/audit/backtests", tags=["audit"])
async def audit_backtests(
    limit: int = Query(default=20, ge=1, le=200),
    _actor: str = Depends(trader_identity),
) -> list[dict[str, Any]]:
    return get_audit().recent_backtests(limit)


@app.get("/api/audit/stats", tags=["audit"])
async def audit_stats(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    return get_audit().execution_stats()


# --------------------------------------------------------------------------- #
# Telegram webhook
# --------------------------------------------------------------------------- #
@app.post(settings.webhook_path, tags=["telegram"])
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, bool]:
    """Telegram retries on non-2xx, so this always returns 200 and processes the
    update out-of-band — a slow command must never cause duplicate delivery."""
    if not settings.telegram_webhook_secret or x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        log.warning("webhook called with bad secret token")
        raise HTTPException(403, "bad secret token")
    update = await request.json()
    asyncio.create_task(get_bot().handle_update(update))
    return {"ok": True}


@app.get("/telegram/health", tags=["telegram"])
async def telegram_health() -> dict[str, Any]:
    return get_bot().health()


# --------------------------------------------------------------------------- #
# Web UI
# --------------------------------------------------------------------------- #
@app.get("/", include_in_schema=False)
async def root(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "miniapp.html", {"config": _ui_config()})


@app.get("/app", include_in_schema=False)
@app.get("/ui", include_in_schema=False)  # alias
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
