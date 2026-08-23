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
* The index is computed from mid-market prices where they exist, not from the
  executable side. That is deliberate and it is the opposite of what the
  arbitrage test does: the question here is "how far is this price vector from
  consistency", which is a property of the quotes, while "can this be traded" is
  a property of the book. Mixing them produces a number that moves when the
  spread widens and nothing else changed.

Two families are measured, and the second was added because without it this
module returned null for almost everything on the exchange.

**Mutually exclusive families** are constrained by ``sum(q) = 1``, so the
distance is ``|sum(p) - 1|`` and no solver is needed.

**Threshold ladders** — a run of "above k" markets on one underlying — are
constrained differently and just as hard. They sample a survival function, and a
survival function cannot increase: ``{X > 100}`` is contained in ``{X > 95}``, so
``p(>100) <= p(>95)`` at every adjacent pair. The nearest coherent vector is the
nearest non-increasing one, which is the isotonic regression of the quotes under
L1, and the distance to it is the index. Crypto ladders are not marked mutually
exclusive — measured, ``KXBTCD`` is not — so before this existed the whole crypto
complex reported ``None`` on every poll, and the shard-migration comparison this
engine was built to make would have recorded a column of nulls.
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


def _isotonic_l1_distance(values: list[Decimal]) -> Decimal:
    """L1 distance from a sequence to the nearest non-increasing one.

    Pool-adjacent-violators, which is exact rather than approximate: while any
    adjacent pair increases, merge the block and replace it with its median —
    the L1-optimal constant for a block — and repeat. The result is the closest
    monotone sequence, and the distance to it is what we report.

    The median rather than the mean because the objective is L1. Using the mean
    would solve the L2 problem and quietly report a different quantity than the
    one this module documents.
    """
    if len(values) < 2:
        return Decimal(0)

    # Blocks of (values, weight) merged left to right.
    blocks: list[list[Decimal]] = [[value] for value in values]
    merged = True
    while merged:
        merged = False
        for index in range(len(blocks) - 1):
            left, right = blocks[index], blocks[index + 1]
            if _median(left) < _median(right):
                blocks[index : index + 2] = [left + right]
                merged = True
                break

    fitted: list[Decimal] = []
    for block in blocks:
        fitted.extend([_median(block)] * len(block))
    return sum((abs(value - fit) for value, fit in zip(values, fitted, strict=True)), Decimal(0))


def _median(values: list[Decimal]) -> Decimal:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _ladder_reading(component: Component, books: dict[str, Book]) -> IndexReading:
    """The index for a threshold ladder: distance to the nearest monotone curve."""
    rungs = sorted(
        (node for node in component.nodes if node.is_threshold),
        key=lambda node: node.floor_strike or Decimal(0),
    )
    priced: list[Decimal] = []
    for node in rungs:
        mid = _mid(books.get(node.ticker))
        if mid is not None:
            priced.append(mid)

    if len(priced) < 3:
        return IndexReading(
            ci=None,
            engine="unavailable",
            detail=(
                f"only {len(priced)} of {len(rungs)} rungs carry a two-sided quote; "
                "a survival curve needs at least three points to be worth fitting"
            ),
            markets_priced=len(priced),
            markets_total=len(component.nodes),
        )

    distance = _isotonic_l1_distance(priced)
    return IndexReading(
        ci=distance,
        engine="isotonic",
        detail=(
            f"{len(priced)} rungs; the quoted survival curve is {distance} away from the nearest "
            "non-increasing one, summed across the ladder"
        ),
        markets_priced=len(priced),
        markets_total=len(component.nodes),
    )


def _ask(book: Book | None) -> Decimal | None:
    """The cheapest offer, or None. Used only by the ask-side fallback."""
    return book.best_yes_ask if book is not None else None


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
        # Not exclusive is not unconstrained. A threshold ladder is bound by
        # monotonicity just as tightly as a basket is by summation, and this is
        # the branch that makes the crypto complex measurable at all.
        if sum(1 for node in component.nodes if node.is_threshold) >= 3:
            return _ladder_reading(component, books)
        return IndexReading(
            ci=None,
            engine="unavailable",
            detail=(
                "this event is neither mutually exclusive nor a threshold ladder, so its prices "
                "are under no constraint this module knows how to measure a distance from"
            ),
            markets_total=total_markets,
        )

    if space.is_empty:
        return IndexReading(ci=None, engine="unavailable", detail=space.note, markets_total=total_markets)

    mids = [_mid(books.get(node.ticker)) for node in component.nodes]
    priced = [mid for mid in mids if mid is not None]
    if len(priced) != len(mids):
        # A tail market with an ask and no bid is the ordinary case, not a
        # fault: nobody bids for the outcome that will not happen. Refusing to
        # measure whenever one exists made this null on almost every real
        # family, which is a more misleading answer than the one available.
        #
        # So fall back to the ASK side, which is defined whenever every outcome
        # is offered, and name the engine differently so the series is never
        # silently two measurements in one column. This is not the mid-price
        # distance — it is what buying the whole basket costs against the dollar
        # it pays, which is a real quantity and a strictly upper one.
        asks = [_ask(books.get(node.ticker)) for node in component.nodes]
        offered = [ask for ask in asks if ask is not None]
        missing = len(mids) - len(priced)
        if len(offered) == len(asks):
            total = sum(offered, Decimal(0))
            return IndexReading(
                ci=abs(total - DOLLAR),
                engine="ask_side",
                detail=(
                    f"{missing} of {len(mids)} markets are quoted on one side only, so this is the "
                    f"ask-side distance rather than the mid-price one: buying every outcome costs "
                    f"{total} against the dollar it pays"
                ),
                markets_priced=len(offered),
                markets_total=total_markets,
            )
        return IndexReading(
            ci=None,
            engine="unavailable",
            detail=(
                f"{missing} of {len(mids)} markets are quoted on one side only and not all of them "
                "are even offered, so the family has neither a mid-price vector nor an ask-side total"
            ),
            markets_priced=len(priced),
            markets_total=total_markets,
        )

    total = sum(priced, Decimal(0))
    return IndexReading(
        ci=abs(total - DOLLAR),
        engine="mid_sum",
        detail=f"mid prices sum to {total}; the nearest coherent vector is {abs(total - DOLLAR)} away",
        markets_priced=len(priced),
        markets_total=total_markets,
    )
