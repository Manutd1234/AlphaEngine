"""``calibrate`` — build a settled corpus and score the prices that made it.

Two passes that are deliberately separate. The *harvest* reads settled markets
from the exchange and appends them to the tape's settlements table; it is cheap,
idempotent, and worth running on a schedule. The *score* joins whatever the tape
already holds and reports. Splitting them means a score never depends on a
network call succeeding, and a harvest never blocks a pane.

The engine chosen is the honest one available, not the best-looking one. Tape
forecasts are preferred whenever the recorder has enough of them, because a
price quoted an hour before close is a forecast. Final trades are used only when
the tape cannot answer, and they are labelled so in the report itself.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Sequence

from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fs import corpus
from modules.coherence.fs.store import CoherenceStore
from modules.coherence.kernel import calibration
from modules.coherence.kernel.money import MoneyError, parse_dollars

#: Below this many tape forecasts the tape is not preferred over final trades —
#: a reliability curve over a handful of markets is noise with a shape.
MIN_TAPE_FORECASTS = 20


def _price(raw: object, volume: object) -> "Decimal | None":
    """A settled market's last price, or None. Never zero as a stand-in.

    The volume argument is the whole point, and it was added after the corpus
    lied. Kalshi reports ``last_price_dollars`` as ``"0.0000"`` for a market
    that never traded, which is indistinguishable from one that traded at
    nothing — and on a settled BTC strike ladder 175 of 200 markets have never
    traded. Scoring those as forecasts of "impossible" put 86 markets that
    resolved YES into the cheapest reliability bin, which reported contracts
    priced at half a cent happening a quarter of the time. That is not a
    finding about the exchange, it is a parser treating silence as a quote.

    So a last price counts only where something actually traded. Everything
    else has no forecast and leaves the corpus, which shrinks it to the 25
    markets that were genuinely priced — a smaller and honest sample.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        traded = parse_dollars(str(volume)) if volume is not None else Decimal(0)
    except MoneyError:
        traded = Decimal(0)
    if traded <= 0:
        return None
    try:
        return parse_dollars(raw)
    except MoneyError:
        return None


def _iso_to_ns(raw: str | None) -> int | None:
    if not raw:
        return None
    text = raw.strip().replace("Z", "+00:00")
    try:
        return int(time.mktime(time.strptime(text[:19], "%Y-%m-%dT%H:%M:%S"))) * 1_000_000_000
    except (ValueError, OverflowError):
        return None


def _settlement_from(row: dict) -> corpus.Settlement | None:
    ticker = str(row.get("ticker") or "").strip()
    result = str(row.get("result") or "").strip().lower()
    if not ticker or result not in corpus.SCORABLE:
        return None
    return corpus.Settlement(
        ticker=ticker,
        event_ticker=str(row.get("event_ticker") or ""),
        series_ticker=str(row.get("series_ticker") or _series_of(row)),
        close_ts_ns=_iso_to_ns(row.get("close_time")),
        result=result,
        last_price=_price(row.get("last_price_dollars"), row.get("volume_fp")),
    )


def _series_of(row: dict) -> str:
    """The series a market belongs to, taken from its event ticker's stem."""
    event = str(row.get("event_ticker") or "")
    return event.split("-", 1)[0] if "-" in event else event


async def _page(client: KalshiClient, series_ticker: str | None, limit: int) -> list[corpus.Settlement]:
    try:
        page = await client.settled_markets(series_ticker=series_ticker, limit=limit)
    except KalshiUnavailable:
        return []
    rows = page.payload.get("markets")
    rows = rows if isinstance(rows, list) else []
    return [item for item in (_settlement_from(row) for row in rows if isinstance(row, dict)) if item]


async def harvest(
    client: KalshiClient,
    store: CoherenceStore,
    series: Sequence[str] | None = None,
    limit: int = 200,
) -> dict[str, object]:
    """Read settled markets and append the ones the tape has not seen.

    Harvests **per watched series** rather than taking whatever the unfiltered
    listing returns first. That ordering is not neutral: the exchange settles
    auto-generated cross-category parlays every fifteen minutes, so an
    unfiltered read comes back entirely combos, and a calibration curve built
    from it is a statement about a machine-made product nobody trades rather
    than about the series this engine watches. The unfiltered read stays as a
    fallback, because an odd corpus beats no corpus — and it is labelled.
    """
    wanted = [item for item in (series or ()) if item]
    settlements: list[corpus.Settlement] = []
    for ticker in wanted:
        settlements.extend(await _page(client, ticker, limit))

    note = f"{len(settlements)} settled market(s) across {len(wanted)} watched series"
    if not settlements:
        settlements = await _page(client, None, limit)
        note = (
            f"no watched series has settled markets to read, so this is the unfiltered listing: "
            f"{len(settlements)} market(s), mostly auto-generated combos"
        )

    added = corpus.record_settlements(store, settlements, time.time_ns())
    return {
        "state": "available" if settlements else "unavailable",
        "detail": f"{note}, {added} new",
        "added": added,
        "read": len(settlements),
        "settlements": settlements,
    }


def score(
    store: CoherenceStore,
    horizon_s: int = corpus.DEFAULT_HORIZON_S,
    fallback: list[corpus.Settlement] | None = None,
) -> calibration.Report:
    """Score the corpus, preferring genuine forecasts over final trades."""
    corpus.ensure_table(store)
    tape = corpus.tape_forecasts(store, horizon_s=horizon_s)
    if len(tape) >= MIN_TAPE_FORECASTS:
        return calibration.score(tape, engine="tape")

    final = corpus.final_trade_forecasts(fallback or [])
    if not final and not tape:
        return calibration.score([], engine="unavailable")
    if not final:
        return calibration.score(tape, engine="tape")
    report = calibration.score(final, engine="final_trade")
    return report
