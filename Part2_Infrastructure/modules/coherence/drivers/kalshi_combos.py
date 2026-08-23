"""Reading Kalshi's combo markets, where the conjunction is stated rather than inferred.

Every other relation in this engine is derived: a ladder's monotonicity comes
from comparing two strikes, a basket's summation from an ``mutually_exclusive``
flag. A combo needs no derivation at all. The market payload carries

    "mve_selected_legs": [
      {"event_ticker": "KXEPLGAME-...", "market_ticker": "...-BOU", "side": "no"},
      {"event_ticker": "KXF1RACE-DUTGP26", "market_ticker": "...-ANT", "side": "yes"},
      ...
    ]

which says, in the venue's own words, that this contract pays a dollar exactly
when all of those legs land the way listed. That is the cleanest input the
coherence engine ever gets, and ``kernel/frechet.py`` turns it into bounds.

Three things about the live listing that shape this module:

**They are numerous and mostly unquoted.** The cross-category collection lists
auto-generated eight-leg parlays, and the great majority sit with no bid and no
offer. An unquoted combo is not a coherent one — it is one nothing can be
concluded about — so ``parse_combos`` keeps them and the reading layer reports
them as unquoted rather than filtering them into invisibility.

**The legs live on other shards.** A parlay on shard 1 references football
markets on shard 3. Every leg therefore has to be fetched separately and the
whole structure is cross-shard, which is the most expensive legging tier in
``costs.py``. The shard is recorded per leg where it is known and left ``None``
where it is not, because ``None`` makes ``Combo.scope`` fall to cross-shard and
guessing "same shard" would understate the risk.

**``side`` is load-bearing.** Roughly half the legs are NO legs. A parser that
dropped the side would produce a Fréchet bound on the wrong event and an order
plan that bought the opposite contract, so the side is required and a leg
without one is refused rather than defaulted.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

from modules.coherence.drivers.kalshi_parse import ParseError
from modules.coherence.kernel.frechet import Combo, ComboLeg

#: The venue's own filter values for ``GET /markets?mve_filter=``.
MVE_ONLY = "only"
MVE_EXCLUDE = "exclude"


def _leg_from(payload: dict[str, Any], shards: dict[str, int] | None) -> ComboLeg:
    ticker = str(payload.get("market_ticker") or "").strip()
    event_ticker = str(payload.get("event_ticker") or "").strip()
    side = str(payload.get("side") or "").strip().lower()
    if not ticker:
        raise ParseError("a combo leg carries no market_ticker")
    if side not in {"yes", "no"}:
        # Not defaulted. A NO leg read as YES is a bound on the complement of
        # the event the combo is actually about.
        raise ParseError(f"combo leg {ticker} carries side {side!r}, which is neither yes nor no")
    return ComboLeg(
        ticker=ticker,
        event_ticker=event_ticker,
        side=side,  # type: ignore[arg-type]
        label=event_ticker or ticker,
        exchange_index=(shards or {}).get(ticker),
    )


def parse_combo(payload: dict[str, Any], shards: dict[str, int] | None = None) -> Combo | None:
    """One combo market, or ``None`` when the payload is not a combo.

    ``shards`` maps a leg's ticker to the exchange instance it trades on, when
    that has already been fetched. Absent, the legs are marked unknown and the
    combo reports itself cross-shard.
    """
    legs_raw = payload.get("mve_selected_legs")
    if not isinstance(legs_raw, list) or not legs_raw:
        return None
    ticker = str(payload.get("ticker") or "").strip()
    if not ticker:
        raise ParseError("a combo market carries no ticker")
    legs = tuple(_leg_from(leg, shards) for leg in legs_raw if isinstance(leg, dict))
    if not legs:
        raise ParseError(f"combo {ticker} lists mve_selected_legs but none of them parse")
    return Combo(
        ticker=ticker,
        collection_ticker=str(payload.get("mve_collection_ticker") or "").strip(),
        exchange_index=int(payload.get("exchange_index") or 0),
        legs=legs,
        label=str(payload.get("yes_sub_title") or payload.get("title") or ticker),
    )


def _tradability(row: dict[str, Any]) -> tuple[int, Decimal]:
    """How likely this parlay is to be worth reading a book for.

    The listing is mostly machine-generated and mostly dead: of a thousand open
    combos, some twenty have ever traded, and no combo anywhere carries a bid —
    nobody offers to buy a parlay. What a few of them do carry is a real *ask*,
    strictly between nothing and a dollar, and that is the only quote either
    Fréchet bound can be tested against. An ask of exactly ``1.0000`` is a stub
    rather than an offer, and an ask of ``0.0000`` means unquoted, so both sort
    down with the rest.

    Ordering rather than filtering: a combo with no quote still has a band, and
    the band is worth drawing. This only decides which ones get a book fetched
    first, when the bulk call has room for ten parlays out of a thousand.
    """
    ask = _decimal_or_zero(row.get("yes_ask_dollars"))
    real_offer = 1 if Decimal(0) < ask < Decimal(1) else 0
    return real_offer, _decimal_or_zero(row.get("open_interest_fp"))


def _decimal_or_zero(value: Any) -> Decimal:
    try:
        return Decimal(str(value)) if value is not None else Decimal(0)
    except (InvalidOperation, ValueError):
        return Decimal(0)


def parse_combos(
    payload: dict[str, Any],
    shards: dict[str, int] | None = None,
    prefer_tradable: bool = True,
) -> list[Combo]:
    """Every combo in a ``GET /markets`` page, skipping the ones that are not.

    Ordered most-tradable first by default, because the caller can only afford
    to fetch books for a handful and the listing's natural order is arbitrary.
    """
    markets = payload.get("markets")
    if not isinstance(markets, list):
        return []
    rows = [row for row in markets if isinstance(row, dict)]
    if prefer_tradable:
        rows = sorted(rows, key=_tradability, reverse=True)
    found: list[Combo] = []
    for row in rows:
        combo = parse_combo(row, shards)
        if combo is not None:
            found.append(combo)
    return found


def leg_tickers(combos: Sequence[Combo]) -> list[str]:
    """Every distinct leg market across these combos, in a stable order.

    Stable because it drives a bulk orderbook request, and a request whose
    ticker order changes between polls produces a tape that cannot be diffed.
    """
    seen: dict[str, None] = {}
    for combo in combos:
        for leg in combo.legs:
            seen.setdefault(leg.ticker, None)
    return list(seen)


def parse_collections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """The collections index: which events a combo family draws its legs from.

    Public, and useful before any market is fetched — it says which events will
    have to be read to price a collection's combos, which is what the read
    budget needs to plan a poll.
    """
    rows = payload.get("multivariate_contracts")
    if not isinstance(rows, list):
        return []
    parsed: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        associated = row.get("associated_event_tickers")
        parsed.append(
            {
                "collection_ticker": str(row.get("collection_ticker") or row.get("ticker") or ""),
                "title": str(row.get("title") or ""),
                "associated_event_tickers": tuple(
                    str(item) for item in associated if isinstance(item, str)
                )
                if isinstance(associated, list)
                else (),
                "size_min": row.get("size_min"),
                "size_max": row.get("size_max"),
            }
        )
    return parsed
