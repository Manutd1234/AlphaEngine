"""Wire models for the diffusion section. Field order is the contract.

Every response carries a `state` before its payload, because the four ways a
calendar can be empty are four different things an operator does something
about: nothing configured, the store unreachable, the store readable and empty,
and the store readable with rows that do not match the filter. A list on its
own says none of that, so no list here travels without one.

Nothing nullable defaults to zero. `bars: int | None` means "not asked", never
"asked and got none"; `half_life_s: float | None` carries its own state and
reason beside it rather than a sentinel.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ReadState = Literal["ok", "unconfigured", "unavailable", "unreadable"]
EventKind = Literal["earnings", "fomc", "macro"]
StageSource = Literal["vendor", "fed_seed", "estimated_offset", "parsed_release", "recorded"]
CellState = Literal["ok", "pending", "uncaptured", "insufficient", "unavailable"]
SignalState = Literal["ok", "no_signal", "insufficient_pre_window", "unavailable"]


class DiffusionEvent(BaseModel):
    """One announcement, with both of its stages and the clock that saw them."""

    source_ref: str
    kind: EventKind
    symbol: str | None = None
    title: str
    release_at: datetime
    release_at_source: StageSource
    release_timing: str | None = None
    call_at: datetime | None = None
    call_at_source: StageSource | None = None
    call_offset_min: float | None = None
    first_seen_at: datetime
    revised_count: int = 0
    eps_estimate: float | None = None
    eps_actual: float | None = None
    surprise_pct: float | None = None
    scheduled: bool = True
    verified_at: datetime | None = None
    statement_url: str | None = None


class DiffusionEventsResponse(BaseModel):
    observed_at: datetime
    state: ReadState
    backend: str | None = None
    #: True when the window held more rows than the limit returned. A list that
    #: was cut short and does not say so reads as a complete answer.
    truncated: bool = False
    events: list[DiffusionEvent] = Field(default_factory=list)
    reason: str | None = None


class DiffusionStageRecord(BaseModel):
    """An observed second-stage start, replacing an assumed one."""

    at: datetime
    source: Literal["recorded", "parsed_release"] = "recorded"
    note: str | None = None


class DiffusionEventResponse(BaseModel):
    observed_at: datetime
    state: Literal["ok", "not_found", "unconfigured", "unavailable", "unreadable"]
    event: DiffusionEvent | None = None
    reason: str | None = None


class DiffusionHorizonCell(BaseModel):
    """One cell of the horizon table, including the ones that are not numbers."""

    horizon: str
    state: CellState
    abnormal_return: float | None = None
    absorbed: float | None = None
    bars: int | None = None
    reason: str | None = None


class DiffusionStageRun(BaseModel):
    """One measured stage of one announcement on one asset."""

    run_id: str
    source_ref: str
    symbol: str
    stage: Literal["release", "call"]
    interval: str
    signal_state: SignalState
    signal_reason: str | None = None
    t0: datetime
    terminal_return: float | None = None
    half_life_s: float | None = None
    half_life_state: str | None = None
    half_life_vol: float | None = None
    control_percentile: float | None = None
    controls_used: int = 0
    measured_horizons: int = 0
    of_horizons: int = 0
    market_adjusted: bool = False
    data_hash: str | None = None
    params_version: str
    cells: list[DiffusionHorizonCell] = Field(default_factory=list)


class DiffusionStageSummary(BaseModel):
    """What one stage looks like across every event measured."""

    stage: Literal["release", "call"]
    measured: int = 0
    no_signal: int = 0
    other: int = 0
    median_half_life_s: float | None = None
    median_control_percentile: float | None = None
    reason: str | None = None


class DiffusionAbsorptionResponse(BaseModel):
    observed_at: datetime
    state: ReadState
    backend: str | None = None
    truncated: bool = False
    #: Mean absorbed fraction at each horizon, per stage — the decay curve.
    horizons: list[str] = Field(default_factory=list)
    release_curve: list[float | None] = Field(default_factory=list)
    call_curve: list[float | None] = Field(default_factory=list)
    stages: list[DiffusionStageSummary] = Field(default_factory=list)
    runs: list[DiffusionStageRun] = Field(default_factory=list)
    reason: str | None = None
