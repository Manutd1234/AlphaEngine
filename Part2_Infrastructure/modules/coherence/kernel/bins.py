"""The bins a family's prices fall into, and the readings that build them.

Split out of ``distribution.py`` when that module reached its length ceiling.
The seam is a real one: this file knows how to turn a set of quoted markets
into intervals with mass on them, and ``distribution.py`` knows what to say
about the result — totals, tails, moments, and the reason there is no reading.

Three builders, because Kalshi lists three shapes and they are not variations
of one another:

* **A ladder** quotes points of a survival function, so its bins are the
  DIFFERENCES between adjacent strikes and belong to no single market. Their
  ``ticker`` is ``None``, and that is load-bearing — a caller that sizes
  positions cannot use a ladder bin, because the mass between two strikes is
  not any one contract's probability.
* **Intervals** (buckets, with "or below" and "or above" closing the ends)
  quote their own mass directly. Each bin carries its market's ticker.
* **Named outcomes** are the same, minus the axis.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from modules.coherence.kernel.book import Book
from modules.coherence.kernel.lattice import Node
from modules.coherence.kernel.money import DOLLAR, one_minus

Basis = Literal["mid", "ask", "bid"]
Engine = Literal["ladder", "bucket", "named", "unavailable"]


@dataclass(frozen=True, slots=True)
class Probe:
    """One reading of the survival function, and which market gave it."""

    strike: Decimal
    survival: Decimal
    ticker: str
    label: str
    #: "greater" for a threshold read directly, "ceiling" for one inverted from
    #: a P(X <= k) market. Kept because the two disagree at the atom itself and
    #: merging them silently would invent precision on an integer underlying.
    origin: Literal["threshold", "ceiling"]


@dataclass(frozen=True, slots=True)
class Bin:
    """One interval of the axis and the mass the prices put in it."""

    label: str
    low: Decimal | None
    high: Decimal | None
    mass: Decimal
    #: The interval's midpoint, or None where the interval is unbounded and has
    #: no representative point. Moments are computable only over bins that have one.
    representative: Decimal | None
    #: The market whose price IS this bin's mass, where one exists: set on the
    #: bucket and named readings, None on a ladder, whose bins are the gaps
    #: BETWEEN markets. Carried so a caller matches a bin to a market by
    #: identity — nodes come in the venue's listing order and bins along the
    #: axis, so pairing by position sizes each market against another's mass.
    ticker: str | None = None

    @property
    def is_negative(self) -> bool:
        return self.mass < 0

    @property
    def bounded(self) -> bool:
        return self.low is not None and self.high is not None


def _reading(book: Book | None, basis: Basis) -> Decimal | None:
    if book is None:
        return None
    if basis == "mid":
        return book.mid
    if basis == "ask":
        return book.best_yes_ask
    return book.best_yes_bid


def _choose_basis(nodes: list[Node], books: dict[str, Book]) -> tuple[Basis | None, int]:
    """The basis that reads the most of this family, and how many it reads.

    Mid where two-sided, ask where merely offered; mid wins a tie, being the
    market's estimate rather than what one side charges.

    Coverage, not completeness — earned on a real ladder. A BTC hourly event
    lists sixty strikes whose far wings nobody quotes, so demanding every
    strike be priced refused a family with forty live ones in it. Differencing
    needs two adjacent *quoted* strikes; the rest are skipped and counted,
    never treated as zero.
    """
    best: tuple[Basis | None, int] = (None, 0)
    for basis in ("mid", "ask", "bid"):
        covered = sum(1 for node in nodes if _reading(books.get(node.ticker), basis) is not None)
        if covered > best[1]:
            best = (basis, covered)  # type: ignore[assignment]
    return best if best[1] >= 2 else (None, best[1])


def _probes(nodes: list[Node], books: dict[str, Book], basis: Basis) -> list[Probe]:
    found: list[Probe] = []
    for node in nodes:
        price = _reading(books.get(node.ticker), basis)
        if price is None:
            continue
        if node.is_threshold and node.floor_strike is not None:
            found.append(Probe(node.floor_strike, price, node.ticker, node.label, "threshold"))
        elif node.is_ceiling and node.cap_strike is not None:
            # P(X <= k) = p, so P(X > k) = 1 - p. The same curve read backwards.
            found.append(Probe(node.cap_strike, one_minus(price), node.ticker, node.label, "ceiling"))
    return sorted(found, key=lambda probe: probe.strike)


def _midpoint(low: Decimal | None, high: Decimal | None) -> Decimal | None:
    if low is None or high is None:
        return None
    return (low + high) / 2


def _ladder_bins(probes: list[Probe]) -> list[Bin]:
    """Differences along the survival curve. The subtraction this module is for."""
    bins: list[Bin] = [
        Bin(
            label=f"at or below {probes[0].strike}",
            low=None,
            high=probes[0].strike,
            mass=DOLLAR - probes[0].survival,
            representative=None,
        )
    ]
    for lower, upper in zip(probes, probes[1:], strict=False):
        bins.append(
            Bin(
                label=f"{lower.strike} to {upper.strike}",
                low=lower.strike,
                high=upper.strike,
                mass=lower.survival - upper.survival,
                representative=_midpoint(lower.strike, upper.strike),
            )
        )
    bins.append(
        Bin(
            label=f"above {probes[-1].strike}",
            low=probes[-1].strike,
            high=None,
            mass=probes[-1].survival,
            representative=None,
        )
    )
    return bins


def _axis_key(node: Node) -> Decimal:
    """Where a market sits on the axis, for ordering. Open ends included."""
    if node.floor_strike is not None:
        return node.floor_strike
    if node.cap_strike is not None:
        return node.cap_strike - DOLLAR
    return Decimal(0)


def _numeric_bins(nodes: list[Node], books: dict[str, Book], basis: Basis) -> list[Bin]:
    """Each market quotes its own interval directly; no differencing needed.

    Written for the shape a bucket family actually has: the NYC daily-high
    event is four buckets with a "77 or below" and an "86 or above" closing the
    ends. Demanding both a floor and a cap dropped those two — the ones holding
    the tail mass — so an open end is kept, and the moment code already reads a
    bin with no midpoint as outside the interior it reports on.
    """
    bins: list[Bin] = []
    for node in sorted(nodes, key=_axis_key):
        price = _reading(books.get(node.ticker), basis)
        if price is None:
            continue
        low = node.floor_strike if (node.is_bucket or node.is_threshold) else None
        high = node.cap_strike if (node.is_bucket or node.is_ceiling) else None
        if low is None and high is None:
            continue
        bins.append(
            Bin(
                label=node.label,
                low=low,
                high=high,
                mass=price,
                representative=_midpoint(low, high),
                ticker=node.ticker,
            )
        )
    return bins


def _named_bins(nodes: list[Node], books: dict[str, Book], basis: Basis) -> list[Bin]:
    bins: list[Bin] = []
    for node in nodes:
        price = _reading(books.get(node.ticker), basis)
        if price is None:
            continue
        bins.append(
            Bin(label=node.label, low=None, high=None, mass=price, representative=None, ticker=node.ticker)
        )
    return bins
