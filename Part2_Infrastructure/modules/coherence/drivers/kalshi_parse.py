"""Turn Kalshi's payloads into kernel types, and refuse the ones we misread.

Two rules shape this module.

**Prices and counts stay strings until the kernel parses them.** Kalshi's
fixed-point fields are strings on the wire for a reason, and a parser that
eagerly converts loses the thing that makes them trustworthy. Strike values are
different — ``floor_strike`` and ``cap_strike`` arrive as JSON *numbers*,
because they are temperatures and index levels, not money. They are carried as
Decimals built from their string form so that comparing two strikes never goes
through binary64.

**A field we do not recognise is a protocol change, not a zero.** The fixed
point migration removed the integer-cent fields in March 2026; a client written
before it still parses today's payloads to a book full of zeros, because
``payload.get("yes_bid", 0)`` is valid Python against a document that no longer
carries the key. ``schema_probe`` exists to make that loud: it looks for the
field names this engine was written against and reports what it found.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal, Sequence

from modules.coherence.kernel.book import Book, parse_orderbook, top_of_book
from modules.coherence.kernel.grid import GridError, PriceGrid, parse_price_ranges
from modules.coherence.kernel.money import MoneyError

# What a market's strike says about the event, as Kalshi spells it. `greater`
# and `greater_or_equal` sample a survival function; `less` and
# `less_or_equal` sample its complement; `between` is a bucket; `custom` and
# `structured` carry no numeric strike at all and are related to their siblings
# only through the event's mutual exclusivity.
StrikeKind = Literal["greater", "greater_or_equal", "less", "less_or_equal", "between", "custom", "unknown"]

_KNOWN_STRIKES: frozenset[str] = frozenset(
    {"greater", "greater_or_equal", "less", "less_or_equal", "between", "custom"}
)

# The field names this engine was written against. Their absence means the
# payload is not the one we parse, and guessing would produce a book of zeros.
REQUIRED_MARKET_FIELDS: tuple[str, ...] = (
    "ticker",
    "event_ticker",
    "status",
    "yes_bid_dollars",
    "yes_ask_dollars",
    "price_ranges",
)


class ParseError(ValueError):
    """A payload did not carry what this engine needs. Never silently defaulted."""


@dataclass(frozen=True, slots=True)
class Market:
    """One binary contract, with everything the lattice and the grid need."""

    ticker: str
    event_ticker: str
    series_ticker: str
    status: str
    strike_kind: StrikeKind
    floor_strike: Decimal | None
    cap_strike: Decimal | None
    grid: PriceGrid
    exchange_index: int
    yes_sub_title: str
    top: Book
    # What Kalshi publishes about SIZE, carried as the strings it sent. The
    # engine's names drop the wire's `_fp` and `_dollars` suffixes because
    # those describe the encoding, not the quantity.
    #
    # `None` means the venue did not send the key, which is a protocol change
    # and is the case `schema_probe` exists to make loud. It does NOT mean
    # zero: a settled ladder that never traded reports "0.00" truthfully, and
    # the two must stay distinguishable all the way to the browser.
    open_interest: str | None = None
    liquidity: str | None = None
    volume: str | None = None
    notional_value: str | None = None

    @property
    def is_open(self) -> bool:
        """Tradable right now.

        The market object's ``status`` vocabulary is NOT the ``/markets?status=``
        filter vocabulary — the filter takes ``open`` while the field returns
        ``active``. Comparing one to the other is a bug that silently matches
        nothing, so this property is the only place either word appears.
        """
        return self.status == "active"


@dataclass(frozen=True, slots=True)
class Event:
    """A family of markets that resolve together."""

    event_ticker: str
    series_ticker: str
    title: str
    mutually_exclusive: bool
    exchange_index: int
    settlement_sources: tuple[str, ...]
    markets: tuple[Market, ...]


@dataclass(frozen=True, slots=True)
class SeriesFees:
    """The fee shape a series trades under, before any scheduled override."""

    ticker: str
    fee_type: str
    fee_multiplier: Decimal
    settlement_sources: tuple[str, ...]


def _decimal_or_none(value: Any) -> Decimal | None:
    """A JSON number to Decimal via its string form, never via float.

    ``Decimal(87.3)`` is 87.2999999999999971578290569595992565155029296875.
    ``Decimal(str(87.3))`` is 87.3. Strikes are compared to each other to build
    the lattice, so the difference decides whether two ladders line up.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str) and value.strip():
        try:
            return Decimal(value.strip())
        except (ValueError, ArithmeticError):
            return None
    return None


def _strike_kind(raw: Any) -> StrikeKind:
    text = (raw or "").strip().lower() if isinstance(raw, str) else ""
    if text in _KNOWN_STRIKES:
        return text  # type: ignore[return-value]
    return "unknown"


def _settlement_sources(raw: Any) -> tuple[str, ...]:
    """Source names, sorted and de-duplicated.

    This is the only honest test for "these two markets pay on the same
    outcome". Two markets whose titles read alike can settle on different
    sources with different cut-offs, and when they resolve differently a
    "hedged" position pays zero or two dollars rather than one. Sorted so the
    comparison is order-independent.
    """
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return ()
    names = {str(item.get("name", "")).strip() for item in raw if isinstance(item, dict)}
    return tuple(sorted(name for name in names if name))


def _size(value: Any) -> str | None:
    """A published size, kept as the string it arrived as.

    Not `_decimal_or_none`: these are carried, compared and rendered as text,
    and a Decimal round-trip would reformat "0.0000" to "0" — losing the
    places the venue chose to send and making a measured zero look like a
    different number than the one published. Anything that is not a non-empty
    string is absent, never zero.
    """
    if isinstance(value, str) and value.strip():
        return value
    return None


def parse_market(payload: dict[str, Any], series_ticker: str = "") -> Market:
    """One Market object. Raises rather than filling gaps with zeros."""
    missing = [field for field in REQUIRED_MARKET_FIELDS if field not in payload]
    if missing:
        raise ParseError(f"market payload is missing {missing}; this is not the schema the engine parses")
    ticker = str(payload["ticker"])
    try:
        grid = parse_price_ranges(payload.get("price_ranges"), payload.get("price_level_structure"))
    except GridError as exc:
        raise ParseError(f"{ticker}: {exc}") from exc
    try:
        top = top_of_book(
            ticker,
            payload.get("yes_bid_dollars"),
            payload.get("yes_bid_size_fp"),
            payload.get("yes_ask_dollars"),
            payload.get("yes_ask_size_fp"),
        )
    except MoneyError as exc:
        raise ParseError(f"{ticker}: top of book did not parse: {exc}") from exc
    return Market(
        ticker=ticker,
        event_ticker=str(payload.get("event_ticker", "")),
        series_ticker=series_ticker or _series_from_event(str(payload.get("event_ticker", ""))),
        status=str(payload.get("status", "")),
        strike_kind=_strike_kind(payload.get("strike_type")),
        floor_strike=_decimal_or_none(payload.get("floor_strike")),
        cap_strike=_decimal_or_none(payload.get("cap_strike")),
        grid=grid,
        exchange_index=int(payload.get("exchange_index") or 0),
        yes_sub_title=str(payload.get("yes_sub_title", "")),
        top=top,
        open_interest=_size(payload.get("open_interest_fp")),
        liquidity=_size(payload.get("liquidity_dollars")),
        volume=_size(payload.get("volume_fp")),
        notional_value=_size(payload.get("notional_value_dollars")),
    )


def _series_from_event(event_ticker: str) -> str:
    """``KXHIGHNY-26AUG23`` to ``KXHIGHNY``.

    Only used when a market payload arrives without its series, which happens
    on the nested-market path. The ticker format is documented as stable.
    """
    return event_ticker.split("-", 1)[0] if event_ticker else ""


def parse_event(payload: dict[str, Any], markets: Sequence[dict[str, Any]] | None = None) -> Event:
    """One Event, with its child markets when they were requested."""
    event = payload.get("event", payload)
    event_ticker = str(event.get("event_ticker", ""))
    if not event_ticker:
        raise ParseError("event payload carries no event_ticker")
    series_ticker = str(event.get("series_ticker", "")) or _series_from_event(event_ticker)
    rows = list(markets or payload.get("markets") or event.get("markets") or [])
    return Event(
        event_ticker=event_ticker,
        series_ticker=series_ticker,
        title=str(event.get("title", "")),
        mutually_exclusive=bool(event.get("mutually_exclusive")),
        exchange_index=int(event.get("exchange_index") or 0),
        settlement_sources=_settlement_sources(event.get("settlement_sources")),
        markets=tuple(parse_market(row, series_ticker) for row in rows),
    )


def parse_series_fees(payload: dict[str, Any]) -> SeriesFees:
    """The fee shape from a ``/series`` payload.

    ``fee_multiplier`` MULTIPLIES the published base rate; it is not the rate.
    Live it is 1 on almost every series, 0.5 on some sports and 0 on a handful
    of long-dated ones, so reading it as the rate would price every fee at
    seven cents on the dollar too low.
    """
    series = payload.get("series", payload)
    multiplier = _decimal_or_none(series.get("fee_multiplier"))
    return SeriesFees(
        ticker=str(series.get("ticker", "")),
        fee_type=str(series.get("fee_type", "")),
        fee_multiplier=Decimal(1) if multiplier is None else multiplier,
        settlement_sources=_settlement_sources(series.get("settlement_sources")),
    )


def parse_orderbooks(payload: dict[str, Any]) -> dict[str, Book]:
    """The BULK orderbook response, keyed by ticker.

    Guards the trap that costs a whole exchange's worth of liquidity: the bulk
    route wants ``tickers`` REPEATED, and a comma-joined list comes back HTTP
    200 with one entry whose ticker is the joined string and whose ladders are
    empty. Empty ladders are legitimate, so nothing downstream can tell that
    apart from a quiet market — except here, where a ticker containing a comma
    is impossible and therefore diagnostic.
    """
    books: dict[str, Book] = {}
    for row in payload.get("orderbooks") or []:
        ticker = str(row.get("ticker", ""))
        if "," in ticker:
            raise ParseError(
                "bulk orderbook returned one entry for a comma-joined ticker list: "
                "pass `tickers` as a REPEATED query parameter, not a comma-separated one"
            )
        books[ticker] = parse_orderbook(ticker, row.get("orderbook_fp"))
    return books


def schema_probe(market_payload: dict[str, Any] | None) -> dict[str, Any]:
    """Report whether a payload is the fixed-point schema this engine parses.

    Cheap, and the thing that turns "every price is zero" into a sentence a
    person can act on. Reported by the status route rather than raised: a
    schema drift should be visible on the surface before it is fatal in a
    solve.
    """
    if not market_payload:
        return {"schema": "unavailable", "detail": "no market payload was read"}
    present = [field for field in REQUIRED_MARKET_FIELDS if field in market_payload]
    missing = [field for field in REQUIRED_MARKET_FIELDS if field not in market_payload]
    legacy = [field for field in ("yes_bid", "yes_ask", "last_price", "tick_size") if field in market_payload]
    if missing:
        return {"schema": "unexpected", "missing": missing, "legacy_fields_present": legacy}
    if legacy:
        return {"schema": "fp-2026", "detail": f"legacy integer fields still present: {legacy}"}
    return {"schema": "fp-2026", "fields_checked": len(present)}
