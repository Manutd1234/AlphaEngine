"""Coherence over time: the index series, and the violation episodes it makes.

Split from ``modules/api/coherence.py`` when that file reached its length
ceiling, along the seam the two halves already had. The other module answers
"what is true of the exchange right now" — reachability, books, a certificate
for one family. This one answers "what has been true of it over time", which is
a question about the tape rather than about the venue, and it is where the
engine's second product lives: every violation episode is an information
arrival with an absorption time attached.

Both routers are exported from ``modules/api`` and registered together, so the
split is a file boundary rather than an API one.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api.deps import trader_identity
from modules.coherence.episodes import Episode, survival, verdict_for
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.kernel.money import format_dollars
from modules.coherence.recorder import episode_tracker
from modules.schemas import (
    CoherenceEpisode,
    CoherenceEpisodes,
    CoherenceEpisodeSample,
    CoherenceIndexPoint,
    CoherenceIndexSeries,
    CoherenceSurvivalPoint,
)

# Its own tag, not the sibling's. `tests/test_api_routers.py` holds one tag per
# router module so that "which file does this route live in" is answerable from
# /docs — sharing "coherence" across the two halves would make the split
# invisible exactly where someone would go looking for it.
router = APIRouter(tags=["coherence history"])


@router.get("/api/coherence/index", response_model=CoherenceIndexSeries)
async def coherence_index(
    series: str | None = Query(default=None, description="One series ticker, or every one recorded"),
    since_ts_ns: int = Query(default=0, ge=0),
    limit: int = Query(default=2000, ge=1, le=20_000),
    _actor: str = Depends(trader_identity),
) -> CoherenceIndexSeries:
    """The Coherence Index over time — how far quotes sit from consistency.

    Unmeasurable readings are returned as null rather than dropped. A series
    whose index is often null is telling you something real about its books
    (one-sided quotes in the tails), and filtering those rows out would turn a
    sparse, honest record into a dense, flattering one.
    """
    try:
        rows = get_store().index_series(series_ticker=series, since_ts_ns=since_ts_ns, limit=limit)
    except TapeUnavailable as exc:
        return CoherenceIndexSeries(state="unavailable", notes=[str(exc)])
    if not rows:
        return CoherenceIndexSeries(
            state="empty",
            notes=["nothing has been indexed yet; the recorder writes a reading on every poll"],
        )
    points = [
        CoherenceIndexPoint(
            ts_ns=int(row["ts_ns"]),
            series_ticker=str(row["series_ticker"]),
            event_ticker=str(row["event_ticker"]),
            exchange_index=int(row["exchange_index"] or 0),
            ci=None if row["ci"] is None else format_dollars(row["ci"]),
            engine=str(row["engine"]),
            detail=None if row["detail"] is None else str(row["detail"]),
        )
        for row in rows
    ]
    measured = sum(1 for point in points if point.ci is not None)
    return CoherenceIndexSeries(
        state="ok",
        points=points,
        series=sorted({point.series_ticker for point in points}),
        measured=measured,
        unmeasurable=len(points) - measured,
    )


@router.get("/api/coherence/episodes", response_model=CoherenceEpisodes)
async def coherence_episodes(
    series: str | None = Query(default=None, description="One series ticker, or every one recorded"),
    limit: int = Query(default=500, ge=1, le=5000),
    round_trip_s: str = Query(default="0.240", description="Your measured round trip, for the verdict"),
    _actor: str = Depends(trader_identity),
) -> CoherenceEpisodes:
    """Violation episodes and the survival curve they make.

    The honest gate on this whole engine, and the diffusion module's event
    sample: each episode is an information arrival with an absorption time
    attached. If the median lifetime is under the round trip, the opportunity
    was never available.
    """
    try:
        rows = get_store().episodes(series_ticker=series, limit=limit)
    except TapeUnavailable as exc:
        return CoherenceEpisodes(state="unavailable", notes=[str(exc)])

    episodes = [_episode_from(row) for row in rows]
    curve = survival([_tracked_from(row) for row in rows])
    try:
        round_trip = Decimal(round_trip_s)
    except (ArithmeticError, ValueError):
        round_trip = Decimal("0.240")

    return CoherenceEpisodes(
        state="ok" if episodes else "empty",
        episodes=episodes,
        open_episodes=len(episode_tracker().open_episodes),
        survival=[CoherenceSurvivalPoint(t_s=str(t), surviving=str(fraction)) for t, fraction in curve.points],
        median_s=None if curve.median_s is None else str(curve.median_s),
        median_withheld_reason=curve.reason,
        verdict=verdict_for(curve, round_trip),
        round_trip_s=str(round_trip),
        notes=[] if episodes else ["no violation has opened and closed yet; the recorder tracks them per poll"],
    )


def _tracked_from(row: dict[str, Any]) -> Episode:
    """A stored row back into the shape the survival curve reads."""
    return Episode(
        component_id=str(row["component_id"]),
        series_ticker=str(row["series_ticker"]),
        event_ticker=str(row["event_ticker"]),
        family=str(row["family"]),
        exchange_index=int(row["exchange_index"] or 0),
        opened_ts_ns=int(row["opened_ts_ns"]),
        closed_ts_ns=None if row["closed_ts_ns"] is None else int(row["closed_ts_ns"]),
        peak_ci=row["peak_ci"],
        peak_net_edge=row["peak_net_edge"],
    )


def _episode_from(row: dict[str, Any]) -> CoherenceEpisode:
    import json

    tracked = _tracked_from(row)
    samples = json.loads(row["samples"] or "[]")
    return CoherenceEpisode(
        component_id=tracked.component_id,
        series_ticker=tracked.series_ticker,
        event_ticker=tracked.event_ticker,
        family=tracked.family,
        exchange_index=tracked.exchange_index,
        opened_ts_ns=tracked.opened_ts_ns,
        closed_ts_ns=tracked.closed_ts_ns,
        lifetime_s=None if tracked.lifetime_s is None else str(tracked.lifetime_s),
        peak_ci=None if tracked.peak_ci is None else format_dollars(tracked.peak_ci),
        peak_net_edge_dollars=None if tracked.peak_net_edge is None else format_dollars(tracked.peak_net_edge),
        samples=[CoherenceEpisodeSample(ts_ns=int(s["ts_ns"]), ci=s.get("ci")) for s in samples],
    )
