"""How far a family's prices sit from the nearest set that admits a probability.

The Dutch-book test answers yes or no. This answers *how badly* — the distance,
in dollars per contract, from the quoted price vector to the nearest coherent
one. That turns a rare binary event into a continuous measurement that exists on
every poll, which is what makes a time series possible.

    CI = min || p_quoted - q ||_1   over valid probability measures q

Logged per series it becomes something nobody publishes: a pricing-efficiency
record for this exchange, from first principles. Which families are structurally
sloppy? Does incoherence spike at the open, on news, in the last hour before
settlement? Those are questions about a tape, and the tape only exists if the
number is recorded on the ordinary days too.

Two honesty rules the whole series depends on:

* An event whose books could not be read has **no index**, stored as null. A
  zero there would read as perfectly coherent — the most misleading value
  available — and it would sit in the same column as real measurements.
* The index is computed from mid-market prices, not from the executable side.
  That is deliberate and it is the opposite of what the arbitrage test does: the
  question here is "how far is this price vector from consistency", which is a
  property of the quotes, while "can this be traded" is a property of the book.
  Mixing them produces a number that moves when the spread widens and nothing
  else changed.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from modules.coherence.kernel.book import Book
from modules.coherence.kernel.lattice import Component
from modules.coherence.kernel.money import DOLLAR
from modules.coherence.kernel.states import build_states


@dataclass(frozen=True, slots=True)
class IndexReading:
    """One measurement, or a named reason there is none."""

    ci: Decimal | None
    engine: str
    detail: str
    #: How many of the family's markets carried a usable mid.
    markets_priced: int = 0
    markets_total: int = 0

    @property
    def measurable(self) -> bool:
        return self.ci is not None


def _mid(book: Book | None) -> Decimal | None:
    """The midpoint, or None. Never a one-sided guess.

    A market quoted only on one side has no mid: taking the quoted side alone
    would be reading an ask as a probability, which overstates it by half the
    spread on every observation — the systematic bias that inflates a whole
    dataset without ever looking wrong.
    """
    return book.mid if book is not None else None


def measure(component: Component, books: dict[str, Book]) -> IndexReading:
    """The L1 distance from these quotes to the nearest coherent price vector.

    For a mutually exclusive family this has a closed form. The constraint is
    ``Σ q = 1`` over non-negative q, so the nearest coherent vector under L1 is
    reached by moving the total to one, and the distance is ``|Σ p - 1|``. No
    solver is needed and none is used: an LP here would return the same number
    with a dependency attached.

    For a family without that constraint the measure is not defined by this
    module, and it says so rather than returning zero — which would place every
    unconstrained family at perfect efficiency in the leaderboard.
    """
    space = build_states(component)
    total_markets = len(component.nodes)

    if not component.mutually_exclusive:
        return IndexReading(
            ci=None,
            engine="unavailable",
            detail=(
                "this event is not mutually exclusive, so its prices are under no summation "
                "constraint and there is no distance to measure"
            ),
            markets_total=total_markets,
        )

    if space.is_empty:
        return IndexReading(ci=None, engine="unavailable", detail=space.note, markets_total=total_markets)

    mids = [_mid(books.get(node.ticker)) for node in component.nodes]
    priced = [mid for mid in mids if mid is not None]
    if len(priced) != len(mids):
        missing = len(mids) - len(priced)
        return IndexReading(
            ci=None,
            engine="unavailable",
            detail=(
                f"{missing} of {len(mids)} markets are quoted on one side only, so this family has no "
                "mid-price vector to measure; a one-sided quote read as a probability overstates it "
                "by half the spread"
            ),
            markets_priced=len(priced),
            markets_total=total_markets,
        )

    total = sum(priced, Decimal(0))
    return IndexReading(
        ci=abs(total - DOLLAR),
        engine="closed_form",
        detail=f"mid prices sum to {total}; the nearest coherent vector is {abs(total - DOLLAR)} away",
        markets_priced=len(priced),
        markets_total=total_markets,
    )
