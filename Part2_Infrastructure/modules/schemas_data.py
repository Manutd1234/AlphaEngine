"""Data operations — replay and backfill jobs, and their schedule.

Split out of ``modules/schemas.py``; field order is a wire contract.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from modules.schemas_backtest import JobStatus

# --------------------------------------------------------------------------- #
# Data operations — replay and backfill jobs, and their schedule
# --------------------------------------------------------------------------- #
DataCapability = Literal["quote", "bars", "news", "fundamentals"]
DataInterval = Literal["15m", "1h", "4h", "1d"]


class DataReplayRequest(BaseModel):
    """Re-run one capability through the web workspace's validated fetch path,
    bypassing its cache, and record the contract result in the quality ledger."""

    symbol: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")
    capability: DataCapability = "quote"
    interval: DataInterval = "4h"
    bars: int = Field(default=120, ge=10, le=1000)


class DataBackfillRequest(BaseModel):
    """Fetch bars for a date range, contract-check them, merge into the bar cache."""

    symbol: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-]+$")
    interval: DataInterval = "1h"
    from_at: datetime
    to_at: datetime

    @model_validator(mode="after")
    def _range_is_sane(self) -> "DataBackfillRequest":
        if self.from_at >= self.to_at:
            raise ValueError("from_at must be before to_at")
        return self


class DataJobAccepted(BaseModel):
    job_id: str
    kind: Literal["data.replay", "data.backfill", "ml.fit"]  # ml.fit: same queue, same model
    status: str
    backend: str
    poll: str


class DataJobView(JobStatus):
    params: dict[str, Any] = Field(default_factory=dict)
    actor: str = ""
    # The job's own summary once succeeded (rows are never echoed);
    # ``persisted_at`` appears inside it once the completion hook has written.
    summary: dict[str, Any] | None = None


class DataJobsResponse(BaseModel):
    observed_at: datetime
    backend: str
    #: True when this process still holds every job it is reporting. It goes
    #: false once the list has been topped up from the audit log — which happens
    #: after a restart, and is the difference between "no job has ever run" and
    #: "this process has not run one".
    retained_in_process: bool
    executor_configured: bool
    #: Jobs whose row came from the durable audit log rather than memory. A
    #: restored row has no progress, no message and no summary: only what
    #: `record_job` writes at terminal state.
    restored_from_audit: int = 0
    jobs: list[DataJobView]


class DataScheduleView(BaseModel):
    id: str
    kind: Literal["replay", "backfill"]
    expression: str
    valid: bool
    cadence: str
    next_due_at: datetime | None
    last_run_at: datetime | None
    last_job_id: str | None
    last_outcome: str | None
    error: str | None


class DataSchedulesResponse(BaseModel):
    observed_at: datetime
    tick_seconds: float
    executor_configured: bool
    max_backfill_bars: int
    schedules: list[DataScheduleView]
