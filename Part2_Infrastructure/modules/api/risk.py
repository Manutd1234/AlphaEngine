"""Module B: pre-trade risk, the working book, and the kill switch.

The only path an order takes to a venue. Primary order and risk-control handlers
resolve lifespan-owned application services; audit/portfolio read models retain
their existing adapters until those separate use cases are migrated.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from config import settings
from modules.api.deps import (
    execution_gateway_service,
    risk_engine_manager,
    trader_identity,
)
from modules.application_services import ExecutionGatewayService, RiskEngineManager
from modules.audit import get_audit
from modules.equity_quote import (
    EquityQuoteUnavailable,
    fetch_paper_equity_reference,
    is_equity_symbol,
)
from modules.portfolio import build_equity_history, build_portfolio
from modules.risk_proxy import get_gateway
from modules.schemas import (
    CancelRequest,
    KillSwitchRequest,
    OrderAck,
    OrderEvent,
    OrderRequest,
    OrderTimeline,
    ReduceOnlyRequest,
    ReplaceRequest,
    RiskDecision,
    RiskState,
    WorkingOrder,
)

log = logging.getLogger("alphaengine")

router = APIRouter(tags=["B · Risk"])


@router.post("/api/orders", response_model=RiskDecision)
async def submit_order(
    order: OrderRequest,
    actor: str = Depends(trader_identity),
    execution: ExecutionGatewayService = Depends(execution_gateway_service),
) -> RiskDecision:
    """The only way an order reaches a venue. Returns the full check vector for
    both accepted and rejected orders — a rejection is a result, not an error."""
    # ``paper_execution`` remains in the wire model for compatibility with the
    # Next server route, but it is not an authority: any direct API caller can
    # construct that JSON too. Discard it before enrichment so only evidence
    # fetched by this process can whitelist and price an equity order.
    if order.paper_execution is not None:
        log.warning("discarding caller-supplied paper execution evidence for %s", order.symbol)
        order = order.model_copy(update={"paper_execution": None})

    if settings.paper_equity_quote_url and is_equity_symbol(order.symbol):
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
    return await execution.submit(order, actor=actor)


@router.get("/api/orders", response_model=list[WorkingOrder])
async def list_working_orders(
    symbol: str | None = Query(default=None, min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$"),
    _actor: str = Depends(trader_identity),
    execution: ExecutionGatewayService = Depends(execution_gateway_service),
) -> list[WorkingOrder]:
    """Orders resting on the book right now.

    Terminal decisions — filled, rejected, cancelled, expired — live in
    `/api/audit/orders`. This is only what is still open, which is the set a desk
    can still act on.
    """
    return execution.list_working(symbol)


@router.get("/api/orders/{order_id}", response_model=OrderTimeline)
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


@router.post("/api/orders/{order_id}/cancel", response_model=OrderAck)
async def cancel_order(
    order_id: str,
    req: CancelRequest = Body(default_factory=CancelRequest),
    actor: str = Depends(trader_identity),
    execution: ExecutionGatewayService = Depends(execution_gateway_service),
) -> OrderAck:
    """Pull one resting order.

    No typed-confirmation ritual, unlike the kill switch: that ceremony suits a
    desk-wide action, not a single order a trader pulls repeatedly. A cancel also
    does not consume a rate-limit token — it only ever reduces risk, and a book in
    trouble must always be able to get out.
    """
    ack = await execution.cancel(order_id, actor=actor, reason=req.reason)
    if ack is None:
        raise HTTPException(
            status_code=404,
            detail=f"{order_id} is not resting — it may have filled, expired or already been cancelled",
        )
    return ack


@router.post("/api/orders/{order_id}/replace", response_model=RiskDecision)
async def replace_order(
    order_id: str,
    req: ReplaceRequest,
    actor: str = Depends(trader_identity),
    execution: ExecutionGatewayService = Depends(execution_gateway_service),
) -> RiskDecision:
    """Cancel-and-new. Returns the **new** order's full check vector.

    A replacement faces every gate again and can be rejected where the original
    passed, so the evidence returned has to be the new evidence.
    """
    decision = await execution.replace(order_id, req, actor=actor)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"{order_id} is not resting")
    return decision


@router.get("/api/risk/state", response_model=RiskState)
async def risk_state(
    _actor: str = Depends(trader_identity),
    risk: RiskEngineManager = Depends(risk_engine_manager),
) -> RiskState:
    return risk.state()


@router.get("/api/stream/desk")
async def stream_desk(
    _actor: str = Depends(trader_identity),
    risk: RiskEngineManager = Depends(risk_engine_manager),
) -> StreamingResponse:
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
    async def emit() -> AsyncIterator[str]:
        seq = 0
        last_body: str | None = None
        last_beat = time.monotonic()
        # Matches the mark-to-market cadence. Polling this faster cannot produce
        # a newer number, it can only re-send the same one.
        interval = max(0.1, settings.risk_monitor_interval_s)
        try:
            while True:
                body = risk.state().model_dump_json()
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


@router.get("/api/portfolio")
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


@router.get("/api/portfolio/history")
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


@router.get("/api/risk/limits")
async def risk_limits(_actor: str = Depends(trader_identity)) -> dict[str, float]:
    return settings.risk_limits_dict()


@router.post("/api/risk/kill")
async def engage_kill(req: KillSwitchRequest = Body(default=KillSwitchRequest()),
                      actor: str = Depends(trader_identity),
                      risk: RiskEngineManager = Depends(risk_engine_manager)) -> dict[str, Any]:
    kill = await risk.engage_kill(reason=req.reason, actor=actor, symbol=req.symbol)
    return {"kill_switch_active": kill.active, "halted_symbols": sorted(kill.halted_symbols),
            "reason": kill.reason, "actor": actor}


@router.post("/api/risk/resume")
async def release_kill(req: KillSwitchRequest = Body(default=KillSwitchRequest()),
                       actor: str = Depends(trader_identity),
                       risk: RiskEngineManager = Depends(risk_engine_manager)) -> dict[str, Any]:
    kill = await risk.release_kill(actor=actor, symbol=req.symbol, reason=req.reason)
    return {"kill_switch_active": kill.active, "halted_symbols": sorted(kill.halted_symbols),
            "reason": req.reason, "actor": actor}


@router.post("/api/risk/reduce-only")
async def toggle_reduce_only(req: ReduceOnlyRequest = Body(default=ReduceOnlyRequest()),
                             actor: str = Depends(trader_identity),
                             risk: RiskEngineManager = Depends(risk_engine_manager)) -> dict[str, Any]:
    state = await risk.set_reduce_only(enabled=req.enabled, actor=actor, reason=req.reason)
    return {"reduce_only": state.reduce_only, "reduce_only_source": state.reduce_only_source, "actor": actor}


@router.post("/api/risk/reset")
async def reset_book(
    actor: str = Depends(trader_identity),
    risk: RiskEngineManager = Depends(risk_engine_manager),
) -> dict[str, Any]:
    risk.reset_book(actor=actor)
    return {"ok": True, "actor": actor}
