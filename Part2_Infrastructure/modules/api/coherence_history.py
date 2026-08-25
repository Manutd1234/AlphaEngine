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
from modules.coherence import latency, tunables
from modules.coherence.episodes import Episode, survival, verdict_for
from modules.coherence.fs import calibration_store
from modules.coherence.fs.quotes_history import book_history, recorded_tickers
from modules.coherence.fs.replay import rows_from_store
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.kernel.money import format_dollars
from modules.coherence.recorder import episode_tracker
from modules.coherence.syscalls.replay import run
from modules.schemas import (
    CoherenceBookHistory,
    CoherenceBookHistoryPoint,
    CoherenceCalibrationHistory,
    CoherenceCalibrationPoint,
    CoherenceEpisode,
    CoherenceEpisodes,
    CoherenceEpisodeSample,
    CoherenceIndexPoint,
    CoherenceIndexSeries,
    CoherenceReplay,
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


@router.get("/api/coherence/calibration/history", response_model=CoherenceCalibrationHistory)
async def coherence_calibration_history(
    since_ts_ns: int = Query(default=0, ge=0),
    limit: int = Query(default=2000, ge=1, le=20_000),
    _actor: str = Depends(trader_identity),
) -> CoherenceCalibrationHistory:
    """The settled score over time — the Scorecard's missing time axis.

    ``/api/coherence/calibration`` scores whatever has settled and answers about
    one moment. It cannot answer the question a reader asks next, which is
    whether the venue is getting better, so the recorder writes a score on its
    own slow cadence and this is the tape of them.

    Here rather than beside ``/calibration`` on the lab router because that is
    the seam the two files already have: the lab answers what is true of the
    exchange NOW, this module what has been true of it over time.

    Two properties a reader is entitled to and a bare series would hide. The
    figures are nullable — a run against a corpus that would not score keeps its
    nulls and its reason, because a zero Brier is a perfect forecaster at the
    origin of every chart drawn afterwards. And the series accrues FORWARD ONLY:
    nothing back-fills it, so the first point is where the recorder started and
    not where the venue did.
    """
    try:
        rows = calibration_store.calibration_history(
            get_store(), since_ts_ns=since_ts_ns, limit=limit
        )
    except TapeUnavailable as exc:
        return CoherenceCalibrationHistory(state="unavailable", notes=[str(exc)])
    if not rows:
        return CoherenceCalibrationHistory(
            state="empty",
            notes=[
                "no score has been recorded yet; the recorder writes one on its own cadence, "
                "which is off until COHERENCE_CALIBRATION_EVERY_S is set"
            ],
        )
    points = [CoherenceCalibrationPoint(**row) for row in rows]
    refused = sum(1 for point in points if point.brier is None)
    notes = [
        "the series accrues forward only: it begins where the recorder began, "
        "not where the venue did"
    ]
    if refused:
        notes.append(
            f"{refused} of {len(points)} runs could not be scored and carry null figures "
            "with the reason, rather than a zero"
        )
    return CoherenceCalibrationHistory(state="ok", points=points, notes=notes)


@router.get("/api/coherence/episodes", response_model=CoherenceEpisodes)
async def coherence_episodes(
    series: str | None = Query(default=None, description="One series ticker, or every one recorded"),
    limit: int = Query(default=500, ge=1, le=5000),
    round_trip_s: str | None = Query(
        default=None,
        description="Override the round trip used for the verdict; omit to use this deployment's measured median",
    ),
    _actor: str = Depends(trader_identity),
) -> CoherenceEpisodes:
    """Violation episodes and the survival curve they make.

    The honest gate on this whole engine, and the diffusion module's event
    sample: each episode is an information arrival with an absorption time
    attached. If the median lifetime is under the round trip, the opportunity
    was never available.

    THE ROUND TRIP IS MEASURED NOW, and until 2026-08-26 it was not. It was a
    query parameter defaulting to "0.240" that nothing on the desk ever passed,
    so the gate above was decided by the gateway echoing its own default and the
    figure drew it as a timing. `latency` holds the median of the reads this
    deployment has actually made, and `round_trip_source` says which of the two
    the payload carries.

    WHAT IS MEASURED IS A READ, NOT AN ORDER. An order carries a signature, is
    written rather than read, and queues behind a matching engine, so it is at
    least as slow. The measured read is a LOWER BOUND, and a verdict computed
    from it is optimistic — it calls an opportunity tradeable slightly more
    often than a real order path would. Every surface drawing it has to say so.

    THE OTHER LIMIT ON THIS PAYLOAD, recorded here because a reader meets the
    verdict before they meet the recorder: an episode closes on the SECOND
    coherent poll (``episodes.POLLS_TO_CLOSE`` is 2), and ``closed_ts_ns`` is
    that second poll's stamp. So the shortest violation this tape can hold is
    two poll intervals — about ten minutes at a 300-second cadence — and every
    survival curve drawn from it is blind below that. It is not that short
    violations are rare here; it is that they cannot be recorded at all, which
    is a different claim and the one the figure has to make.
    """
    try:
        rows = get_store().episodes(series_ticker=series, limit=limit)
    except TapeUnavailable as exc:
        return CoherenceEpisodes(state="unavailable", notes=[str(exc)])

    episodes = [_episode_from(row) for row in rows]
    curve = survival([_tracked_from(row) for row in rows])

    # THE MEASUREMENT FIRST, AND THE PARAMETER ONLY AS AN OVERRIDE. This
    # argument used to default to "0.240", nothing on the desk ever passed it,
    # and the payload reported the gateway echoing its own default back as
    # though something had timed it — while `verdict_for` decided the engine's
    # honest gate against it. `latency` holds the median of the read round
    # trips this deployment has actually made.
    #
    # A read is a LOWER BOUND on an order, so a verdict from it is optimistic.
    # That is why `round_trip_source` travels with the number: a surface may
    # not present a measured read as the cost of trading, and it cannot know
    # which it has without being told.
    measured = latency.median_s()
    samples = latency.count()
    if round_trip_s is not None:
        try:
            round_trip, source = Decimal(round_trip_s), "assumed"
        except (ArithmeticError, ValueError):
            round_trip, source = (measured, "measured") if measured else (Decimal("0.240"), "assumed")
    elif measured is not None:
        round_trip, source = measured, "measured"
    else:
        round_trip, source = Decimal("0.240"), "assumed"

    return CoherenceEpisodes(
        state="ok" if episodes else "empty",
        episodes=episodes,
        open_episodes=len(episode_tracker().open_episodes),
        survival=[CoherenceSurvivalPoint(t_s=str(t), surviving=str(fraction)) for t, fraction in curve.points],
        median_s=None if curve.median_s is None else str(curve.median_s),
        median_withheld_reason=curve.reason,
        verdict=verdict_for(curve, round_trip),
        round_trip_s=str(round_trip),
        round_trip_source=source,
        round_trip_samples=samples if source == "measured" else 0,
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


@router.get("/api/coherence/replay", response_model=CoherenceReplay)
async def coherence_replay(
    since_ts_ns: int = Query(default=0, ge=0),
    limit: int = Query(default=20_000, ge=1, le=200_000),
    _actor: str = Depends(trader_identity),
) -> CoherenceReplay:
    """Run the engine over the recorded tape with parts of the model switched off.

    The ablation harness. Its question is not "how much would this have made" —
    a backtest of an arbitrage engine over its own quotes is close to worthless
    as a P&L estimate, because those quotes are what it would have traded
    against and it cannot have traded against all of them.

    Its question is which parts of the model change the answer. The gap between
    the ``no_fees`` row and the ``full`` row is how many opportunities the test
    that every bot in this space ships with reports and the real one rejects.
    """
    try:
        rows = rows_from_store(get_store(), since_ts_ns=since_ts_ns, limit=limit)
    except TapeUnavailable as exc:
        return CoherenceReplay(state="unavailable", notes=[str(exc)])
    if not rows:
        return CoherenceReplay(
            state="empty",
            notes=["the tape is empty; the recorder writes to it once COHERENCE_POLL_S is set"],
        )
    return CoherenceReplay(**run(rows))


@router.get("/api/coherence/books/history", response_model=CoherenceBookHistory)
async def coherence_books_history(
    ticker: str = Query(description="One market ticker, as the exchange spells it"),
    since_ts_ns: int = Query(default=0, ge=0),
    limit: int = Query(default=600, ge=1, le=20_000),
    _actor: str = Depends(trader_identity),
) -> CoherenceBookHistory:
    """One market's quotes over time — the first read of what the recorder bought.

    ``/books`` answers what a market is quoted at NOW, and every book pane on the
    desk draws that. This answers what it HAS been quoted at, off the same
    ``book_snapshots`` table, which the recorder has been filling since it was
    switched on and which nothing has ever read as a series. Depth is
    forward-only: a book nobody recorded at 14:32 cannot be recovered at 14:33
    from any endpoint, which is why the recorder runs before any strategy code
    exists. This is the first thing that spends it.

    FOUR ANSWERS, NEVER ONE EMPTY LIST, because every one of them reaches a
    reader as "no data" otherwise and only one of them is normal:

      * ``unavailable``   — the tape would not open. An outage, not an answer.
      * ``unconfigured``  — ``COHERENCE_POLL_S`` is unset, so the recorder has
        never run here and no deployment history exists to read. Distinct from
        an outage: nothing is broken, nothing was ever written.
      * ``empty``         — the tape is real and holds nothing for THIS market.
        The tickers it DOES hold come back in ``recorded``, so a reader who
        mistyped one is shown the list rather than left guessing whether the
        ticker was wrong or the recorder was off.
      * ``ok``            — a series, oldest first.

    The default limit is 600 rather than the 2,000 its siblings use, and the
    number is the cadence: at a fifteen-second recorder poll that is two and a
    half hours of one market, which is longer than the question "what has this
    been doing" ever reaches back for. A reader who wants more asks for it.
    """
    try:
        store = get_store()
        points = book_history(store, ticker=ticker, since_ts_ns=since_ts_ns, limit=limit)
    except TapeUnavailable as exc:
        return CoherenceBookHistory(state="unavailable", ticker=ticker, notes=[str(exc)])

    if not points:
        # THE TAPE IS ASKED BEFORE THE CONFIG, and that order is the whole of
        # this branch. The first version read `COHERENCE_POLL_S` first and
        # answered "unconfigured" whenever the recorder was off — which is
        # wrong on the commonest deployment there is: a tape recorded yesterday
        # with the recorder switched off today. Run against this desk's own
        # 43,302-row tape with polling disabled, it reported a deployment that
        # had "never recorded a book" while holding 2,992 markets.
        #
        # So the evidence decides. If the tape holds ANY book, the recorder has
        # run and an absence here is about this market. Only when the tape holds
        # nothing at all does the configuration get to say which kind of nothing
        # it is — never having been switched on, or switched on and not yet
        # having written.
        try:
            held = recorded_tickers(store)
        except TapeUnavailable as exc:
            return CoherenceBookHistory(state="unavailable", ticker=ticker, notes=[str(exc)])

        if held:
            return CoherenceBookHistory(
                state="empty",
                ticker=ticker,
                recorded=held,
                notes=[
                    f"the tape holds no book for {ticker}; it is not on the watchlist, "
                    "or nothing was recorded before this window"
                ],
            )

        if tunables.POLL_SECONDS <= 0 or not tunables.watchlist_configured():
            return CoherenceBookHistory(
                state="unconfigured",
                ticker=ticker,
                notes=[
                    "the recorder has never run on this deployment; set COHERENCE_POLL_S "
                    "and COHERENCE_SERIES to start writing the tape"
                ],
            )

        return CoherenceBookHistory(
            state="empty",
            ticker=ticker,
            notes=[
                "the recorder is configured and has written nothing yet; the first poll "
                "has not landed, or it has not reached this market"
            ],
        )

    return CoherenceBookHistory(
        state="ok",
        ticker=ticker,
        points=[CoherenceBookHistoryPoint(**point) for point in points],
    )
