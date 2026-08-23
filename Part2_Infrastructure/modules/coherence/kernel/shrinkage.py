"""Shrinking an estimated measure toward the market that produced it.

A probability read off a mid price is an estimate with the spread's width on it.
Kelly's derivation assumes that width is zero, so a plan sized on raw mids treats
quoting noise as edge — and the thinner the market, the more edge it appears to
find, which is exactly backwards.

The correction is a shrinkage toward the market's own measure:

    q' = (1 - λ)·q + λ·π,    π = prices normalised to one
    λ = Σ uncertainty / Σ |q - π|,   capped at one

λ reads as *the share of the apparent edge that the spreads alone could account
for*. Where the quotes are as wide as the divergence, λ = 1, q' = π, and a Kelly
plan over q' stakes nothing — the honest reading of an edge that is visible only
because nobody is quoting tightly.

**The obvious construction is wrong and it is worth saying why.** Taking each
leg's width off its own probability and renormalising looks like the same idea
and is not: subtracting a constant from every term and dividing by the smaller
total redistributes mass toward whichever leg already had most. On a two-outcome
family at 0.60/0.40 with equal spreads it moves the measure to 0.611/0.389 and
RAISES the favourite's stake — a haircut that increases the bet. That version was
written first, read plausibly, and was caught by a test that measured it rather
than a comment that described it. Shrinking toward a fixed point cannot do that:
every q moves toward π and no q moves away.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Sequence

from modules.coherence.kernel.money import DOLLAR


def toward_market(
    probabilities: Sequence[Decimal],
    prices: Sequence[Decimal],
    uncertainties: Sequence[Decimal],
) -> tuple[list[Decimal], Decimal]:
    """The shrunk measure and the λ used, or the input unchanged and zero.

    Returns the input untouched when there is nothing to shrink toward (no
    priced legs), nothing to shrink by (no stated uncertainty), or nothing to
    shrink (the measure already agrees with the market).
    """
    values = list(probabilities)
    total_price = sum(prices, Decimal(0))
    width = sum(uncertainties, Decimal(0))
    if total_price <= 0 or width <= 0 or not values:
        return values, Decimal(0)

    implied = [price / total_price for price in prices]
    divergence = sum(
        (abs(value - pi) for value, pi in zip(values, implied, strict=False)), Decimal(0)
    )
    if divergence <= 0:
        return values, Decimal(0)

    lam = width / divergence
    if lam > DOLLAR:
        lam = DOLLAR
    shrunk = [
        (DOLLAR - lam) * value + lam * pi for value, pi in zip(values, implied, strict=False)
    ]
    return shrunk, lam
