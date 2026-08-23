"""Moments of a binned distribution, over pairs of (point, weight).

Split out of ``distribution.py`` when that module reached its length ceiling.
The seam is a real one rather than a convenience: this file knows nothing about
strikes, books or Kalshi. It takes points on a line with weights on them and
returns the first four central moments, which makes it testable with numbers a
reader can check by hand.

Every bin is collapsed onto a single representative point. That is the standard
reading of a binned distribution and it is worth stating rather than assuming:
it is exact only where the mass inside a bin is symmetric about its centre. On a
hundred-strike ladder the error is far below the tick; on a three-bucket family
it is not, so the count of contributing bins is returned with the moments and
the caller reports it.

The weights are renormalised onto the points supplied. Anything the caller left
out — an unbounded tail with no midpoint — is therefore excluded rather than
guessed at, and the moments describe the distribution *conditional* on landing
among the points given. Saying that plainly is the whole reason this is not one
line of arithmetic inline.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Sequence

Point = tuple[Decimal, Decimal]


def central(points: Sequence[Point]) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None, str]:
    """Mean, variance, skewness, excess kurtosis, and a sentence about them.

    ``points`` is ``(representative, mass)``. Masses at or below zero are
    dropped: a negative bin is a coherence violation certified elsewhere, and a
    log-shaped statistic computed over one would be arithmetic on a fault.
    """
    usable = [(value, mass) for value, mass in points if mass > 0]
    if len(usable) < 2:
        return None, None, None, None, "fewer than two priced bins sit on a numeric axis"

    weight = sum((mass for _, mass in usable), Decimal(0))
    if weight <= 0:
        return None, None, None, None, "the priced bins carry no mass"

    mean = sum((value * mass for value, mass in usable), Decimal(0)) / weight
    variance = sum(((value - mean) ** 2 * mass for value, mass in usable), Decimal(0)) / weight
    if variance <= 0:
        return mean, variance, None, None, "the mass sits in a single bin, so there is no shape to describe"

    sigma = variance.sqrt()
    third = sum(((value - mean) ** 3 * mass for value, mass in usable), Decimal(0)) / weight
    fourth = sum(((value - mean) ** 4 * mass for value, mass in usable), Decimal(0)) / weight
    note = f"bins collapsed onto their midpoints across {len(usable)} priced bin(s)"
    return mean, variance, third / (sigma**3), fourth / (variance**2) - 3, note
