"""Lattice edges as linear rows, each carrying the sentence it prints.

A constraint is a claim about a price vector that a trade can exploit when it
fails. Every family here is written the same way — as ``Σ cᵢ · pᵢ ≤ bound`` over
executable prices — because that is the form the solver takes and the form a
certificate can be checked in by hand.

The coefficients are the important part and they are not symmetric. To *buy* an
outcome you pay its ask; to *sell* it you receive its bid. A constraint written
against mid prices is a constraint about a market nobody is quoting, and it will
report violations that cannot be traded. So each row records, per leg, whether
exploiting it means buying or selling, and the price used is the one that side
of the trade actually pays.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Sequence

from modules.coherence.kernel.book import Book, Side
from modules.coherence.kernel.lattice import Component, EdgeScope

# Which of the spec's families a row belongs to. Carried so a certificate can
# name the reasoning rather than only the arithmetic, and so a family can be
# switched off in an ablation without unpicking the matrix.
Family = Literal["book", "monotone", "additive", "bucket", "density", "frechet"]

Direction = Literal["buy", "sell"]


@dataclass(frozen=True, slots=True)
class Leg:
    """One market in a constraint, and what exploiting it would cost.

    ``price`` is None when that side of the book is unquoted, which makes the
    whole row untestable — not satisfied. The two are opposite conclusions and
    conflating them is how an engine reports a clean market it never read.
    """

    ticker: str
    label: str
    direction: Direction
    price: Decimal | None
    size_hundredths: int
    #: Which contract of the market is traded. Defaulted to YES because every
    #: single-market family reasons in YES terms, and named explicitly by the
    #: combo family, where a leg is routinely the NO side of its market and an
    #: order plan that lost that fact would send the opposite trade.
    side: Side = "yes"


@dataclass(frozen=True, slots=True)
class Row:
    """One testable claim.

    ``slack`` is what the prices leave on the table: negative means the claim
    is violated and by how much, before fees. Positive or zero means coherent.
    """

    family: Family
    scope: EdgeScope
    because: str
    legs: tuple[Leg, ...]
    bound: Decimal

    @property
    def testable(self) -> bool:
        return all(leg.price is not None for leg in self.legs)

    @property
    def untestable_reason(self) -> str | None:
        if self.testable:
            return None
        missing = [leg.ticker for leg in self.legs if leg.price is None]
        return f"unquoted on the side this row needs: {', '.join(missing)}"

    @property
    def cost(self) -> Decimal | None:
        """What the portfolio in this row costs to put on, before fees.

        Buys are paid, sells are received. The claim is violated when the cost
        is below the bound — you paid less than the payoff you are guaranteed.
        """
        if not self.testable:
            return None
        total = Decimal(0)
        for leg in self.legs:
            price = leg.price or Decimal(0)
            total += price if leg.direction == "buy" else -price
        return total

    @property
    def slack(self) -> Decimal | None:
        cost = self.cost
        return None if cost is None else cost - self.bound

    @property
    def violated(self) -> bool:
        slack = self.slack
        return slack is not None and slack < 0

    @property
    def executable_size_hundredths(self) -> int:
        """The most this row can be traded at these prices.

        The smallest resting size across the legs, because every leg has to
        fill: a portfolio sized to its deepest leg is not the portfolio that
        was priced.
        """
        return min((leg.size_hundredths for leg in self.legs), default=0)


def _ask(book: Book | None) -> tuple[Decimal | None, int]:
    if book is None:
        return None, 0
    levels = book.asks("yes")
    return (levels[0].price, levels[0].size_hundredths) if levels else (None, 0)


def _bid(book: Book | None) -> tuple[Decimal | None, int]:
    if book is None:
        return None, 0
    levels = book.bids("yes")
    return (levels[0].price, levels[0].size_hundredths) if levels else (None, 0)


def _leg(ticker: str, label: str, direction: Direction, book: Book | None) -> Leg:
    price, size = _ask(book) if direction == "buy" else _bid(book)
    return Leg(ticker=ticker, label=label, direction=direction, price=price, size_hundredths=size)


def rows_for(component: Component, books: dict[str, Book], families: Sequence[Family] | None = None) -> list[Row]:
    """Every constraint this component's structure supports, as rows.

    ``families`` exists for the ablation harness: running the same tape with a
    family switched off is how you find out whether it earns its complexity.
    """
    wanted = set(families or ("book", "monotone", "additive", "bucket", "density"))
    labels = {node.ticker: node.label for node in component.nodes}
    rows: list[Row] = []

    if "monotone" in wanted:
        for edge in component.edges:
            if edge.kind != "implies":
                continue
            # A implies B means P(A) <= P(B). Exploit a violation by buying the
            # cheap-but-more-likely leg and selling the dear-but-less-likely
            # one: buy B, sell A, and the pair pays >= 0 in every state.
            rows.append(
                Row(
                    family="monotone",
                    scope=edge.scope,
                    because=edge.because,
                    legs=(
                        _leg(edge.target, labels.get(edge.target, edge.target), "buy", books.get(edge.target)),
                        _leg(edge.source, labels.get(edge.source, edge.source), "sell", books.get(edge.source)),
                    ),
                    # Buying the weaker claim and selling the stronger one can
                    # never cost less than nothing: the pair's payoff is the
                    # indicator of "B but not A", which is never negative.
                    bound=Decimal(0),
                )
            )

    if "additive" in wanted and component.mutually_exclusive and len(component.nodes) > 1:
        # Exactly one outcome resolves YES, so buying every outcome buys a
        # dollar. Paying less than a dollar for it is a Dutch book.
        rows.append(
            Row(
                family="additive",
                scope="same-event",
                because=(
                    "the exchange marks this event mutually exclusive, so buying every outcome "
                    "buys exactly one dollar of payoff"
                ),
                legs=tuple(
                    _leg(node.ticker, node.label, "buy", books.get(node.ticker)) for node in component.nodes
                ),
                bound=Decimal(1),
            )
        )
        # And the mirror: selling every outcome sells a dollar of liability, so
        # being paid more than a dollar for it is the same book from the other
        # side. Written as its own row because the two fail independently —
        # one side of a book can be unquoted while the other is not.
        rows.append(
            Row(
                family="additive",
                scope="same-event",
                because=(
                    "selling every outcome of a mutually exclusive event sells exactly one dollar "
                    "of liability, so being paid more than a dollar for it is the same Dutch book"
                ),
                legs=tuple(
                    _leg(node.ticker, node.label, "sell", books.get(node.ticker)) for node in component.nodes
                ),
                bound=Decimal(-1),
            )
        )

    if "bucket" in wanted:
        rows.extend(_bucket_rows(component, books, labels))

    # A venue can publish a perfectly live book without publishing a relation
    # between its siblings. In that case there is no honest joint state space
    # for the LP, but the executable quote still makes three exact claims of
    # its own: bid and ask lie inside the contract's [0, 1] payoff range, and
    # the ask is not below the bid. Emit these only when no structural row can
    # be exercised, so a real ladder/exhaustive family keeps its stronger,
    # cross-market proof instead of padding it with tautological checks.
    if "book" in wanted and not any(row.testable for row in rows):
        rows.extend(_book_rows(component, books, labels))

    return rows


def _book_rows(component: Component, books: dict[str, Book], labels: dict[str, str]) -> list[Row]:
    """Executable single-market invariants when no joint relation is published."""
    rows: list[Row] = []
    for node in component.nodes:
        label = labels.get(node.ticker, node.ticker)
        book = books.get(node.ticker)
        ask = _leg(node.ticker, label, "buy", book)
        bid = _leg(node.ticker, label, "sell", book)
        rows.extend((
            Row(
                family="book",
                scope="same-event",
                because=f"{label}'s executable YES ask cannot be below the contract's zero-dollar payoff floor",
                legs=(ask,),
                bound=Decimal(0),
            ),
            Row(
                family="book",
                scope="same-event",
                because=f"{label}'s executable YES bid cannot exceed the contract's one-dollar payoff ceiling",
                legs=(bid,),
                bound=Decimal(-1),
            ),
            Row(
                family="book",
                scope="same-event",
                because=f"buying and immediately selling {label} cannot have a negative executable spread",
                legs=(ask, bid),
                bound=Decimal(0),
            ),
        ))
    return rows


def _bucket_rows(component: Component, books: dict[str, Book], labels: dict[str, str]) -> list[Row]:
    """``P(a <= X < b) = S(a) - S(b)`` — a bucket against the ladder around it.

    The highest-value family in the spec, and the one that spans two books that
    nothing else reconciles: the bucket market and the two threshold markets
    that bracket it are quoted independently, so their prices need not agree
    and frequently do not.
    """
    rows: list[Row] = []
    thresholds = sorted(
        (node for node in component.nodes if node.is_threshold),
        key=lambda node: node.floor_strike or Decimal(0),
    )
    for bucket in (node for node in component.nodes if node.is_bucket):
        low = next((n for n in thresholds if n.floor_strike == bucket.floor_strike), None)
        high = next((n for n in thresholds if n.floor_strike == bucket.cap_strike), None)
        if low is None or high is None:
            continue
        # Buy the bucket and the upper threshold, sell the lower: the payoff is
        # 1{a<=X<b} + 1{X>=b} - 1{X>=a}, which is zero in every state. Paying
        # anything for a portfolio that always pays nothing is a loss; being
        # paid for it is the arbitrage.
        rows.append(
            Row(
                family="bucket",
                scope="same-event",
                because=(
                    f"{bucket.label} happens exactly when the outcome clears {bucket.floor_strike} "
                    f"but not {bucket.cap_strike}, so its price is the difference between those two thresholds"
                ),
                legs=(
                    _leg(bucket.ticker, labels.get(bucket.ticker, bucket.ticker), "buy", books.get(bucket.ticker)),
                    _leg(high.ticker, labels.get(high.ticker, high.ticker), "buy", books.get(high.ticker)),
                    _leg(low.ticker, labels.get(low.ticker, low.ticker), "sell", books.get(low.ticker)),
                ),
                bound=Decimal(0),
            )
        )
    return rows
