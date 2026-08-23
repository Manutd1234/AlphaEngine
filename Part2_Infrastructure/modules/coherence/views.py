"""Kernel types to wire types. The one place a Decimal becomes a string.

Kept out of the router so the shaping is testable without a request, and out of
the kernel so the kernel stays free of anything the wire cares about.

Every price crosses as a string. JSON has one numeric type and it is binary64,
so serialising a Decimal as a number would hand the browser the float the
kernel exists to avoid — and the browser would then compare it to a Kalshi
string that *is* exact. One representation, all the way through.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.drivers.kalshi_parse import Event, Market
from modules.coherence.kernel.book import Book, lesson_zero_identity
from modules.coherence.kernel.money import format_dollars
from modules.coherence.syscalls.observe import Observation
from modules.schemas_coherence import (
    CoherenceBookLevel,
    CoherenceBookView,
    CoherenceEventView,
    CoherenceMarketView,
)

# Why a side of a book is empty, in words. "No resting bids" and "we could not
# read the book" are different facts and the surface must not render them the
# same; zero is a legal price here, so the absence cannot be shown as a number.
UNQUOTED_ONE_SIDE = "no resting bids on this side; the spread is unknowable, not zero"
UNQUOTED_BOTH_SIDES = "nobody is quoting this market on either side"


def _price(value: Decimal | None) -> str | None:
    return None if value is None else format_dollars(value)


def _levels(levels: tuple) -> list[CoherenceBookLevel]:
    return [CoherenceBookLevel(price=format_dollars(level.price), size=str(level.size)) for level in levels]


def unquoted_reason(book: Book) -> str | None:
    """Name the absence, or return None when both sides are quoted."""
    if not book.yes_bids and not book.no_bids:
        return UNQUOTED_BOTH_SIDES
    if book.best_yes_bid is None or book.best_no_bid is None:
        return UNQUOTED_ONE_SIDE
    return None


def book_view(book: Book, source: str, ts_ns: int | None = None) -> CoherenceBookView:
    """One book, with the Lesson 0 identity computed once for the reader."""
    identity = lesson_zero_identity(book)
    return CoherenceBookView(
        ticker=book.ticker,
        depth=book.depth,
        source=source,
        ts_ns=ts_ns,
        yes_bids=_levels(book.bids("yes")),
        no_bids=_levels(book.bids("no")),
        yes_asks=_levels(book.asks("yes")),
        best_yes_bid=_price(book.best_yes_bid),
        best_no_bid=_price(book.best_no_bid),
        best_yes_ask=_price(book.best_yes_ask),
        best_no_ask=_price(book.best_no_ask),
        spread=_price(book.spread),
        identity_sum=None if identity is None else format_dollars(identity[0]),
        identity_one_plus_spread=None if identity is None else format_dollars(identity[1]),
        unquoted_reason=unquoted_reason(book),
    )


def market_view(market: Market, book: Book) -> CoherenceMarketView:
    return CoherenceMarketView(
        ticker=market.ticker,
        event_ticker=market.event_ticker,
        series_ticker=market.series_ticker,
        yes_sub_title=market.yes_sub_title,
        strike_kind=market.strike_kind,
        floor_strike=None if market.floor_strike is None else str(market.floor_strike),
        cap_strike=None if market.cap_strike is None else str(market.cap_strike),
        exchange_index=market.exchange_index,
        price_grid=market.grid.structure,
        yes_bid=_price(book.best_yes_bid),
        no_bid=_price(book.best_no_bid),
        yes_ask=_price(book.best_yes_ask),
        no_ask=_price(book.best_no_ask),
        spread=_price(book.spread),
        depth=book.depth,
        unquoted_reason=unquoted_reason(book),
    )


def basket_totals(observation: Observation) -> tuple[str | None, str | None, str | None]:
    """What the whole family costs to buy and pays to sell, and what that means.

    Only computed for a mutually exclusive event, because only there does the
    exchange assert that exactly one market resolves YES — which is what makes
    the sum a probability rather than an arbitrary total. Buckets need not tile
    in general, so deriving mutual exclusivity from floor/cap arithmetic would
    be inventing a claim the venue did not make.

    **The two sides are totalled independently, and this matters.** Buying the
    basket needs every ASK; selling it needs every BID. In the tails a market
    routinely has an ask and no bid — nobody will pay for "NYC above 87F", but
    it is offered at a cent — so an event that cannot be sold as a basket can
    very often still be bought as one. Requiring both sides before reporting
    either would blind the buy-side test, which is the one that finds the
    Dutch book, on exactly the events where the tails are thinnest.
    """
    if not observation.event.mutually_exclusive:
        return None, None, "this event is not mutually exclusive, so its prices need not sum to anything"
    if not observation.markets:
        return None, None, "no book was read for this event"

    ask_total: Decimal | None = Decimal(0)
    bid_total: Decimal | None = Decimal(0)
    ask_missing: str | None = None
    bid_missing: str | None = None
    for item in observation.markets:
        ask, bid = item.book.best_yes_ask, item.book.best_yes_bid
        if ask is None:
            ask_total, ask_missing = None, item.ticker
        elif ask_total is not None:
            ask_total += ask
        if bid is None:
            bid_total, bid_missing = None, item.ticker
        elif bid_total is not None:
            bid_total += bid

    return _price(ask_total), _price(bid_total), _basket_note(ask_total, bid_total, ask_missing, bid_missing)


def _basket_note(
    ask_total: Decimal | None,
    bid_total: Decimal | None,
    ask_missing: str | None,
    bid_missing: str | None,
) -> str:
    """One sentence a reader can act on, naming any side that is unanswerable."""
    parts: list[str] = []
    if ask_total is None:
        parts.append(f"the basket cannot be bought as a whole: {ask_missing} is offered by nobody")
    elif ask_total < Decimal(1):
        parts.append(
            f"buying every outcome costs {format_dollars(ask_total)} for a guaranteed $1 "
            "— before fees, this is a Dutch book"
        )
    else:
        parts.append(f"buying every outcome costs {format_dollars(ask_total)} for a guaranteed $1")

    if bid_total is None:
        parts.append(f"it cannot be sold as a whole: nobody bids on {bid_missing}")
    elif bid_total > Decimal(1):
        parts.append(
            f"selling every outcome pays {format_dollars(bid_total)} against a $1 liability "
            "— before fees, this is a Dutch book"
        )
    else:
        parts.append(f"selling every outcome pays {format_dollars(bid_total)}")
    return "; ".join(parts)


def event_view(observation: Observation) -> CoherenceEventView:
    """One observed event, priced and totalled."""
    event: Event = observation.event
    by_ticker = {item.ticker: item for item in observation.markets}
    markets = [
        market_view(market, by_ticker[market.ticker].book)
        for market in event.markets
        if market.ticker in by_ticker
    ]
    ask_total, bid_total, note = basket_totals(observation)
    return CoherenceEventView(
        event_ticker=event.event_ticker,
        series_ticker=event.series_ticker,
        title=event.title,
        mutually_exclusive=event.mutually_exclusive,
        exchange_index=event.exchange_index,
        settlement_sources=list(event.settlement_sources),
        markets=markets,
        yes_ask_total=ask_total,
        yes_bid_total=bid_total,
        basket_note=note,
    )
