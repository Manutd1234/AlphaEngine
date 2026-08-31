"""Typed process graph assembled by the FastAPI lifespan.

The gateway's concrete adapters remain the existing singletons behind narrow
application services.  This module gives routes one immutable graph instead of
letting each request rediscover clients, stores, and executors.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol

from modules.application_services import (
    ExecutionGatewayService,
    MarketDataProvider,
    RiskEngineManager,
)


class RuntimePort(Protocol):
    def status(self) -> dict[str, Any]: ...


class MarketDataPort(Protocol):
    def health(self) -> dict[str, Any]: ...


class RiskEnginePort(Protocol):
    def state(self) -> Any: ...

    def decision_core_status(self) -> dict[str, Any]: ...


class JobQueuePort(Protocol):
    def stats(self) -> dict[str, Any]: ...


class AuditPort(Protocol):
    backend: str
    db_path: Any

    def runtime_health(self) -> dict[str, Any]: ...


class TelegramPort(Protocol):
    def health(self) -> dict[str, Any]: ...


class StreamPort(Protocol):
    def status(self) -> dict[str, Any]: ...


class HealthUseCase(Protocol):
    def snapshot(self) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class ApplicationContext:
    """One immutable set of process-owned adapters and application services."""

    runtime: RuntimePort
    market_data: MarketDataProvider
    execution_gateway: ExecutionGatewayService
    risk_engine: RiskEngineManager
    jobs: JobQueuePort
    audit: AuditPort
    telegram: TelegramPort
    health: HealthUseCase
    book_stream: StreamPort


@dataclass(frozen=True, slots=True)
class ApplicationMetadata:
    name: str
    version: str
    environment: str
    backtest_engine: str


class HealthService:
    """Compose local dependency state without making provider/network calls."""

    def __init__(
        self,
        *,
        runtime: RuntimePort,
        market_data: MarketDataPort,
        risk_engine: RiskEnginePort,
        jobs: JobQueuePort,
        audit: AuditPort,
        telegram: TelegramPort,
        book_stream: StreamPort,
        metadata: ApplicationMetadata,
        writer_status: Callable[[], dict[str, Any]],
    ) -> None:
        self._runtime = runtime
        self._market_data = market_data
        self._risk = risk_engine
        self._jobs = jobs
        self._audit = audit
        self._telegram = telegram
        self._book_stream = book_stream
        self._metadata = metadata
        self._writer_status = writer_status

    def snapshot(self) -> dict[str, Any]:
        """Return cached/in-process observations only; never wait on a provider."""
        state = self._risk.state()
        decision_core = self._risk.decision_core_status()
        runtime = self._runtime.status()
        audit_health = self._audit.runtime_health()
        writer = self._writer_status()
        ready = bool(runtime["ready"] and audit_health["writable"] and writer["held"] and writer["enforced"])
        return {
            "status": "halted" if state.kill_switch_active else "ok",
            "app": self._metadata.name,
            "version": self._metadata.version,
            "environment": self._metadata.environment,
            "ready": ready,
            "readiness": {
                "state": "ready" if ready else "not_ready",
                "runtime": runtime,
                "audit": audit_health,
                "single_writer": writer,
                "streams": {"book": self._book_stream.status()},
            },
            "modules": {
                "A_tca": self._market_data.health(),
                "B_risk": self._risk_state(state, decision_core),
                "C_backtest": {**self._jobs.stats(), "engine": self._metadata.backtest_engine},
            },
            "telegram": self._telegram.health(),
            "audit": {
                "backend": self._audit.backend,
                "path": str(self._audit.db_path),
                **audit_health,
            },
        }

    @staticmethod
    def _risk_state(state: Any, decision_core: dict[str, Any]) -> dict[str, Any]:
        return {
            "kill_switch_active": state.kill_switch_active,
            "halted_symbols": state.halted_symbols,
            "orders_accepted": state.orders_accepted,
            "orders_rejected": state.orders_rejected,
            "drawdown_budget_used_pct": round(state.drawdown_budget_used_pct, 4),
            "decision_engine": decision_core["selected"],
            "decision_engine_configured": decision_core["configured"],
            "decision_engine_effective": decision_core["effective"],
            "decision_engine_fallback_reason": decision_core["fallback_reason"],
            "decision_engine_fallback_total": decision_core["fallback_total"],
            "decision_engine_fallback_counts": decision_core["fallback_counts"],
            "decision_core_abi_version": decision_core["abi_version"],
            "decision_core_build_id": decision_core["build_id"],
        }
