"""Kalshi coherence: read the exchange, price the baskets, report the state.

Every route here is a GET and there is no write path in this module. That is
not an oversight to be filled in later — the engine's argument is that the
detection is the hard part and the tape is the asset, so this version reads,
records and certifies, and the order plan it produces is rendered rather than
sent.

Routes report a ``state`` discriminator rather than an empty payload, because
"the watchlist is empty", "Kalshi refused us" and "every basket is coherent"
are three different answers and a caller that cannot distinguish them cannot
respond to any of them.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api.deps import trader_identity
from modules.backend_runtime import current_request_budget
from modules.coherence import fee_meta, tunables, warm
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.kernel.book import parse_orderbook
from modules.coherence.kernel.certificate import Certificate
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.money import MoneyError, parse_dollars, parse_fp
from modules.coherence.series_meta import CONCURRENT_SERIES_READS, categories_for
from modules.coherence.status_read import read_status
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.fees import worked_example
from modules.coherence.syscalls.live_universe import observe_live_families
from modules.coherence.syscalls.observe import observe_event, observe_series
from modules.coherence.views import book_view, event_view
from modules.schemas import (
    CoherenceBooks,
    CoherenceBookView,
    CoherenceCertificate,
    CoherenceFees,
    CoherenceStatus,
    CoherenceUniverse,
)

router = APIRouter(tags=["coherence"])

# Below the same-origin gateway's 25-second H4 ceiling. The numerical solver is
# additionally given its own shorter HiGHS limit; this outer bound also covers
# a cold SciPy import and guarantees a typed answer rather than a proxy 504.
CERTIFY_SOLVE_DEADLINE_S = 15.0
CERTIFY_RESPONSE_MARGIN_S = 1.25


def certify_solve_deadline_s() -> float:
    """Leave enough of the caller's propagated H4 budget to encode the answer."""
    budget = current_request_budget()
    if budget is None:
        return CERTIFY_SOLVE_DEADLINE_S
    return min(CERTIFY_SOLVE_DEADLINE_S, max(0.0, budget.remaining_s() - CERTIFY_RESPONSE_MARGIN_S))


async def bounded_certify(
    observation: Any, schedule: FeeSchedule, *, max_contracts: Decimal | None = None,
) -> Certificate:
    """Run the synchronous solver away from the event loop and fail typed on its deadline."""
    deadline = certify_solve_deadline_s()
    try:
        if deadline <= 0:
            raise TimeoutError
        return await asyncio.wait_for(
            asyncio.to_thread(certify, observation, schedule, max_contracts=max_contracts),
            timeout=deadline,
        )
    except TimeoutError:
        return Certificate(
            verdict="untestable", engine="highs", component_id=observation.event.event_ticker,
            series_ticker=observation.event.series_ticker, exchange_index=observation.event.exchange_index,
            notes=[f"the solver did not answer within {deadline:g}s; "
                   "the gateway stayed available and no verdict was inferred"],
        )

@router.get("/api/coherence/status", response_model=CoherenceStatus)
async def coherence_status(_actor: str = Depends(trader_identity)) -> CoherenceStatus:
    """Is any of this real right now — and if not, which part is not.

    Reads the exchange's own status rather than reporting on our intentions.
    The schema probe is the load-bearing one: Kalshi removed the integer-cent
    fields in March 2026, and a client written against them parses today's
    payloads into a book of zeros without raising anything. "Every price is
    zero" is not a state a reader should have to diagnose from a chart.
    """
    return await read_status(tunables.SERIES_WATCHLIST)


async def _broad_live_universe(limit: int) -> CoherenceUniverse:
    """One broad page, rendered without per-series metadata requests."""
    try:
        batch = await observe_live_families(KalshiClient(), limit)
    except KalshiUnavailable as exc:
        return CoherenceUniverse(state="unavailable", watchlist=["kalshi:open"], notes=[exc.reason])
    observations = batch.observations
    categories = {
        item.event.series_ticker: item.event.category
        for item in observations
        if item.event.category
    }
    return CoherenceUniverse(
        state="ok" if observations else ("unavailable" if batch.notes else "empty"),
        events=[event_view(item) for item in observations],
        watchlist=list(dict.fromkeys(item.event.series_ticker for item in observations)),
        categories=categories,
        notes=list(dict.fromkeys([
            *batch.notes,
            *(note for item in observations for note in item.notes),
        ])),
    )


@router.get("/api/coherence/universe", response_model=CoherenceUniverse)
async def coherence_universe(
    series: str | None = Query(default=None, description="One series ticker; defaults to the whole watchlist"),
    max_events: int = Query(default=6, ge=1, le=50),
    family_limit: int = Query(default=200, ge=1, le=200, description="Maximum open families in broad live mode"),
    _actor: str = Depends(trader_identity),
) -> CoherenceUniverse:
    """The watched families, priced, with each basket's total stated.

    The basket totals are the engine's thesis in miniature: for a mutually
    exclusive event, buying every outcome buys a guaranteed dollar, so what it
    costs is a direct reading of whether the family is coherent.
    """
    broad_live = series is None and tunables.LIVE_FAMILY_LIMIT > 0
    effective_family_limit = min(family_limit, tunables.LIVE_FAMILY_LIMIT) if broad_live else None
    watchlist = [series] if series else list(tunables.SERIES_WATCHLIST)
    if broad_live:
        watchlist = ["kalshi:open"]
    if not watchlist:
        return CoherenceUniverse(
            state="unconfigured",
            watchlist=[],
            notes=["no families are being watched; set COHERENCE_LIVE_FAMILIES, COHERENCE_SERIES, or pass ?series="],
        )

    warm_params = {"max_events": max_events}
    if effective_family_limit is not None:
        warm_params["family_limit"] = effective_family_limit
    held = None if series else warm.snapshot_for("universe", **warm_params)
    if held is not None:
        return held.value.model_copy(update={"observed_age_s": round(held.age_s(), 1)})

    if effective_family_limit is not None:
        return await _broad_live_universe(effective_family_limit)

    client = KalshiClient()
    events = []
    notes: list[str] = []

    # CONCURRENT ACROSS SERIES, and it was serial until 2026-08-25 — which is
    # most of why this route measured 6.7 seconds. `observe_series` already
    # parallelises the events WITHIN a series behind its own semaphore
    # (`observe.py:135-152`); nothing was doing the same across the watchlist,
    # so two series meant two full passes end to end for work that shares no
    # state. Order is preserved by gathering into a list and reading it back in
    # watchlist order, because the events a reader sees should not depend on
    # which series answered first.
    # BOUNDED, and the bound is not decoration. `observe_series` already runs up
    # to CONCURRENT_EVENT_READS events at once WITHIN a series, so gathering
    # across an unbounded watchlist multiplies the two. The read budget bursts
    # at 100 tokens and a default call costs 10 — ten calls — so a wide enough
    # watchlist would exhaust it in one pass and take refusals rather than
    # answers. Measured on 2026-08-25: a benchmark firing four routes back to
    # back with no gap took eight refusals, which is what this bound is for.
    gate = asyncio.Semaphore(CONCURRENT_SERIES_READS)

    async def read_series(series_ticker: str) -> tuple[list[Any], list[str]]:
        try:
            async with gate:
                observations = await observe_series(client, series_ticker, max_events=max_events)
        except KalshiUnavailable as exc:
            return [], [f"{series_ticker} could not be read: {exc.reason}"]
        return (
            [event_view(observation) for observation in observations],
            [note for observation in observations for note in observation.notes],
        )

    for series_events, series_notes in await asyncio.gather(
        *(read_series(ticker) for ticker in watchlist)
    ):
        events.extend(series_events)
        notes.extend(series_notes)

    state = "ok" if events else ("unavailable" if notes else "empty")
    # What each series is ABOUT, so the surface can cut the families by asset
    # rather than by ticker prefix. Read once per series for the life of the
    # process — a category is a property of the contract, not of its state — so
    # this costs nothing on any poll after the first and nothing at all for a
    # watchlist that was already read. Never raises; a series the exchange
    # would not answer for is simply absent, and the surface says how many.
    categories = await categories_for(client, [event.series_ticker for event in events])
    unlabelled = {event.series_ticker for event in events} - set(categories)
    if unlabelled:
        notes.append(
            f"no category published for {', '.join(sorted(unlabelled))}; "
            "those families are grouped as unlabelled rather than guessed at"
        )
    # De-duplicated, order kept. Every observation of a series carries that
    # series' "read the first N events" note, so a two-event read reported the
    # same sentence twice — noise to a reader, and a duplicate React key to the
    # list that renders it.
    return CoherenceUniverse(
        state=state, events=events, watchlist=watchlist,
        categories=categories, notes=list(dict.fromkeys(notes)),
    )


@router.get("/api/coherence/books", response_model=CoherenceBooks)
async def coherence_books(
    event_ticker: str | None = Query(default=None, description="Read one event's books live"),
    tickers: str | None = Query(default=None, description="Comma-separated tickers to read from the tape"),
    _actor: str = Depends(trader_identity),
) -> CoherenceBooks:
    """Books, from the tape when it has them and live when it does not.

    ``origin`` says which, every time. A book read from the tape is as of when
    it was recorded, and a reader deciding anything on a stale ladder deserves
    to know that before they look at the numbers rather than after.
    """
    if event_ticker:
        held = warm.observation_for(event_ticker)
        try:
            observation = held.value if held is not None else await observe_event(KalshiClient(), event_ticker)
        except KalshiUnavailable as exc:
            return CoherenceBooks(state="unavailable", origin="kalshi", notes=[exc.reason])
        return CoherenceBooks(
            state="ok" if observation.markets else "empty",
            origin="shared-live" if held is not None else "kalshi",
            books=[book_view(item.book, source=f"kalshi:{observation.depth}", ts_ns=observation.ts_ns) for item in observation.markets],
            notes=observation.notes,
        )

    wanted = [t.strip() for t in (tickers or "").split(",") if t.strip()]
    try:
        rows = get_store().latest_books(tickers=wanted or None)
    except TapeUnavailable as exc:
        return CoherenceBooks(state="unavailable", origin="tape", notes=[str(exc)])
    if not rows:
        # TWO EMPTIES, TOLD APART. A cold tape and a filter that matched nothing
        # are different answers, and they used to share one sentence — the one
        # naming `COHERENCE_POLL_S`. That is true of a cold tape and false of a
        # tape holding twenty-five thousand snapshots when the caller asked for
        # a ticker not among them, and it is false in the most expensive
        # direction: it names a configuration variable as the cause, so the
        # reader goes and sets a variable that is already set and concludes the
        # recorder is broken. It cost a session an hour on 2026-08-25.
        #
        # This is the four-absence discipline every pane on this engine keeps,
        # applied at the route that feeds them: a pane cannot tell apart what
        # the route has already merged.
        held = get_store().counts().get("book_snapshots", 0)
        if wanted and held:
            return CoherenceBooks(
                state="empty",
                origin="tape",
                notes=[
                    f"no book on the tape matches {', '.join(wanted)}; it holds {held} snapshot(s) "
                    "for other tickers, so this is a filter that found nothing rather than a "
                    "recorder that has not run",
                ],
            )
        return CoherenceBooks(
            state="empty",
            origin="tape",
            notes=["the tape holds no books yet; the recorder writes them once COHERENCE_POLL_S is set"],
        )
    return CoherenceBooks(state="ok", origin="tape", books=[_from_tape(row) for row in rows])


def _from_tape(row: dict[str, Any]) -> CoherenceBookView:
    """One recorded row back into a book view.

    The ladders were stored in the venue's own ``[[price, size], ...]`` shape,
    so this is the same parse the live path runs — which is what makes replay
    and live the same code rather than two implementations that agree today.
    """
    import json

    book = parse_orderbook(
        row["ticker"],
        {"yes_dollars": json.loads(row["yes_ladder"]), "no_dollars": json.loads(row["no_ladder"])},
        depth=row.get("depth") or "full",
    )
    return book_view(book, source=row.get("source") or "tape", ts_ns=int(row["ts_ns"]))


@router.get("/api/coherence/certify", response_model=CoherenceCertificate)
async def coherence_certify(
    event_ticker: str = Query(description="The event family to test"),
    max_contracts: int = Query(default=1000, ge=1, le=100_000),
    _actor: str = Depends(trader_identity),
) -> CoherenceCertificate:
    """Test one family for coherence, and return the proof either way.

    Answers on the healthy case too. A detector that returns nothing when all
    is well leaves a caller unable to tell "no opportunity" from "the feed is
    down", and on this exchange the correct answer is usually that the prices
    are coherent — which is itself worth showing, because it is the claim the
    engine is making.
    """
    # THE SNAPSHOT FIRST, and a miss is not an error. An off-watchlist family, a
    # cold process or a deployment with the refresher off all fall through to
    # the live read below and answer exactly as they did before this existed.
    held = warm.snapshot_for("certify", event_ticker=event_ticker, max_contracts=max_contracts)
    if held is not None:
        return held.value.model_copy(update={"observed_age_s": round(held.age_s(), 1)})

    observation_held = warm.observation_for(event_ticker)
    try:
        observation = (
            observation_held.value
            if observation_held is not None
            else await observe_event(KalshiClient(), event_ticker)
        )
    except KalshiUnavailable as exc:
        return CoherenceCertificate(
            verdict="untestable", engine="closed_form", component_id=event_ticker,
            series_ticker="", exchange_index=0, notes=[exc.reason],
        )
    schedule = await fee_meta.schedule_for_event(observation.event.series_ticker, event_ticker)
    certificate = await bounded_certify(observation, schedule, max_contracts=Decimal(max_contracts))
    payload = certificate.to_dict()
    payload["proof"] = certificate.render_text()
    answer = CoherenceCertificate(**payload)
    if observation_held is not None:
        answer = answer.model_copy(update={"observed_age_s": round(observation_held.age_s(), 1)})
    return answer


@router.get("/api/coherence/fees", response_model=CoherenceFees)
async def coherence_fees(
    price: str = Query(default="0.3301", description="Contract price in dollars"),
    contracts_fp: str = Query(default="0.09", description="Contracts, to 0.01"),
    fills: int = Query(default=3, ge=1, le=50),
    series: str | None = Query(default=None, description="Take the fee multiplier from this series"),
    _actor: str = Depends(trader_identity),
) -> CoherenceFees:
    """The three-component fee, worked through at a price and a size.

    Defaults reproduce Kalshi's own documented example — 0.09 contracts at
    $0.3301 in three lots — because that is the case where the component
    nobody models is nineteen times larger than the one everybody does.
    """
    try:
        parsed_price = parse_dollars(price)
        size = parse_fp(contracts_fp)
    except MoneyError as exc:
        return CoherenceFees(
            state="unreadable", price=price, contracts=contracts_fp, fills=fills,
            multiplier="1", balance_precision="0.010000", notes=[str(exc)],
        )
    schedule = await fee_meta.schedule_for_event(series or "", "") if series else FeeSchedule(
        taker_rate=tunables.TAKER_RATE, maker_ratio=tunables.MAKER_RATIO,
        balance_precision=tunables.BALANCE_PRECISION,
    )
    return worked_example(parsed_price, size, schedule, fills=fills, basket_prices=[parsed_price, parsed_price])
