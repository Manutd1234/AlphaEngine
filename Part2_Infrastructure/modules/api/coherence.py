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

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query

from modules.api.deps import trader_identity
from modules.coherence import tunables
from modules.coherence.drivers import kalshi_auth
from modules.coherence.drivers.kalshi_parse import schema_probe
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fees_source import schedule_for
from modules.coherence.fs.store import TapeUnavailable, get_store
from modules.coherence.kernel.book import parse_orderbook
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.money import MoneyError, parse_dollars, parse_fp
from modules.coherence.recorder import recorder_state
from modules.coherence.scheduler.budget import get_read_budget
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.fees import worked_example
from modules.coherence.syscalls.observe import observe_event, observe_series
from modules.coherence.views import book_view, event_view
from modules.schemas import (
    CoherenceBooks,
    CoherenceBookView,
    CoherenceBudgetStatus,
    CoherenceCertificate,
    CoherenceFees,
    CoherenceRecorderStatus,
    CoherenceStatus,
    CoherenceUniverse,
)
from modules.schemas_coherence import CoherenceHostStatus, CoherenceShardStatus

router = APIRouter(tags=["coherence"])


@router.get("/api/coherence/status", response_model=CoherenceStatus)
async def coherence_status(_actor: str = Depends(trader_identity)) -> CoherenceStatus:
    """Is any of this real right now — and if not, which part is not.

    Reads the exchange's own status rather than reporting on our intentions.
    The schema probe is the load-bearing one: Kalshi removed the integer-cent
    fields in March 2026, and a client written against them parses today's
    payloads into a book of zeros without raising anything. "Every price is
    zero" is not a state a reader should have to diagnose from a chart.
    """
    notes: list[str] = []
    hosts: list[CoherenceHostStatus] = []
    shards: list[CoherenceShardStatus] = []
    probe: dict[str, Any] = {"schema": "unavailable", "detail": "no market payload was read"}

    client = KalshiClient()
    try:
        fetched = await client.exchange_status()
        hosts.append(CoherenceHostStatus(host=fetched.host, reachable=True))
        for row in fetched.payload.get("exchange_index_statuses") or []:
            shards.append(
                CoherenceShardStatus(
                    exchange_index=int(row.get("exchange_index", 0)),
                    description=str(row.get("description", "")),
                    exchange_active=bool(row.get("exchange_active")),
                    trading_active=bool(row.get("trading_active")),
                )
            )
    except KalshiUnavailable as exc:
        hosts.append(CoherenceHostStatus(host=tunables.PUBLIC_BASE_URL, reachable=False, detail=exc.reason))
        notes.append(f"Kalshi was not reachable: {exc.reason}")

    if tunables.SERIES_WATCHLIST:
        try:
            markets = await client.markets(tunables.SERIES_WATCHLIST[0], limit=1)
            rows = markets.payload.get("markets") or []
            probe = schema_probe(rows[0] if rows else None)
        except KalshiUnavailable as exc:
            notes.append(f"schema could not be probed: {exc.reason}")
    else:
        notes.append("no watchlist configured; set COHERENCE_SERIES to record and certify a series")

    try:
        tape = get_store().health()
    except TapeUnavailable as exc:
        tape = {"state": "unavailable", "reason": str(exc)}

    recorder = recorder_state().to_dict()
    reachable = any(host.reachable for host in hosts)
    state = "ok" if reachable and probe.get("schema") == "fp-2026" else "degraded" if reachable else "unavailable"

    return CoherenceStatus(
        state=state,
        hosts=hosts,
        shards=shards,
        schema_probe=probe,
        recorder=CoherenceRecorderStatus(**{k: v for k, v in recorder.items() if k != "last_error_ts_ns"}),
        budget=CoherenceBudgetStatus(**get_read_budget().status()),
        tape=tape,
        solver=_solver_status(),
        signing=_signing_status(),
        dry_run=tunables.DRY_RUN,
        notes=notes,
    )


def _solver_status() -> dict[str, Any]:
    """Which coherence engine is available in this deployment.

    The LP wants SciPy's HiGHS, which is in the tested venv and in CI but not
    on the runtime image. The closed-form family checks always run. Reporting
    which one answered is the difference between a weaker result and a wrong
    one — an absence must never look like present-and-fine.
    """
    from importlib.util import find_spec

    available = find_spec("scipy") is not None
    return {
        "linear_programme": "available" if available else "unavailable",
        "always_available": "closed_form",
        "detail": (
            "SciPy's HiGHS solves the full lattice"
            if available
            else "SciPy is not installed here; closed-form family checks still run and say so"
        ),
    }


def _signing_status() -> dict[str, Any]:
    """Whether signed reads are possible. Production reads never need them."""
    return kalshi_auth.status()


@router.get("/api/coherence/universe", response_model=CoherenceUniverse)
async def coherence_universe(
    series: str | None = Query(default=None, description="One series ticker; defaults to the whole watchlist"),
    max_events: int = Query(default=6, ge=1, le=50),
    _actor: str = Depends(trader_identity),
) -> CoherenceUniverse:
    """The watched families, priced, with each basket's total stated.

    The basket totals are the engine's thesis in miniature: for a mutually
    exclusive event, buying every outcome buys a guaranteed dollar, so what it
    costs is a direct reading of whether the family is coherent.
    """
    watchlist = [series] if series else list(tunables.SERIES_WATCHLIST)
    if not watchlist:
        return CoherenceUniverse(
            state="unconfigured",
            watchlist=[],
            notes=["no series is being watched; set COHERENCE_SERIES or pass ?series="],
        )

    client = KalshiClient()
    events = []
    notes: list[str] = []
    for series_ticker in watchlist:
        try:
            for observation in await observe_series(client, series_ticker, max_events=max_events):
                events.append(event_view(observation))
                notes.extend(observation.notes)
        except KalshiUnavailable as exc:
            notes.append(f"{series_ticker} could not be read: {exc.reason}")

    state = "ok" if events else ("unavailable" if notes else "empty")
    return CoherenceUniverse(state=state, events=events, watchlist=watchlist, notes=notes)


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
        try:
            observation = await observe_event(KalshiClient(), event_ticker)
        except KalshiUnavailable as exc:
            return CoherenceBooks(state="unavailable", origin="kalshi", notes=[exc.reason])
        return CoherenceBooks(
            state="ok" if observation.markets else "empty",
            origin="kalshi",
            books=[book_view(item.book, source=f"kalshi:{observation.depth}", ts_ns=observation.ts_ns) for item in observation.markets],
            notes=observation.notes,
        )

    wanted = [t.strip() for t in (tickers or "").split(",") if t.strip()]
    try:
        rows = get_store().latest_books(tickers=wanted or None)
    except TapeUnavailable as exc:
        return CoherenceBooks(state="unavailable", origin="tape", notes=[str(exc)])
    if not rows:
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
    try:
        observation = await observe_event(KalshiClient(), event_ticker)
    except KalshiUnavailable as exc:
        return CoherenceCertificate(
            verdict="untestable", engine="closed_form", component_id=event_ticker,
            series_ticker="", exchange_index=0, notes=[exc.reason],
        )
    schedule = await _schedule_for(observation.event.series_ticker, event_ticker)
    certificate = certify(observation, schedule, max_contracts=Decimal(max_contracts))
    payload = certificate.to_dict()
    payload["proof"] = certificate.render_text()
    return CoherenceCertificate(**payload)


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
    schedule = await _schedule_for(series or "", "") if series else FeeSchedule(
        taker_rate=tunables.TAKER_RATE, maker_ratio=tunables.MAKER_RATIO,
        balance_precision=tunables.BALANCE_PRECISION,
    )
    return worked_example(parsed_price, size, schedule, fills=fills, basket_prices=[parsed_price, parsed_price])


async def _schedule_for(series_ticker: str, event_ticker: str) -> FeeSchedule:
    """The live fee schedule, falling back to the published rate on a refusal.

    A fee we could not read is reported as the published default rather than
    as zero: zero fees would make every basket look tradable, which is the one
    direction an error here must never take.
    """
    if not series_ticker:
        return FeeSchedule(
            taker_rate=tunables.TAKER_RATE, maker_ratio=tunables.MAKER_RATIO,
            balance_precision=tunables.BALANCE_PRECISION,
        )
    client = KalshiClient()
    series_payload: dict[str, Any] | None = None
    series_changes: list[dict[str, Any]] = []
    event_changes: list[dict[str, Any]] = []
    try:
        series_payload = (await client.series(series_ticker)).payload
        series_changes = (await client.series_fee_changes()).payload.get("series_fee_change_arr") or []
        if event_ticker:
            event_changes = (await client.event_fee_changes(event_ticker)).payload.get("event_fee_changes") or []
    except KalshiUnavailable:
        pass
    return schedule_for(series_payload, series_changes, event_changes, event_ticker).schedule
