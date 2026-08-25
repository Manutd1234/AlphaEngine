"""The lab: readings built on top of the engine rather than inside it.

``modules/api/coherence.py`` answers what is true of the exchange now, and
``coherence_history.py`` what has been true over time. This third router answers
questions that take the engine's output as their input: what distribution do
these prices imply, what do the parlays say about dependence, were the prices
right, how much would you stake, what does the contract actually settle on, and
what the whole watched universe looks like as a tree.

Every route is a GET, every route names its engine, and every route returns a
``state`` a pane can render without guessing. Nothing here places an order.

The response mapping lives in ``coherence_lab_views.py`` so that this file reads
as the list of questions the lab answers.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api import coherence_lab_views as views
from modules.api.deps import trader_identity
from modules.coherence import fee_meta, tunables, warm
from modules.coherence.drivers.kalshi_auth import signing_available
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.drivers.rfq import read_panel
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.kernel.band_usage import band_usage
from modules.coherence.kernel.costs import no_arbitrage_bound
from modules.coherence.kernel.money import DOLLAR
from modules.coherence.syscalls import calibrate, combos, settlement, shell, surface
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.observe import observe_event, observe_series
from modules.schemas import (
    CoherenceCalibration,
    CoherenceCombos,
    CoherenceKelly,
    CoherenceRfqPanel,
    CoherenceSettlementFeed,
    CoherenceShell,
    CoherenceSurface,
)

# One tag per router module, as with the other two halves: /docs then answers
# "which file is this route in" without anyone opening the tree.
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
    held = warm.snapshot_for("combos", limit=limit)
    if held is not None:
        return held.value.model_copy(update={"observed_age_s": round(held.age_s(), 1)})

    return views.combos_view(await combos.observe_combos(KalshiClient(), limit=limit))


@router.get("/api/coherence/calibration", response_model=CoherenceCalibration)
async def coherence_calibration(
    horizon_s: int = Query(default=3600, ge=0, le=604_800),
    harvest: bool = Query(default=True, description="Read settled markets before scoring"),
    _actor: str = Depends(trader_identity),
) -> CoherenceCalibration:
    """Were the prices right? The Brier score and Murphy's decomposition.

    Prefers forecasts from the tape — a price quoted an hour before close,
    scored against what happened. Falls back to last traded prices only when
    the tape is too short, and says so in the engine name, because a last trade
    happens moments before settlement and scores convergence, not foresight.
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
    return views.calibration_view(report, "; ".join([note for note in notes if note] + [report.detail]))


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
    feed = await settlement.weather(client, city)
    reference = await settlement.reference_rate(client)
    return views.settlement_view(feed, reference, city)


@router.get("/api/coherence/rfq", response_model=CoherenceRfqPanel)
async def coherence_rfq(_actor: str = Depends(trader_identity)) -> CoherenceRfqPanel:
    """What the makers disagree about, where the public book shows nothing.

    Signed-only, and on the demo environment usually empty — makers do not quote
    a sandbox. Empty is reported as empty rather than as a quiet market, and an
    unsigned read is reported as no view rather than a worse one.
    """
    if not signing_available() or not tunables.DEMO_KEY_ID:
        return CoherenceRfqPanel(
            state="signing_unavailable",
            detail=(
                "the RFQ channel is signed-only. No demo key is configured here, or the signing "
                "library is absent, so there is no view of it at all — which is not an empty one"
            ),
        )
    panel = await read_panel(KalshiClient(base_url=tunables.DEMO_BASE_URL, signed=True))

    # The measurement §8.4 is actually about: how much of the room the legs
    # leave do the makers use? Reading the combos costs two calls, so it is
    # done only when there is a panel to set them against — on a sandbox with
    # no quotes the join would be two requests to compare nothing.
    usage: dict[str, Any] = {}
    if panel.get("dispersions"):
        spreads = {item.market_ticker: (item.spread, item.usable) for item in panel["dispersions"]}
        observed = await combos.observe_combos(KalshiClient(), limit=10)
        for reading in observed.readings:
            found = spreads.get(reading.combo_ticker)
            if found is None:
                continue
            measured = band_usage(reading, found[0], found[1])
            if measured is not None:
                usage[reading.combo_ticker] = measured
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
            observations.extend(await observe_series(client, series, max_events=tunables.MAX_EVENTS_PER_SERIES))
        except KalshiUnavailable as exc:
            refusals.append(f"{series}: {exc.reason}")

    if not observations:
        # A read that failed and a path that is not there are different answers,
        # and this route used to give both of them the same one — `exists=False`,
        # which the pane renders as "no such path". The venue's own reason is
        # carried through so the reader can tell an outage from an empty tree.
        if refusals:
            return CoherenceShell(
                state="unavailable",
                path=path,
                command=command,
                exists=True,
                detail=(
                    "the watched universe could not be read, so this is not a statement about the "
                    "path: " + "; ".join(refusals[:3])
                ),
            )
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
        # The certificate is the one file the shell cannot render from the
        # observation alone — it has to be solved for. Solved on demand rather
        # than for every event on every listing, because certifying a family
        # nobody asked about spends a read budget and a solver run to produce a
        # file that is never opened.
        certificate = None
        if path.rstrip("/").endswith("/certificate"):
            certificate = await _certificate_for(observations, path)
        return views.file_view(shell.cat(observations, path, certificate), path)
    return views.listing_view(shell.ls(observations, path))


async def _certificate_for(observations: list[Any], path: str) -> Any:
    """Certify the event this path names, or return None and let ``cat`` say so."""
    parts = [part for part in path.strip("/").split("/") if part]
    if len(parts) != 5:
        return None
    observation = next((item for item in observations if item.event.event_ticker == parts[3]), None)
    if observation is None:
        return None
    schedule = await fee_meta.schedule_for_event(observation.event.series_ticker, observation.event.event_ticker)
    return certify(observation, schedule)
