"""A Kalshi orderbook: two bid ladders, and the asks they imply.

Kalshi does not publish asks. ``orderbook_fp`` carries ``yes_dollars`` and
``no_dollars``, and **both are bid ladders** — resting buy orders for the YES
side and resting buy orders for the NO side. An ask is a reading of the other
ladder, not a separate queue: someone bidding $0.56 for NO is offering YES at
$0.44, because the two contracts are one dollar between them.

That single fact retires a strategy. Two of the most-starred bots in this space
hunt for ``yes_ask + no_ask < $1`` — buy both sides, collect a dollar, pocket
the difference. Substitute the definitions:

    yes_ask + no_ask = (1 - no_bid) + (1 - yes_bid)
                     = 2 - (yes_bid + no_bid)
                     = 1 + spread            >= 1, always

The sum is one plus the spread. It is never below a dollar, and the branch that
looks for it is dead code. If it ever appears to fire, the two ladders were
read at different instants — a torn snapshot, not an opportunity.

This module is Lesson 0, and ``tests/test_coherence_lesson_0.py`` proves the
identity on the documentation's own example and on fuzzed ladders.

Two representation decisions worth stating:

* Ladders are kept **as the venue sent them**, ascending, best bid LAST. Kalshi
  sorts ascending; re-sorting on ingest would mean every future reader has to
  know which convention this file chose, and a reversed ladder is a silent
  error rather than a loud one.
* An absent quote is ``None``, never zero. **Zero is a legal Kalshi price** — a
  contract nobody believes in trades at a cent and can be bid at zero — so a
  book with no resting orders and a book bid at nothing are different facts,
  and collapsing them is the defect this codebase is most alert to.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Sequence

from modules.coherence.kernel.money import contracts, one_minus, parse_dollars, parse_fp

Side = Literal["yes", "no"]

# What a book was read from. A top-of-book reading carries one level per side
# and cannot answer a depth question, so the difference travels with the data
# rather than being inferred from the number of levels.
Depth = Literal["full", "top_of_book"]


@dataclass(frozen=True, slots=True)
class Level:
    """One resting price level: a price in dollars and a size in hundredths."""

    price: Decimal
    size_hundredths: int

    @property
    def size(self) -> Decimal:
        return contracts(self.size_hundredths)


@dataclass(frozen=True, slots=True)
class Book:
    """One market's two bid ladders at one instant.

    ``ticker`` and ``seq`` are carried so a certificate can name the exact
    snapshot it was computed from; an arbitrage claim that cannot be traced to
    a book is not evidence.
    """

    ticker: str
    yes_bids: tuple[Level, ...]
    no_bids: tuple[Level, ...]
    depth: Depth = "full"

    @property
    def best_yes_bid(self) -> Decimal | None:
        """Highest price anyone will pay for YES, or None if nobody will."""
        return self.yes_bids[-1].price if self.yes_bids else None

    @property
    def best_no_bid(self) -> Decimal | None:
        return self.no_bids[-1].price if self.no_bids else None

    @property
    def best_yes_ask(self) -> Decimal | None:
        """Cheapest YES you can buy — read off the NO ladder.

        None when nobody bids NO: with no NO bids there is no YES offer, which
        is a market you cannot buy into, not a market that is free.
        """
        best_no = self.best_no_bid
        return None if best_no is None else one_minus(best_no)

    @property
    def best_no_ask(self) -> Decimal | None:
        best_yes = self.best_yes_bid
        return None if best_yes is None else one_minus(best_yes)

    @property
    def spread(self) -> Decimal | None:
        """``yes_ask - yes_bid``, or None when either side is unquoted."""
        ask, bid = self.best_yes_ask, self.best_yes_bid
        return None if ask is None or bid is None else ask - bid

    @property
    def mid(self) -> Decimal | None:
        """The midpoint, for display only.

        Never use a mid as an execution price: it is a number nobody is
        offering. The cost model prices against the ladder.
        """
        ask, bid = self.best_yes_ask, self.best_yes_bid
        return None if ask is None or bid is None else (ask + bid) / 2

    def asks(self, side: Side) -> tuple[Level, ...]:
        """The implied ask ladder for one side, cheapest first.

        The opposite side's bids, priced at ``1 - p`` and reversed: the highest
        opposing bid is the cheapest offer here. Sizes carry across untouched —
        a bid for 13 NO contracts is an offer of 13 YES contracts.
        """
        source = self.no_bids if side == "yes" else self.yes_bids
        return tuple(Level(price=one_minus(level.price), size_hundredths=level.size_hundredths) for level in reversed(source))

    def bids(self, side: Side) -> tuple[Level, ...]:
        """The real resting bids for one side, best first."""
        source = self.yes_bids if side == "yes" else self.no_bids
        return tuple(reversed(source))


def lesson_zero_identity(book: Book) -> tuple[Decimal, Decimal] | None:
    """Return ``(yes_ask + no_ask, 1 + spread)`` — equal, always.

    Returned as a pair rather than a bool so the caller can *show* the two
    numbers. A lesson that asserts "trust me, these are equal" teaches nothing;
    the pane prints both sides of the identity for the market in front of you.
    None when either ladder is empty and the identity has no terms.
    """
    yes_ask, no_ask, spread = book.best_yes_ask, book.best_no_ask, book.spread
    if yes_ask is None or no_ask is None or spread is None:
        return None
    return yes_ask + no_ask, Decimal(1) + spread


def parse_orderbook(ticker: str, orderbook_fp: dict | None, depth: Depth = "full") -> Book:
    """Build a Book from one ``orderbook_fp`` payload.

    A missing or empty payload yields a Book with no levels — a real state,
    reported as such — rather than an exception. An unparseable *level*, by
    contrast, raises: a ladder we half-understand is worse than none.
    """
    payload = orderbook_fp or {}
    return Book(
        ticker=ticker,
        yes_bids=_ladder(payload.get("yes_dollars")),
        no_bids=_ladder(payload.get("no_dollars")),
        depth=depth,
    )


def _ladder(raw: Sequence[Sequence[str]] | None) -> tuple[Level, ...]:
    """``[[price, count], ...]`` to levels, keeping the venue's ascending order."""
    if not raw:
        return ()
    return tuple(Level(price=parse_dollars(pair[0]), size_hundredths=parse_fp(pair[1])) for pair in raw)


def top_of_book(
    ticker: str,
    yes_bid: str | None,
    yes_bid_size_fp: str | None,
    yes_ask: str | None,
    yes_ask_size_fp: str | None,
) -> Book:
    """Build a Book from a Market object's top-of-book fields.

    The fallback for when the orderbook route refuses us. A YES *ask* on the
    Market object is stored here as the NO bid that implies it, so that the
    rest of the engine sees one representation and the ``depth`` flag is the
    only thing that says how much it knows.
    """
    yes_bids = ()
    no_bids = ()
    if yes_bid is not None and yes_bid_size_fp is not None:
        price = parse_dollars(yes_bid)
        if price > 0:
            yes_bids = (Level(price=price, size_hundredths=parse_fp(yes_bid_size_fp)),)
    if yes_ask is not None and yes_ask_size_fp is not None:
        price = parse_dollars(yes_ask)
        if price > 0:
            no_bids = (Level(price=one_minus(price), size_hundredths=parse_fp(yes_ask_size_fp)),)
    return Book(ticker=ticker, yes_bids=yes_bids, no_bids=no_bids, depth="top_of_book")
