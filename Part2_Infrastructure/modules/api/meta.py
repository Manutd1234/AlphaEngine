"""Meta: liveness, metrics, the operations snapshot and the client config.

Everything here answers "is this gateway working, and what is it configured
to do" rather than moving any trading state. ``/health`` and ``/metrics`` are
deliberately unauthenticated; the rest resolve an actor first.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from config import settings
from modules.api.deps import trader_identity
from modules.audit import get_audit
from modules.backtester import VECTORBT_AVAILABLE
from modules.data_quality import get_data_quality, publish_escalation
from modules.decision_core import ENGINE as DECISION_ENGINE
from modules.jobs import get_queue
from modules.metrics import render_metrics
from modules.operations import OperationsSnapshot, build_operations_snapshot
from modules.risk_proxy import get_gateway
from modules.supabase_mirror import get_mirror
from modules.tca_engine import get_engine
from modules.telegram import get_bot
from modules.web_telemetry import WebStateSyncRequest, WebStateView, get_web_ops

router = APIRouter(tags=["meta"])


@router.get("/health")
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


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> PlainTextResponse:
    """Prometheus text exposition of the same state ``/health`` reports.

    Unauthenticated, like ``/health``: a scrape target that needs a credential
    is a scrape target that silently stops working, and this exposes no more
    than the health endpoint already does. A deployment that wants the metrics
    private restricts ``/metrics`` at the reverse proxy, where the rest of its
    ingress policy already lives.
    """
    return PlainTextResponse(render_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")


@router.get("/api/ops/snapshot", response_model=OperationsSnapshot)
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


@router.post("/api/ops/web-state/sync", response_model=WebStateView)
async def web_state_sync(
    request: WebStateSyncRequest,
    _actor: str = Depends(trader_identity),
) -> WebStateView:
    """Merge one web instance's telemetry deltas and return the shared view.

    The Vercel workspace runs on rotating serverless instances whose in-memory
    ledgers disagree; this gateway is the one long-lived process they share.
    Push and pull happen in a single round trip so a health poll pays exactly
    one extra request. Observability only — no trading state passes this way.

    Contract findings in the same body are persisted by the data-quality
    ledger; any escalation they open is delivered on a task of its own so the
    round trip never pays for a chat.
    """
    opened = get_data_quality().ingest(request.findings, instance=request.instance)
    view = get_web_ops().sync(request)
    for escalation in opened:
        asyncio.create_task(publish_escalation(escalation))
    return view


@router.get("/api/config")
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
