"""Application services between transport handlers and domain engines.

The underlying ``RiskGateway`` and ``TCAEngine`` remain the authoritative
domain objects.  These narrow facades give FastAPI routes lifespan-owned,
replaceable use-case boundaries without copying gate, execution, or market
analytics logic into the transport layer.
"""

from __future__ import annotations

from typing import Any, Protocol

from modules.schemas import (
    OrderAck,
    OrderRequest,
    ReplaceRequest,
    RiskDecision,
    RiskState,
    TCAReport,
    VenueBook,
    WorkingOrder,
)


class _MarketDataEngine(Protocol):
    def health(self) -> dict[str, Any]: ...

    def get_books(self, symbol: str, depth: int = 20) -> list[VenueBook]: ...

    def consolidated_mid(self, symbol: str) -> float | None: ...

    def venues_online(self, symbol: str) -> list[str]: ...

    def tca_report(
        self, symbol: str, side: str = "BUY", notional: float | None = None,
    ) -> TCAReport: ...


class _ExecutionGateway(Protocol):
    async def submit(self, req: OrderRequest, source: str = "api") -> RiskDecision: ...

    def list_working(self, symbol: str | None = None) -> list[WorkingOrder]: ...

    async def cancel_working(
        self, order_id: str, actor: str = "api", reason: str = "",
    ) -> OrderAck | None: ...

    async def replace_working(
        self, order_id: str, req: ReplaceRequest, actor: str = "api",
    ) -> RiskDecision | None: ...


class _RiskGateway(Protocol):
    def state(self) -> RiskState: ...

    def decision_core_status(self) -> dict[str, Any]: ...

    async def trigger_kill(
        self, reason: str, actor: str, symbol: str | None = None,
    ) -> Any: ...

    async def release_kill(
        self, actor: str, symbol: str | None = None, reason: str | None = None,
    ) -> Any: ...

    async def set_reduce_only(
        self, enabled: bool, actor: str = "operator", reason: str = "",
    ) -> RiskState: ...

    def reset_book(self, actor: str = "api") -> None: ...


class MarketDataProvider:
    """Read-only market-book and TCA use cases backed by ``TCAEngine``."""

    def __init__(self, engine: _MarketDataEngine) -> None:
        self._engine = engine

    def health(self) -> dict[str, Any]:
        return self._engine.health()

    def get_books(self, symbol: str, *, depth: int = 20) -> list[VenueBook]:
        return self._engine.get_books(symbol, depth=depth)

    def consolidated_mid(self, symbol: str) -> float | None:
        return self._engine.consolidated_mid(symbol)

    def venues_online(self, symbol: str) -> list[str]:
        return self._engine.venues_online(symbol)

    def tca_report(
        self, symbol: str, side: str = "BUY", notional: float | None = None,
    ) -> TCAReport:
        return self._engine.tca_report(symbol, side, notional)


class ExecutionGatewayService:
    """Order submission and working-order lifecycle use cases."""

    def __init__(self, gateway: _ExecutionGateway) -> None:
        self._gateway = gateway

    async def submit(self, order: OrderRequest, *, actor: str) -> RiskDecision:
        return await self._gateway.submit(order, source=actor)

    def list_working(self, symbol: str | None = None) -> list[WorkingOrder]:
        return self._gateway.list_working(symbol)

    async def cancel(
        self, order_id: str, *, actor: str, reason: str,
    ) -> OrderAck | None:
        return await self._gateway.cancel_working(order_id, actor=actor, reason=reason)

    async def replace(
        self, order_id: str, request: ReplaceRequest, *, actor: str,
    ) -> RiskDecision | None:
        return await self._gateway.replace_working(order_id, request, actor=actor)


class RiskEngineManager:
    """Published risk state and operator risk-control use cases."""

    def __init__(self, gateway: _RiskGateway) -> None:
        self._gateway = gateway

    def state(self) -> RiskState:
        return self._gateway.state()

    def decision_core_status(self) -> dict[str, Any]:
        return self._gateway.decision_core_status()

    async def engage_kill(
        self, *, reason: str, actor: str, symbol: str | None = None,
    ) -> Any:
        return await self._gateway.trigger_kill(reason=reason, actor=actor, symbol=symbol)

    async def release_kill(
        self, *, actor: str, symbol: str | None = None, reason: str | None = None,
    ) -> Any:
        return await self._gateway.release_kill(actor=actor, symbol=symbol, reason=reason)

    async def set_reduce_only(
        self, *, enabled: bool, actor: str, reason: str,
    ) -> RiskState:
        return await self._gateway.set_reduce_only(enabled=enabled, actor=actor, reason=reason)

    def reset_book(self, *, actor: str) -> None:
        self._gateway.reset_book(actor=actor)
