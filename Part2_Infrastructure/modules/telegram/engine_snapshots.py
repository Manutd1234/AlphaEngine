"""Bounded, read-only snapshots for the three market-engine commands.

The adapters call the same Python read functions that back the browser routes.
They never call an HTTP localhost address and never reinterpret missing values
as zero.  Each read is independently contained so one store or provider can
fail while the command still returns the safe parts that answered.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from time import monotonic
from typing import Any, Awaitable, Callable, Generic, TypeVar

from modules.coherence import tunables, warm
from modules.coherence.episodes import MIN_EPISODES_FOR_HALF_LIFE
from modules.coherence.kernel.distribution import TAIL_TOLERANCE
from modules.telegram.engine_snapshot_models import DiffusionSnapshot, MarketsSnapshot, ProofsSnapshot

T = TypeVar("T")

# One typed command is bounded even when several independent read models are
# involved.  Tests can replace these constants without touching deployment
# settings, and no handler retries a failed read.
COMMAND_BUDGET_SECONDS = 8.0
PART_BUDGET_SECONDS = 6.0
SURVIVAL_MINIMUM = 2


# Lazy imports prevent the gateway's API package from importing Telegram while
# Telegram is still assembling its mixins.  These wrappers are also the narrow
# test seam: fixtures replace one read without booting a web or HTTP process.
async def _read_universe(**params):
    from modules.api.coherence import coherence_universe

    return await coherence_universe(**params)


async def _read_certificate(**params):
    from modules.api.coherence import coherence_certify

    return await coherence_certify(**params)


async def _read_index(**params):
    from modules.api.coherence_history import coherence_index

    return await coherence_index(**params)


async def _read_episodes(**params):
    from modules.api.coherence_history import coherence_episodes

    return await coherence_episodes(**params)


async def _read_absorption(**params):
    from modules.api.diffusion import diffusion_absorption

    return await diffusion_absorption(**params)


async def _read_findings(**params):
    from modules.api.diffusion import diffusion_findings

    return await diffusion_findings(**params)


@dataclass(frozen=True)
class ReadPart(Generic[T]):
    value: T | None
    state: str
    reason: str | None = None


class ReadBudget:
    """A shared monotonic deadline for all parts of one command."""

    def __init__(self, seconds: float = COMMAND_BUDGET_SECONDS) -> None:
        self.deadline = monotonic() + max(0.001, seconds)

    async def read(self, label: str, call: Callable[[], Awaitable[T]]) -> ReadPart[T]:
        remaining = self.deadline - monotonic()
        if remaining <= 0:
            return ReadPart(None, "timeout", f"{label} exceeded the command budget")
        try:
            value = await asyncio.wait_for(call(), timeout=min(PART_BUDGET_SECONDS, remaining))
        except TimeoutError:
            return ReadPart(None, "timeout", f"{label} exceeded the read budget")
        except Exception as exc:  # noqa: BLE001 - a contained read reports its class
            return ReadPart(None, "unavailable", f"{label} returned {type(exc).__name__}")
        return ReadPart(value, "ok")


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _first_note(value: Any) -> str | None:
    notes = getattr(value, "notes", None) or []
    return str(notes[0]) if notes else None


def _validated(part: ReadPart[T], label: str, *attributes: str) -> ReadPart[T]:
    value = part.value
    if value is None or all(hasattr(value, attribute) for attribute in attributes):
        return part
    return ReadPart(None, "invalid", f"{label} returned an invalid read model")


def _read_state(part: ReadPart[Any]) -> str:
    """Keep a subread's transport state distinct from its payload state."""
    if part.value is None:
        return part.state
    return str(getattr(part.value, "state", None) or part.state)


def _freshness(state: str, age_s: float | None) -> str:
    if state != "ok":
        return state
    if age_s is not None and age_s > warm.max_age_s():
        return "stale"
    return "fresh"


def _cheapest_event(universe: Any) -> Any | None:
    events = list(getattr(universe, "events", []) or [])
    priced = [
        (cost, event) for event in events
        if (cost := _decimal(getattr(event, "yes_ask_total", None))) is not None
    ]
    return min(priced, key=lambda item: item[0])[1] if priced else (events[0] if events else None)


def _valid_event(event: Any) -> bool:
    return all(hasattr(event, name) for name in (
        "event_ticker", "series_ticker", "title", "markets", "yes_ask_total", "settlement_sources"
    ))


async def markets_snapshot(series: str | None = None) -> MarketsSnapshot:
    budget = ReadBudget()
    part = await budget.read(
        "universe",
        lambda: _read_universe(series=series, max_events=4, _actor="telegram:markets"),
    )
    part = _validated(part, "universe", "state", "events", "watchlist", "observed_age_s")
    if part.value is None:
        return MarketsSnapshot(state=part.state, selected_series=series, detail=part.reason)

    universe = part.value
    event = _cheapest_event(universe)
    selected = series or (event.series_ticker if event else None) or next(
        iter(getattr(universe, "watchlist", []) or []), None
    )
    if event is None:
        return MarketsSnapshot(
            state=getattr(universe, "state", "empty"), selected_series=selected,
            observed_age_s=getattr(universe, "observed_age_s", None), detail=_first_note(universe),
        )
    if not _valid_event(event):
        return MarketsSnapshot(state="invalid", detail="universe contained an invalid event")

    markets = list(event.markets or [])
    market = markets[0] if markets else None
    state = _freshness(getattr(universe, "state", "ok"), universe.observed_age_s)
    if market is None and state == "fresh":
        state = "partial"
    return MarketsSnapshot(
        state=state, selected_series=selected, event_ticker=event.event_ticker,
        event_title=event.title, market_ticker=market.ticker if market else None,
        yes_bid=market.yes_bid if market else None, yes_ask=market.yes_ask if market else None,
        spread=market.spread if market else None, basket_cost=event.yes_ask_total,
        settlement_sources=tuple(event.settlement_sources),
        observed_age_s=universe.observed_age_s,
        detail=(market.unquoted_reason if market else None) or _first_note(universe),
    )


async def proofs_snapshot(series: str | None = None) -> ProofsSnapshot:
    budget = ReadBudget()
    universe_part, index_part = await asyncio.gather(
        budget.read("universe", lambda: _read_universe(
            series=series, max_events=4, _actor="telegram:proofs"
        )),
        budget.read("coherence index", lambda: _read_index(
            series=series, since_ts_ns=0, limit=200, _actor="telegram:proofs"
        )),
    )
    universe_part = _validated(
        universe_part, "universe", "state", "events", "watchlist", "observed_age_s"
    )
    index_part = _validated(index_part, "coherence index", "state", "points", "measured")
    universe = universe_part.value
    event = _cheapest_event(universe) if universe is not None else None
    if event is not None and not _valid_event(event):
        universe = event = None
        universe_part = ReadPart(None, "invalid", "universe contained an invalid event")
    certificate_part: ReadPart[Any]
    if universe is None:
        certificate_part = ReadPart(
            None,
            universe_part.state,
            universe_part.reason or "certificate needs a universe event",
        )
    elif event is None:
        certificate_part = ReadPart(None, "empty", _first_note(universe))
    else:
        certificate_part = await budget.read(
            "certificate",
            lambda: _read_certificate(
                event_ticker=event.event_ticker, max_contracts=1000, _actor="telegram:proofs"
            ),
        )
        certificate_part = _validated(
            certificate_part, "certificate", "verdict", "engine", "legs", "notes"
        )

    certificate = certificate_part.value
    index = index_part.value
    measured_points = [point for point in (getattr(index, "points", []) or []) if point.ci is not None]
    latest_ci = measured_points[-1].ci if measured_points else None
    age_s = getattr(universe, "observed_age_s", None)
    if certificate is not None:
        state = "partial" if certificate.verdict == "untestable" else _freshness("ok", age_s)
    elif universe is not None and event is None:
        state = getattr(universe, "state", "empty")
    elif index is not None:
        state = "partial"
    else:
        state = certificate_part.state if certificate_part.state != "empty" else universe_part.state

    detail = certificate_part.reason or universe_part.reason or index_part.reason
    if detail is None:
        detail = _first_note(certificate) or _first_note(universe) or _first_note(index)
    return ProofsSnapshot(
        state=state,
        universe_state=_read_state(universe_part),
        certificate_state=_read_state(certificate_part),
        index_state=_read_state(index_part),
        selected_series=series or (event.series_ticker if event else None),
        event_ticker=event.event_ticker if event else None,
        basket_cost=event.yes_ask_total if event else None,
        verdict=getattr(certificate, "verdict", None),
        engine=getattr(certificate, "engine", None),
        priced_out=getattr(certificate, "priced_out", None),
        worth_doing=getattr(certificate, "worth_doing", None),
        witness_legs=len(getattr(certificate, "legs", []) or []),
        worst_case_payoff=getattr(certificate, "worst_case_payoff", None),
        gross_edge=getattr(certificate, "gross_edge", None),
        total_fees=getattr(certificate, "total_fees", None),
        net_edge=getattr(certificate, "net_edge", None),
        index_value=latest_ci,
        index_measured=int(getattr(index, "measured", 0) or 0),
        index_unmeasurable=int(getattr(index, "unmeasurable", 0) or 0),
        observed_age_s=age_s,
        detail=detail,
    )


async def diffusion_snapshot() -> DiffusionSnapshot:
    budget = ReadBudget()
    absorption_part, episodes_part, findings_part = await asyncio.gather(
        budget.read("absorption", lambda: _read_absorption(
            limit=200, source_ref=None, _actor="telegram:diffusion"
        )),
        budget.read("episodes", lambda: _read_episodes(
            series=None, limit=500, round_trip_s=None, _actor="telegram:diffusion"
        )),
        budget.read("findings", lambda: _read_findings(_actor="telegram:diffusion")),
    )
    absorption_part = _validated(
        absorption_part, "absorption", "state", "runs", "stages", "observed_at"
    )
    episodes_part = _validated(
        episodes_part, "episodes", "state", "episodes", "open_episodes"
    )
    findings_part = _validated(
        findings_part, "findings", "state", "findings", "observed_at"
    )
    absorption, episodes, findings = (
        absorption_part.value, episodes_part.value, findings_part.value
    )
    stages = {stage.stage: stage for stage in (getattr(absorption, "stages", []) or [])}
    release, call = stages.get("release"), stages.get("call")
    gate = getattr(findings, "gate", None)
    finding_rows = list(getattr(findings, "findings", []) or [])
    runs = len(getattr(absorption, "runs", []) or [])
    closed = len(getattr(episodes, "episodes", []) or [])

    missing = [part for part in (absorption_part, episodes_part, findings_part) if part.value is None]
    payload_bad = any(
        getattr(value, "state", "ok") not in {"ok", "empty"}
        for value in (absorption, episodes, findings) if value is not None
    )
    if len(missing) == 3:
        state = "timeout" if all(part.state == "timeout" for part in missing) else "unavailable"
    elif missing or payload_bad:
        state = "partial"
    elif runs == 0 and closed == 0:
        state = "empty"
    else:
        state = "fresh"

    reason = next((part.reason for part in missing if part.reason), None)
    if reason is None:
        reason = next(
            (str(value.reason) for value in (absorption, findings) if getattr(value, "reason", None)),
            getattr(episodes, "median_withheld_reason", None),
        )
    observed = getattr(absorption, "observed_at", None) or getattr(findings, "observed_at", None)
    return DiffusionSnapshot(
        state=state,
        absorption_state=_read_state(absorption_part),
        episodes_state=_read_state(episodes_part),
        findings_state=_read_state(findings_part),
        runs=runs, closed_episodes=closed,
        open_episodes=int(getattr(episodes, "open_episodes", 0) or 0),
        release_measured=int(getattr(release, "measured", 0) or 0),
        release_no_signal=int(getattr(release, "no_signal", 0) or 0),
        call_measured=int(getattr(call, "measured", 0) or 0),
        call_no_signal=int(getattr(call, "no_signal", 0) or 0),
        release_half_life_s=getattr(release, "median_half_life_s", None),
        call_half_life_s=getattr(call, "median_half_life_s", None),
        episode_median_s=getattr(episodes, "median_s", None),
        episode_median_reason=getattr(episodes, "median_withheld_reason", None),
        gate_state=getattr(gate, "state", None), gate_samples=int(getattr(gate, "samples", 0) or 0),
        gate_floor=getattr(gate, "floor", None), gate_r_squared=getattr(gate, "r_squared", None),
        findings_holds=sum(row.verdict == "holds" for row in finding_rows),
        findings_absent=sum(row.verdict == "absent" for row in finding_rows),
        observed_at=observed.isoformat() if observed else None, detail=reason,
    )


def proof_method_note() -> str:
    """The exact numerical contract shown beside every proof snapshot."""
    return (
        f"tail tolerance {TAIL_TOLERANCE}; balance tick {tunables.BALANCE_PRECISION}; "
        f"configured taker coefficient {tunables.TAKER_RATE}"
    )


__all__ = [
    "COMMAND_BUDGET_SECONDS", "DiffusionSnapshot", "MarketsSnapshot", "ProofsSnapshot",
    "SURVIVAL_MINIMUM", "diffusion_snapshot", "markets_snapshot", "proof_method_note",
    "proofs_snapshot", "MIN_EPISODES_FOR_HALF_LIFE",
]
