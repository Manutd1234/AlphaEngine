"""Lab readings built on top of the coherence engine.

Every route is a GET, names its engine and returns a renderable ``state``;
nothing here places an order. Response mapping lives in
``coherence_lab_views.py`` so this file remains the list of questions answered.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api import coherence_lab_views as views
from modules.api.coherence import bounded_certify
from modules.api.deps import trader_identity
from modules.coherence import fee_meta, tunables, warm
from modules.coherence.drivers.kalshi_auth import signing_available
from modules.coherence.drivers.kalshi_auth import status as signing_status
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.drivers.rfq import read_panel
from modules.coherence.fs import corpus
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.kernel.costs import FeeSchedule, net_fee, no_arbitrage_bound
from modules.coherence.kernel.money import DOLLAR, MoneyError, format_dollars, parse_fp
from modules.coherence.syscalls import calibrate, combos, settlement, shell, surface
from modules.coherence.syscalls.observe import observe_event, observe_series
from modules.schemas import (
    CoherenceCalibration,
    CoherenceCombos,
    CoherenceFeeCurve,
    CoherenceFeeCurvePoint,
    CoherenceKelly,
    CoherenceRfqPanel,
    CoherenceSettlementFeed,
    CoherenceShell,
    CoherenceSurface,
)

# One tag per router module, so /docs answers "which file is this route in" without opening the tree.
router = APIRouter(tags=["coherence lab"])


@router.get("/api/coherence/surface", response_model=CoherenceSurface)
async def coherence_surface(
    event_ticker: str = Query(..., min_length=3, description="One event's ticker"),
    _actor: str = Depends(trader_identity),
) -> CoherenceSurface:
    """The probability distribution this event's prices imply.

    Built by differencing the survival function the strike ladder samples: the
    mass between two strikes is what their prices differ by. A negative bin is
    a monotonicity violation and is flagged rather than clipped, because it is
    the same fault the certificate prices.
    """
    try:
        observation = await observe_event(KalshiClient(), event_ticker)
    except KalshiUnavailable as exc:
        return CoherenceSurface(state="unavailable", engine="unavailable", detail=exc.reason)
    return views.surface_view(surface.surface_for(observation), event_ticker)


@router.get("/api/coherence/stake", response_model=CoherenceKelly)
async def coherence_stake(
    event_ticker: str = Query(..., min_length=3),
    shrinkage: str = Query(default="0.25", description="Fraction of full Kelly, in (0, 1]"),
    _actor: str = Depends(trader_identity),
) -> CoherenceKelly:
    """Log-optimal stakes over this family, and the riskless alternative.

    Sized against the measure the surface draws, not against the raw mids —
    feeding Kelly the market's own view returns "stake nothing" by construction.
    Growth-optimal is not riskless: where an arbitrage exists, the certain
    return is reported beside the risky plan rather than in place of it.
    """
    try:
        fraction = Decimal(shrinkage)
    except (InvalidOperation, ValueError):
        return CoherenceKelly(state="unavailable", engine="unavailable", detail="the shrinkage is not a decimal")
    # `Decimal("NaN")` parses. It then raises InvalidOperation inside the solver
    # on the first comparison, which reaches the client as a 500 rather than as
    # a refusal, so the non-finite cases are rejected here where there is still
    # a sentence to return.
    if not fraction.is_finite():
        return CoherenceKelly(
            state="unavailable", engine="unavailable", detail="the shrinkage must be a finite number"
        )
    try:
        observation = await observe_event(KalshiClient(), event_ticker)
    except KalshiUnavailable as exc:
        return CoherenceKelly(state="unavailable", engine="unavailable", detail=exc.reason)
    reading = surface.surface_for(observation)
    # The arbitrage threshold is fee-aware or it is wrong. A basket at $0.98 is
    # not two cents of riskless profit if the fees on its legs come to three,
    # and `costs.no_arbitrage_bound` is the test the rest of this engine uses.
    schedule = await fee_meta.schedule_for_event(observation.event.series_ticker, event_ticker)
    asks = [
        item.book.best_yes_ask
        for item in observation.markets
        if item.book.best_yes_ask is not None
    ]
    bound = no_arbitrage_bound(asks, schedule) if asks else DOLLAR
    return views.kelly_view(surface.stake_for(observation, reading, fraction, bound))


@router.get("/api/coherence/combos", response_model=CoherenceCombos)
async def coherence_combos(
    limit: int = Query(default=8, ge=1, le=10, description="How many parlays to fetch books for"),
    ticker: str | None = Query(default=None, description="Read one named parlay instead of the first few"),
    _actor: str = Depends(trader_identity),
) -> CoherenceCombos:
    """Parlays against the Fréchet band their own legs leave them.

    Two probabilities do not determine the probability of both; they leave a
    band. A price inside it is consistent with some dependence structure and is
    not a mispricing. A price outside it is a Dutch book, and the row that
    proves it comes back with the reading.
    """
    # The snapshot first. A miss — a limit the refresher does not hold — falls
    # through to the live read below and answers exactly as it did before.
    # A NAMED PARLAY IS NEVER SERVED WARM, and that rule is unchanged. The
    # refresher holds the first few by leg count; a reader asking for a ticker
    # is asking about a specific one, and answering from a snapshot that
    # happens to contain it would make the same request mean two things
    # depending on the venue's listing order that poll.
    if ticker is None:
        held = warm.snapshot_for("combos", limit=limit)
        if held is not None:
            return held.value.model_copy(update={"observed_age_s": round(held.age_s(), 1)})

    # THE LISTING IS A DIFFERENT OBJECT AND IT CAN BE REUSED. What the rule
    # above refuses is serving a named parlay's ANSWER from a set somebody else
    # chose; this reuses only the description of what the exchange is listing,
    # which is the same for every ticker and is where a named read spends most
    # of its time. The books are still read for this request, so the prices are
    # this request's, and `observe_combos` names the listing's age in a note.
    listing = warm.snapshot_for("combos-listing")
    return views.combos_view(
        await combos.observe_combos(
            KalshiClient(),
            limit=limit,
            ticker=ticker,
            listing=None if listing is None else listing.value,
            listing_age_s=None if listing is None else listing.age_s(),
        ),
    )


@router.get("/api/coherence/calibration", response_model=CoherenceCalibration)
async def coherence_calibration(
    horizon_s: int = Query(default=corpus.MIN_HORIZON_S, ge=0, le=604_800),
    harvest: bool = Query(default=True, description="Read settled markets before scoring"),
    _actor: str = Depends(trader_identity),
) -> CoherenceCalibration:
    """Were the prices right? The Brier score and Murphy's decomposition.

    Prefers forecasts from the tape — a price quoted well before close, scored
    against what happened. Falls back to last traded prices only when the tape
    is too short, and says so in the engine name, because a last trade happens
    moments before settlement and scores convergence, not foresight.

    THE DEFAULT HORIZON IS THE CORPUS MODULE'S FLOOR, read from where it is
    defined. This route carried its own ``3600`` until 2026-08-26, a second copy
    of a constant that had already excluded the hourly series once; the floor
    applied travels on the wire as ``horizon_s`` so a reader can see it.
    """
    try:
        store = get_store()
    except TapeUnavailable as exc:
        return CoherenceCalibration(state="unavailable", engine="unavailable", detail=str(exc))

    fallback: list[Any] = []
    notes: list[str] = []
    if harvest:
        result = await calibrate.harvest(KalshiClient(), store, tunables.SERIES_WATCHLIST)
        fallback = list(result.get("settlements") or [])
        notes.append(str(result.get("detail") or ""))

    report = calibrate.score(store, horizon_s=horizon_s, fallback=fallback)
    return views.calibration_view(
        report, "; ".join([note for note in notes if note] + [report.detail]), horizon_s=horizon_s,
    )


@router.get("/api/coherence/settlement", response_model=CoherenceSettlementFeed)
async def coherence_settlement(
    city: str = Query(default="miami", min_length=2, description="A city the weather index covers"),
    _actor: str = Depends(trader_identity),
) -> CoherenceSettlementFeed:
    """The published index a contract resolves against, and its quality control.

    Not the price you watch. A temperature contract settles on an average over a
    window, so the gap between the latest reading and that average is basis a
    position carries whether or not anyone notices it.
    """
    client = KalshiClient()
    reference_client = KalshiClient(signing_environment="production")
    # The weather index and CF reference-rate capability are independent venue
    # reads.  Serialising them made the slower one consume the other's latency
    # allowance and needlessly lengthened an already large response.
    feed, reference = await asyncio.gather(
        settlement.weather(client, city),
        settlement.reference_rate(reference_client),
    )
    return views.settlement_view(feed, reference, city)


@router.get("/api/coherence/rfq", response_model=CoherenceRfqPanel)
async def coherence_rfq(_actor: str = Depends(trader_identity)) -> CoherenceRfqPanel:
    """What the makers disagree about, where the public book shows nothing.

    Signed-only. A configured production credential is preferred so the panel
    can show the account's live RFQs; demo is used only when no production
    key ID declares production intent. Empty is reported as empty rather than
    as a quiet market, and an unsigned read is reported as no view rather than
    a worse one.
    """
    # Presence wins even when broken, so demo cannot disguise a production fault.
    environment = tunables.preferred_rfq_signing_environment()
    if environment is None:
        return views.rfq_signing_unavailable(None)

    if not signing_available(environment):
        signing_detail = str(signing_status(environment).get("detail") or f"signed {environment} reads are unavailable")
        return views.rfq_signing_unavailable(environment, signing_detail)

    base_url = tunables.PUBLIC_BASE_URL if environment == "production" else tunables.DEMO_BASE_URL
    panel = await read_panel(KalshiClient(base_url=base_url, signing_environment=environment))

    # The measurement §8.4 is actually about: how much of the room the legs
    # leave do the makers use? Reading the combos costs two calls, so it is
    # done only when there is a panel to set them against — on a sandbox with
    # no quotes the join would be two requests to compare nothing.
    usage: dict[tuple[str, str], Any] = {}
    if panel.get("dispersions"):
        observed = await combos.observe_combos(KalshiClient(), limit=10)
        usage = views.rfq_band_usage(panel["dispersions"], observed.readings)
    return views.rfq_view(panel, usage)


@router.get("/api/coherence/shell", response_model=CoherenceShell)
async def coherence_shell(
    path: str = Query(default="/", description="A path in the watched universe"),
    command: str = Query(default="ls", pattern="^(ls|cat)$"),
    _actor: str = Depends(trader_identity),
) -> CoherenceShell:
    """The watched universe as a filesystem: ``ls`` a path, ``cat`` a reading.

    The tree is the watchlist, not the exchange. Kalshi lists some thirteen
    thousand series; this holds the ones the recorder watches, and the root says
    so rather than presenting a fraction as the whole.
    """
    client = KalshiClient()
    observations = []
    refusals: list[str] = []
    for series in tunables.SERIES_WATCHLIST or ():
        try:
            observations.extend(await observe_series(
                client, series, max_events=tunables.SHELL_MAX_EVENTS_PER_SERIES, require_complete=True,
            ))
        except KalshiUnavailable as exc:
            refusals.append(f"{series}: {exc.reason}")

    if refusals:
        # A read that failed and a path that is not there are different answers,
        # and this route used to give both of them the same one — `exists=False`,
        # which the pane renders as "no such path". The venue's own reason is
        # carried through so the reader can tell an outage from an empty tree.
        # Fail closed even when another watched series did answer: passing a
        # partial universe to `ls`/`cat` would turn the refused series into a
        # false "missing" path and silently omit its shard from a root listing.
        return CoherenceShell(
            state="unavailable",
            path=path,
            command=command,
            exists=True,
            detail=(
                "the watched universe could not be read completely, so this is not a statement about the "
                "path: " + "; ".join(refusals[:3])
            ),
        )

    if not observations:
        return CoherenceShell(
            state="unavailable",
            path=path,
            command=command,
            exists=False,
            detail=(
                "nothing is on the watchlist. COHERENCE_SERIES sets which series this tree contains, "
                "and it is empty here"
            ),
        )
    if command == "cat":
        # A certificate needs a solver run beyond the observation. Solve only
        # the requested event instead of spending that budget on every listing.
        certificate = None
        if path.rstrip("/").endswith("/certificate"):
            certificate = await _certificate_for(observations, path)
        return views.file_view(shell.cat(observations, path, certificate), path)
    return views.listing_view(shell.ls(observations, path))


async def _certificate_for(observations: list[Any], path: str) -> Any:
    """Certify the event this path names, or return None and let ``cat`` say so."""
    parts = [part for part in path.strip("/").split("/") if part]
    if len(parts) != 5 or parts[0] != "shards" or parts[4] != "certificate":
        return None
    if not parts[1].isdigit():
        return None
    shard = int(parts[1])
    observation = shell.find_observation(observations, shard, parts[2], parts[3])
    if observation is None:
        return None
    schedule = await fee_meta.schedule_for_event(observation.event.series_ticker, observation.event.event_ticker)
    return await bounded_certify(observation, schedule)


@router.get("/api/coherence/fees/curve", response_model=CoherenceFeeCurve)
async def coherence_fees_curve(
    contracts_fp: str = Query(default="0.09", description="Contracts, to 0.01"),
    fills: int = Query(default=3, ge=1, le=50),
    series: str | None = Query(default=None, description="Take the fee multiplier from this series"),
    _actor: str = Depends(trader_identity),
) -> CoherenceFeeCurve:
    """The three-component fee at every price the venue quotes.

    `/api/coherence/fees` works ONE case through, and it is the right case —
    Kalshi's own documented example, where the rounding component is nineteen
    times the trading one. What it cannot answer is the question that example
    raises: whether that ratio is a property of THAT PRICE or of the schedule.
    A curve answers it, and the desk had been drawing one from a formula
    written in TypeScript — a third implementation of arithmetic this codebase
    keeps in Python precisely so the two it already has can be held to parity.

    NO VENUE CALL, NO TAPE, ONE READ. Ninety-nine evaluations of the same
    kernel the worked example uses, which is why it can afford to be a route
    rather than a cached artefact: it is arithmetic, and it is the arithmetic
    the gateway is the reference for.

    ONE CENT TO NINETY-NINE, and both ends are excluded on purpose. A contract
    at zero or a dollar is settled, not quoted, and including them would put
    two points on the curve where the fee is a fact about a trade nobody can
    make — and at zero the fraction of notional is undefined, which would need
    a null in the middle of a series that has none.
    """
    try:
        size = parse_fp(contracts_fp)
    except MoneyError as exc:
        return CoherenceFeeCurve(
            state="unreadable",
            contracts=contracts_fp,
            fills=fills,
            multiplier="1",
            balance_precision=format_dollars(tunables.BALANCE_PRECISION),
            notes=[str(exc)],
        )

    schedule = await fee_meta.schedule_for_event(series or "", "") if series else FeeSchedule(
        taker_rate=tunables.TAKER_RATE,
        maker_ratio=tunables.MAKER_RATIO,
        balance_precision=tunables.BALANCE_PRECISION,
    )

    points: list[CoherenceFeeCurvePoint] = []
    for cents in range(1, 100):
        price = Decimal(cents) / Decimal(100)
        breakdown = net_fee(price, size, schedule, fills=fills)
        fraction = breakdown.as_fraction_of_notional
        points.append(
            CoherenceFeeCurvePoint(
                price=format_dollars(price),
                trade_fee=format_dollars(breakdown.trade_fee),
                rounding_fee=format_dollars(breakdown.rounding_fee),
                rebate=format_dollars(breakdown.rebate),
                net=format_dollars(breakdown.net),
                notional=format_dollars(breakdown.notional),
                as_fraction_of_notional=None if fraction is None else format_dollars(fraction),
            )
        )

    return CoherenceFeeCurve(
        state="ok",
        contracts=contracts_fp,
        fills=fills,
        multiplier=format_dollars(schedule.taker_rate),
        balance_precision=format_dollars(schedule.balance_precision),
        points=points,
    )
