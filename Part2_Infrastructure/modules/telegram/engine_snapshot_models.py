"""Immutable read models returned by Telegram's engine snapshot adapters.

The public import surface remains ``modules.telegram.engine_snapshots``.  This
module only gives the DTOs a cohesive home so the orchestration module stays
small enough to review as timeout and degraded-state behavior evolves.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MarketsSnapshot:
    state: str
    selected_series: str | None = None
    event_ticker: str | None = None
    event_title: str | None = None
    market_ticker: str | None = None
    yes_bid: str | None = None
    yes_ask: str | None = None
    spread: str | None = None
    basket_cost: str | None = None
    settlement_sources: tuple[str, ...] = ()
    observed_age_s: float | None = None
    detail: str | None = None


@dataclass(frozen=True)
class ProofsSnapshot:
    state: str
    universe_state: str | None = None
    certificate_state: str | None = None
    index_state: str | None = None
    selected_series: str | None = None
    event_ticker: str | None = None
    basket_cost: str | None = None
    verdict: str | None = None
    engine: str | None = None
    priced_out: bool | None = None
    worth_doing: bool | None = None
    witness_legs: int = 0
    worst_case_payoff: str | None = None
    gross_edge: str | None = None
    total_fees: str | None = None
    net_edge: str | None = None
    index_value: str | None = None
    index_measured: int = 0
    index_unmeasurable: int = 0
    observed_age_s: float | None = None
    detail: str | None = None


@dataclass(frozen=True)
class DiffusionSnapshot:
    state: str
    absorption_state: str | None = None
    episodes_state: str | None = None
    findings_state: str | None = None
    runs: int = 0
    closed_episodes: int = 0
    open_episodes: int = 0
    release_measured: int = 0
    release_no_signal: int = 0
    call_measured: int = 0
    call_no_signal: int = 0
    release_half_life_s: float | None = None
    call_half_life_s: float | None = None
    episode_median_s: str | None = None
    episode_median_reason: str | None = None
    gate_state: str | None = None
    gate_samples: int = 0
    gate_floor: float | None = None
    gate_r_squared: float | None = None
    findings_holds: int = 0
    findings_absent: int = 0
    observed_at: str | None = None
    detail: str | None = None


__all__ = ["DiffusionSnapshot", "MarketsSnapshot", "ProofsSnapshot"]
