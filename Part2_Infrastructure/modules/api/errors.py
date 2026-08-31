"""Stable, human-safe failure responses emitted at gateway boundaries."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from modules.backend_runtime import BackendBoundaryError, RequestBudget


class ErrorBudget(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    budget_class: str = Field(alias="class")
    limit_ms: int = Field(alias="limitMs")
    consumed_ms: int = Field(alias="consumedMs")
    remaining_ms: int = Field(alias="remainingMs")
    queue_ms: float = Field(alias="queueMs")
    blocking_ms: float = Field(alias="blockingMs")


class BackendErrorEnvelope(BaseModel):
    code: str
    owner: str = "backend_runtime"
    boundary: str
    error: str
    retryable: bool
    action: str
    dependency: str
    observed_at: str = Field(alias="observedAt")
    last_good_at: str | None = Field(default=None, alias="lastGoodAt")
    state: str = "unavailable"
    stale: bool = False
    partial: bool = False
    fallback: bool = False
    trace_id: str = Field(alias="traceId")
    request_id: str = Field(alias="requestId")
    endpoint_class: str = Field(alias="endpointClass")
    budget: ErrorBudget

    model_config = ConfigDict(populate_by_name=True)


def backend_error_payload(
    exc: BackendBoundaryError,
    budget: RequestBudget,
    *,
    deadline: bool,
) -> dict[str, Any]:
    """Serialize only bounded metadata; exception detail never crosses HTTP."""
    message = (
        "The gateway exhausted the propagated request budget."
        if deadline
        else "The gateway read pool is temporarily saturated."
    )
    envelope = BackendErrorEnvelope(
        code="backend_deadline_exceeded" if deadline else "backend_saturated",
        boundary=exc.boundary,
        error=message,
        retryable=True,
        action="retry_with_backoff",
        dependency=exc.dependency,
        observedAt=datetime.now(timezone.utc).isoformat(),
        traceId=budget.request_id,
        requestId=budget.request_id,
        endpointClass=budget.budget_class,
        budget=ErrorBudget(
            **{
                "class": budget.budget_class,
                "limitMs": budget.limit_ms,
                "consumedMs": budget.consumed_ms(),
                "remainingMs": round(budget.remaining_s() * 1_000),
                "queueMs": round(budget.queue_wait_ms, 3),
                "blockingMs": round(budget.blocking_ms, 3),
            }
        ),
    )
    return envelope.model_dump(mode="json", by_alias=True)
