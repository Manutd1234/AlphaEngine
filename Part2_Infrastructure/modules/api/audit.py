"""The append-only record: orders, risk events, backtests and execution stats.

Reads only. Nothing here writes to the ledger — the modules that make the
decisions do that, on the path where the decision is made, which is the whole
point of an audit log a route cannot edit.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api.deps import trader_identity
from modules.audit import get_audit

router = APIRouter(tags=["audit"])


@router.get("/api/audit/orders")
async def audit_orders(limit: int = Query(default=50, ge=1, le=500), _actor: str = Depends(trader_identity)) -> list[dict[str, Any]]:
    return get_audit().recent_orders(limit)


@router.get("/api/audit/events")
async def audit_events(limit: int = Query(default=50, ge=1, le=500), _actor: str = Depends(trader_identity)) -> list[dict[str, Any]]:
    return get_audit().recent_events(limit)


@router.get("/api/audit/backtests")
async def audit_backtests(limit: int = Query(default=20, ge=1, le=200), _actor: str = Depends(trader_identity)) -> list[dict[str, Any]]:
    return get_audit().recent_backtests(limit)


@router.get("/api/audit/stats")
async def audit_stats(_actor: str = Depends(trader_identity)) -> dict[str, Any]:
    return get_audit().execution_stats()
