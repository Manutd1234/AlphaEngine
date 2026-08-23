"""The distribution the prices imply, read off the ladder one difference at a time.

A threshold market quotes one point of a survival function. ``P(BTC > 111,000)``
at $0.42 says the market puts 42 % above that strike and nothing at all about
where inside. Quote a ladder of strikes and the points join up: the probability
mass between two adjacent strikes is the *difference* of their survival values,

    pmf(k_i, k_{i+1}] = S(k_i) - S(k_{i+1})

which is the whole of this module. Everything else here is bookkeeping around
that subtraction — where the axis is unbounded, which side of the book to read,
and what to do when the difference comes out negative.

That last case is the point. A negative bin is a survival function that rises
with the strike — the market calling an outcome above 112,000 likelier than one
above 111,000, when every outcome in the first set is in the second. That is a
Dutch book, priced by ``constraints.py`` as a monotone violation. This module
exists so the same fault can be *seen*, as a bar below the axis.

Two honesty rules carry over from the rest of the kernel:

**A bin is not a probability until the axis is closed.** The top bin of a BTC
ladder is "above the highest strike": mass, but no width and no midpoint. A
mean computed by pretending it sits at its floor is not the market's mean, it
is the mean of a distribution nobody quoted. So the moments are computed over
the bounded bins and renormalised onto them, making them exactly what they say
— mean and variance *conditional on landing inside the quoted range* — with the
wing mass reported beside them, since that is what the statement excludes.

**Named outcomes are not numbers.** A Fed-decision family has a perfectly good
pmf and no mean at all: "cut 25bp" sits nowhere on a line.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Final

from modules.coherence.kernel import moments
from modules.coherence.kernel.bins import (
    Basis,
    Bin,
    Engine,
    Probe,
    _choose_basis,
    _ladder_bins,
    _named_bins,
    _numeric_bins,
    _probes,
)
from modules.coherence.kernel.book import Book
from modules.coherence.kernel.lattice import Component, Node
from modules.coherence.kernel.money import DOLLAR

#: Above this much mass in the unbounded wings, the interior moments are
#: flagged as describing only part of the distribution. They are still reported:
#: a mean conditional on landing inside the quoted range is an exact statement,
#: where a mean that invents a width for the wings is a statement about the
#: convention. Half a cent of probability, the finest price the exchange quotes.
TAIL_TOLERANCE: Final = Decimal("0.005")

def _moments(bins: list[Bin]) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None, str]:
    """The first four central moments over the bins that sit on the axis.

    Only bounded bins have a representative point, so this is by construction a
    statement about the interior of the quoted range. The caller says so.
    """
    return moments.central(
        [(item.representative, item.mass) for item in bins if item.representative is not None]
    )


@dataclass(frozen=True, slots=True)
class Surface:
    """The implied distribution, or the reason there is not one."""

    engine: Engine
    basis: Basis | None
    probes: tuple[Probe, ...]
    bins: tuple[Bin, ...]
    #: Informative for a bucket or named family, where unquoted outcomes leave
    #: it short of a dollar. For a ladder it is one by construction — the
    #: differences telescope — so it confirms the arithmetic, never the prices.
    total_mass: Decimal | None
    tail_mass_low: Decimal | None
    tail_mass_high: Decimal | None
    mean: Decimal | None
    variance: Decimal | None
    skewness: Decimal | None
    excess_kurtosis: Decimal | None
    moments_note: str
    detail: str

    @property
    def negative_bins(self) -> tuple[str, ...]:
        return tuple(item.label for item in self.bins if item.is_negative)

    @property
    def is_empty(self) -> bool:
        return not self.bins


def _unavailable(detail: str) -> Surface:
    return Surface(
        engine="unavailable",
        basis=None,
        probes=(),
        bins=(),
        total_mass=None,
        tail_mass_low=None,
        tail_mass_high=None,
        mean=None,
        variance=None,
        skewness=None,
        excess_kurtosis=None,
        moments_note="",
        detail=detail,
    )


def _shape(
    component: Component,
    nodes: list[Node],
    books: dict[str, Book],
    basis: Basis,
    skipped: int,
) -> tuple[Engine, list[Probe], list[Bin], str] | None:
    """Which of the three readings this family supports, and its bins.

    **The exclusivity flag beats the strikes** — the same precedence
    ``states.py`` settled on, after the same bug. Reading the NYC daily-high
    event's thresholds first differenced two quoted strikes into three bins and
    threw its six exhaustive outcomes away. The flag is the venue's assertion
    about its own settlement; the strikes are our inference from two numbers.

    ``None`` when the family is none of the three, which the caller turns into
    an unavailable surface with a reason rather than an empty chart.
    """
    thresholds = [node for node in nodes if node.is_threshold or node.is_ceiling]
    buckets = [node for node in nodes if node.is_bucket]
    numeric = [node for node in nodes if node.is_bucket or node.is_threshold or node.is_ceiling]
    exclusive = component.mutually_exclusive and len(nodes) >= 2

    if exclusive and len(numeric) == len(nodes) and len(numeric) >= 2:
        # Exhaustive AND on a numeric axis: the best of both, since each market
        # is its own state and also has an interval to take moments about.
        probes = []
        engine: Engine = "bucket"
        bins = _numeric_bins(numeric, books, basis)
        detail = f"{len(bins)} exhaustive interval(s) quoted directly, no differencing needed"
    elif exclusive:
        probes = []
        engine = "named"
        bins = _named_bins(nodes, books, basis)
        detail = f"{len(bins)} outcome(s); the exchange marks this event mutually exclusive"
    elif len(thresholds) >= 2:
        probes = _probes(thresholds, books, basis)
        engine = "ladder"
        bins = _ladder_bins(probes)
        detail = f"{len(probes)} strike(s) differenced into {len(bins)} bin(s)"
    elif len(buckets) >= 2:
        probes = []
        engine = "bucket"
        bins = _numeric_bins(buckets, books, basis)
        detail = f"{len(bins)} bucket(s) quoted directly, no differencing needed"
    else:
        return None

    if skipped and engine == "ladder":
        detail += (
            f"; {skipped} listed market(s) are unquoted on every side and were not sampled — "
            "an unquoted strike is a gap in the curve, not a probability of zero"
        )
    elif skipped:
        detail += f"; {skipped} unquoted outcome(s) were skipped, so the mass below will not total a dollar"
    return engine, probes, bins, detail


def build_surface(component: Component, books: dict[str, Book]) -> Surface:
    """The distribution one event's prices imply, or the reason there is none."""
    nodes = list(component.nodes)
    if not nodes:
        return _unavailable("no active market in this event")

    basis, covered = _choose_basis(nodes, books)
    if basis is None:
        return _unavailable(
            f"only {covered} market(s) in this event carry a price on any side, and an unquoted "
            "market is not a probability of zero, so there are not two points to difference"
        )

    shaped = _shape(component, nodes, books, basis, len(nodes) - covered)
    if shaped is None:
        return _unavailable(
            "this event is neither a strike ladder, a bucket family, nor a mutually exclusive "
            "set, so its prices do not describe one distribution"
        )
    engine, probes, bins, detail = shaped
    if not bins:
        return _unavailable("no market in this event carries a strike this module can place on an axis")

    total = sum((item.mass for item in bins), Decimal(0))
    open_low = [item for item in bins if item.low is None and item.high is not None]
    open_high = [item for item in bins if item.high is None and item.low is not None]
    tail_low = sum((item.mass for item in open_low), Decimal(0)) if open_low else None
    tail_high = sum((item.mass for item in open_high), Decimal(0)) if open_high else None

    if engine == "named":
        mean = variance = skewness = excess = None
        moments_note = "these outcomes are names rather than numbers, so they have no mean"
    else:
        mean, variance, skewness, excess, moments_note = _moments(bins)
        outside = (tail_low or Decimal(0)) + (tail_high or Decimal(0))
        if mean is not None:
            moments_note = (
                "conditional on the outcome landing between the outermost quoted strikes, which "
                f"holds for {DOLLAR - outside} of the mass; " + moments_note
            )
            if outside > TAIL_TOLERANCE:
                moments_note += (
                    f" — {outside} sits in the unbounded wings, where the exchange quotes no width, "
                    "so it is left out rather than given an invented one"
                )

    return Surface(
        engine=engine,
        basis=basis,
        probes=tuple(probes),
        bins=tuple(bins),
        total_mass=total,
        tail_mass_low=tail_low,
        tail_mass_high=tail_high,
        mean=mean,
        variance=variance,
        skewness=skewness,
        excess_kurtosis=excess,
        moments_note=moments_note,
        detail=detail,
    )
