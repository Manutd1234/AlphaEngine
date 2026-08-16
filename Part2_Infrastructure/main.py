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
import time
from collections.abc import AsyncIterator
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
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import BASE_DIR, settings
from modules import research
from modules.audit import get_audit
from modules.backtester import VECTORBT_AVAILABLE, run_backtest
from modules.decision_core import ENGINE as DECISION_ENGINE
from modules.equity_quote import EquityQuoteUnavailable, fetch_paper_equity_reference, is_equity_symbol
from modules.jobs import get_queue
from modules.metrics import RequestTimingMiddleware, render_metrics
from modules.operations import OperationsSnapshot, build_operations_snapshot
from modules.portfolio import build_equity_history, build_portfolio
from modules.research_rag import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, get_rag
from modules.risk_proxy import get_gateway
from modules.schemas import (
    BacktestRequest,
    CancelRequest,
    KillSwitchRequest,
    OrderAck,
    OrderEvent,
    OrderRequest,
    OrderTimeline,
    ReduceOnlyRequest,
    ReplaceRequest,
    ResearchRagEmbedRequest,
    ResearchRagEmbedResponse,
    ResearchRagSearchRequest,
    ResearchRagSearchResponse,
    ResearchRagStatus,
    RiskDecision,
    RiskState,
    TCAReport,
    VenueBook,
    WorkingOrder,
)
from modules.supabase_mirror import get_mirror
from modules.tca_engine import get_engine
from modules.telegram import decode_link_probe, get_bot
from modules.web_telemetry import WebStateSyncRequest, WebStateView, get_web_ops

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

    await tca.start()
    await gateway.start()
    await bot.start()
    await mirror.start()
    await rag.start()

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

    Account linking does not weaken that, because it runs one way only: a web
    identity can authorise a *Telegram* read, and nothing a Telegram user does
    is ever evidence about a web request. A binding also grants no more than a
    desk pass already does — and ``POST /api/auth/guest`` hands a pass to
    anyone who asks — so it moves data between transports it was already on
    rather than unlocking any. Control commands stay on their own allow-list.
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
                # Which engine judges orders. deploy.yml refuses to keep a
                # container that fell back to the Python reference when native
                # was built for it — the same precedent as C_backtest.engine.
                "decision_engine": DECISION_ENGINE,
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


@app.get("/api/ops/snapshot", response_model=OperationsSnapshot, tags=["meta"])
async def operations_snapshot(_actor: str = Depends(trader_identity)) -> OperationsSnapshot:
    """Structured reliability state for the operator workspace.

    This endpoint deliberately excludes raw URLs, storage paths, usernames and
    error strings. ``observed_at`` plus ``stale_after_seconds`` lets a client
    distinguish a healthy snapshot from a monitoring path that has gone quiet.
    """
    return build_operations_snapshot(
        tca=get_engine(),
        gateway=get_gateway(),
        queue=get_queue(),
        audit=get_audit(),
        bot=get_bot(),
        mirror=get_mirror(),
    )


@app.post("/api/ops/web-state/sync", response_model=WebStateView, tags=["meta"])
async def web_state_sync(
    request: WebStateSyncRequest,
    _actor: str = Depends(trader_identity),
) -> WebStateView:
    """Merge one web instance's telemetry deltas and return the shared view.

    The Vercel workspace runs on rotating serverless instances whose in-memory
    ledgers disagree; this gateway is the one long-lived process they share.
    Push and pull happen in a single round trip so a health poll pays exactly
    one extra request. Observability only — no trading state passes this way.
    """
    return get_web_ops().sync(request)


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
    if (
        order.paper_execution is None
        and settings.paper_equity_quote_url
        and is_equity_symbol(order.symbol)
    ):
        try:
            reference = await fetch_paper_equity_reference(
                order.symbol,
                settings.paper_equity_quote_url,
                timeout_s=settings.paper_equity_quote_timeout_s,
            )
            order = order.model_copy(update={"paper_execution": reference})
        except EquityQuoteUnavailable as exc:
            # Submit unchanged. The gateway's normal whitelist and
            # price-availability checks produce the evidence-rich rejection;
            # a provider outage never turns into a guessed fill.
            log.warning("paper equity quote unavailable for %s: %s", order.symbol, exc)
    return await get_gateway().submit(order, source=actor)


@app.get("/api/orders", response_model=list[WorkingOrder], tags=["B · Risk"])
async def list_working_orders(
    symbol: str | None = Query(default=None, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    _actor: str = Depends(trader_identity),
) -> list[WorkingOrder]:
    """Orders resting on the book right now.

    Terminal decisions — filled, rejected, cancelled, expired — live in
    `/api/audit/orders`. This is only what is still open, which is the set a desk
    can still act on.
    """
    return get_gateway().list_working(symbol)


@app.get("/api/orders/{order_id}", response_model=OrderTimeline, tags=["B · Risk"])
async def order_timeline(order_id: str, _actor: str = Depends(trader_identity)) -> OrderTimeline:
    """Every transition one order made, from the append-only event log."""
    rows = get_audit().order_timeline(order_id)
    if not rows:
        raise HTTPException(status_code=404, detail=f"no such order: {order_id}")
    events = [
        OrderEvent(
            ts=row["ts"],
            event=str(row.get("event") or "UNKNOWN"),
            status=str(row.get("status") or "WORKING"),
            detail=str(row.get("detail") or ""),
            actor=str(row.get("actor") or "system"),
            fill_price=row.get("fill_price"),
            fill_qty=row.get("fill_qty"),
            fee_usd=row.get("fee_usd"),
            venue=row.get("venue"),
            replaces=row.get("replaces"),
        )
        for row in rows
    ]
    return OrderTimeline(order_id=order_id, status=events[-1].status, events=events)


@app.post("/api/orders/{order_id}/cancel", response_model=OrderAck, tags=["B · Risk"])
async def cancel_order(
    order_id: str,
    req: CancelRequest = Body(default_factory=CancelRequest),
    actor: str = Depends(trader_identity),
) -> OrderAck:
    """Pull one resting order.

    No typed-confirmation ritual, unlike the kill switch: that ceremony suits a
    desk-wide action, not a single order a trader pulls repeatedly. A cancel also
    does not consume a rate-limit token — it only ever reduces risk, and a book in
    trouble must always be able to get out.
    """
    ack = await get_gateway().cancel_working(order_id, actor=actor, reason=req.reason)
    if ack is None:
        raise HTTPException(
            status_code=404,
            detail=f"{order_id} is not resting — it may have filled, expired or already been cancelled",
        )
    return ack


@app.post("/api/orders/{order_id}/replace", response_model=RiskDecision, tags=["B · Risk"])
async def replace_order(
    order_id: str, req: ReplaceRequest, actor: str = Depends(trader_identity),
) -> RiskDecision:
    """Cancel-and-new. Returns the **new** order's full check vector.

    A replacement faces every gate again and can be rejected where the original
    passed, so the evidence returned has to be the new evidence.
    """
    decision = await get_gateway().replace_working(order_id, req, actor=actor)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"{order_id} is not resting")
    return decision


@app.get("/api/risk/state", response_model=RiskState, tags=["B · Risk"])
async def risk_state(_actor: str = Depends(trader_identity)) -> RiskState:
    return get_gateway().state()


@app.get("/api/stream/desk", tags=["B · Risk"])
async def stream_desk(_actor: str = Depends(trader_identity)) -> StreamingResponse:
    """Server-sent events: the risk state, pushed when it changes.

    The desk's equity, drawdown and kill-switch status were reaching the browser
    by polling every 4–15 seconds against a book the gateway re-marks every
    second. Most of those requests returned a number the client already had, and
    the ones that mattered arrived late.

    **Emits on change, not on a timer.** A tick whose payload is identical to
    the last one sends nothing, so an idle desk costs one heartbeat every 15s
    rather than a full state payload every second. The comparison is on the
    serialised body, which is exactly what a client would have to diff anyway.

    **Every event carries a monotonic `seq`.** Same reasoning as
    `/api/system/events`: a reconnecting client can tell "nothing happened while
    I was gone" from "I missed something", and a UI that cannot tell those apart
    will eventually show a stale number as if it were live. SSE's own
    `Last-Event-ID` carries it back automatically on reconnect.

    **Heartbeats are SSE comments** (`: ping`), which every EventSource
    implementation discards silently. They exist so an idle connection is not
    reaped by an intermediary that cannot tell a healthy quiet stream from a
    dead one.

    Not consumed by the browser directly — the page is HTTPS and this gateway is
    plain HTTP, which no browser will mix, so it needs a same-origin proxy. The
    web app carried one and it has been removed: it had no consumer, and
    `EventSource` exposes neither the status code nor the body, so the proxy's
    deliberate 503 on a gateway-less deployment was invisible to the client and
    the panel read "connecting" forever. This endpoint stays — it is correct and
    cheap — and re-proxying is a small change once a surface wants a stream.
    """
    gateway = get_gateway()

    async def emit() -> AsyncIterator[str]:
        seq = 0
        last_body: str | None = None
        last_beat = time.monotonic()
        # Matches the mark-to-market cadence. Polling this faster cannot produce
        # a newer number, it can only re-send the same one.
        interval = max(0.1, settings.risk_monitor_interval_s)
        try:
            while True:
                body = gateway.state().model_dump_json()
                now = time.monotonic()
                if body != last_body:
                    seq += 1
                    last_body = body
                    last_beat = now
                    yield f"id: {seq}\nevent: risk\ndata: {body}\n\n"
                elif now - last_beat >= 15.0:
                    last_beat = now
                    yield ": ping\n\n"
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            # The client went away. Nothing to clean up — no subscription, no
            # buffer — but swallow it so a disconnect is not logged as an error.
            raise

    return StreamingResponse(
        emit(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Long-lived streams are the one thing nginx-style proxies buffer by
            # default, which turns a push into a batch delivered at close.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
    kill = await get_gateway().release_kill(actor=actor, symbol=req.symbol, reason=req.reason)
    return {"kill_switch_active": kill.active, "halted_symbols": sorted(kill.halted_symbols),
            "reason": req.reason, "actor": actor}


@app.post("/api/risk/reduce-only", tags=["B · Risk"])
async def toggle_reduce_only(req: ReduceOnlyRequest = Body(default=ReduceOnlyRequest()),
                             actor: str = Depends(trader_identity)) -> dict[str, Any]:
    state = await get_gateway().set_reduce_only(enabled=req.enabled, actor=actor, reason=req.reason)
    return {"reduce_only": state.reduce_only, "reduce_only_source": state.reduce_only_source, "actor": actor}


@app.post("/api/risk/reset", tags=["B · Risk"])
async def reset_book(actor: str = Depends(trader_identity)) -> dict[str, Any]:
    get_gateway().reset_book(actor=actor)
    return {"ok": True, "actor": actor}


# --------------------------------------------------------------------------- #
# Module C — Backtesting
# --------------------------------------------------------------------------- #
@app.post("/api/research/rag/search", tags=["C · Research"])
async def research_rag_search(
    req: ResearchRagSearchRequest, _actor: str = Depends(trader_identity)
) -> ResearchRagSearchResponse:
    """Similarity search over the desk's own backtests, summaries and incidents.

    Returns `state: unavailable` when Supabase is not configured — deliberately
    not an empty list, which would mean "searched, found nothing".
    """
    result = await get_rag().search(req.query, match_count=req.match_count, kind=req.kind)
    return ResearchRagSearchResponse(**result)


@app.post("/api/research/rag/embed", tags=["C · Research"])
async def research_rag_embed(
    req: ResearchRagEmbedRequest, _actor: str = Depends(trader_identity)
) -> ResearchRagEmbedResponse:
    """Embed text with the same model that embedded the corpus.

    Exists so the Oracle vector-search route can embed a query without becoming
    a second embedding vendor. Vectors are comparable only within one model, so
    a query embedded by anything other than the `gte-small` session in
    `supabase/functions/embed-research` would return confident, meaningless
    neighbours — a failure indistinguishable from success.

    `state: unavailable` rather than an error when the index is not configured
    or the service did not answer, matching the search route: "not configured"
    and "found nothing" are different facts and neither is an exception.
    """
    rag = get_rag()
    vectors = await rag.embed_many(req.texts)
    if vectors is None:
        return ResearchRagEmbedResponse(state="unavailable")
    return ResearchRagEmbedResponse(
        state="ok",
        embeddings=vectors,
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIMENSIONS,
    )


@app.get("/api/research/rag/status", tags=["C · Research"])
async def research_rag_status(_actor: str = Depends(trader_identity)) -> ResearchRagStatus:
    """Index counters plus the cached matches from the last execution anomaly."""
    return ResearchRagStatus(**get_rag().status())


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


@app.post("/telegram/link/status", tags=["telegram"])
async def telegram_link_status(
    probe: str = Body(..., embed=True, max_length=64, description="A signed status probe minted by the web desk."),
) -> dict[str, Any]:
    """Is the desk pass this caller already holds bound to a Telegram chat?

    Exists because a GUEST binding lives only in this gateway's store. The web
    workspace can read an *account* binding back from Supabase under RLS, but it
    has no route into DuckDB, so a guest who tapped Connect and was confirmed by
    the bot saw the header chip stay grey forever.

    ── Why this cannot be used to look anyone else up ──────────────────────────
    The identity is not a parameter. It is carried inside ``probe``, MAC'd with
    a key derived from ``TELEGRAM_LINK_SECRET`` (see ``link_probe_secret``), so
    the only identities that can be asked about are ones the caller could
    already mint a *link* token for — that is, ones it already speaks for. There
    is no field to put somebody else's user id in, and flipping a byte of the
    embedded UUID invalidates the signature, which is the same property
    ``tests/test_telegram_link.py`` pins for the link token itself.

    ── Why the answer cannot enumerate anything ────────────────────────────────
    It is a state and a kind. Never the Telegram username, never the chat id,
    never the Telegram user id, never a count, never a list. Exactly the line
    ``TelegramBot.health()``'s ``links`` block draws, narrowed to one row: a
    caller learns one boolean-ish fact about one identity it already proved it
    holds, and cannot walk from that answer to a second one.

    ── Why POST for a read ─────────────────────────────────────────────────────
    So the signed probe travels in a body rather than a URL. A query string ends
    up in access logs, proxy logs and ``Referer`` headers; the probe is
    short-lived and answers only yes/no, but a credential that need not be
    written down should not be. Nothing is written by this handler.
    """
    if not settings.telegram_link_enabled:
        # Fail loudly rather than answering "not linked" from a gateway that
        # cannot verify anything. Absent configuration is not evidence of an
        # absent binding.
        raise HTTPException(503, "linking is not configured on this gateway (TELEGRAM_LINK_SECRET)")
    try:
        token = decode_link_probe(probe, settings.telegram_link_secret)
    except ValueError as exc:
        # The verifier's own wording, prefixed: its messages say "start code"
        # because a person reads them in a Telegram card, and an operator
        # curling this endpoint should not be told to go and tap Connect. The
        # usual cause here is the two deployments holding different secrets.
        raise HTTPException(403, f"status probe refused — {exc}") from exc
    return {
        "link_status": get_bot().binding_status(token.kind, token.identity),
        "kind": token.kind,
        "grants": "read-parity-with-a-web-desk-pass",
        "grants_control": False,
    }


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
