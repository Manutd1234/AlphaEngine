"""Valid prices: the ``price_ranges`` lattice, and snapping onto it.

Kalshi removed the scalar ``tick_size`` in May 2026. A market now carries
``price_ranges`` — a list of ``{start, end, step}`` bands — and a
``price_level_structure`` naming the shape. **Read the bands; never key off the
name.** There are a dozen structure names, new ones arrive by changelog, and
the name is a label for the bands rather than a definition of them: a client
that switches on ``"linear_cent"`` silently prices the next structure wrong,
while a client that reads the bands is correct for structures that do not exist
yet.

The bands are not uniform, and that is the point. Edge bands (below ~$0.10 and
above ~$0.90) carry finer steps than the centre, because a cent is a large
fraction of a four-cent contract. So the step depends on *where* the price is,
which means snapping is a lookup and not a division.

An off-grid price is rejected by the exchange. For this engine that matters
twice: an arbitrage portfolio priced off-grid is not executable, and a leg
snapped the wrong way turns a positive edge negative. Snapping is therefore
directional — a buy rounds toward the price you are willing to pay, a sell
rounds toward the price you are willing to accept — and always away from
optimism.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from typing import Literal, Sequence

from modules.coherence.kernel.money import MoneyError, parse_dollars

Direction = Literal["buy", "sell"]


class GridError(ValueError):
    """A price grid was missing, malformed, or does not contain a price."""


@dataclass(frozen=True, slots=True)
class Band:
    """One ``{start, end, step}`` row of ``price_ranges``, half-open [start, end)."""

    start: Decimal
    end: Decimal
    step: Decimal

    def contains(self, price: Decimal) -> bool:
        return self.start <= price <= self.end


@dataclass(frozen=True, slots=True)
class PriceGrid:
    """Every price a market will accept, as the bands the venue published.

    ``structure`` is carried for the certificate to print — a reader deserves
    to know which grid a quote sat on — and is never branched on.
    """

    structure: str
    bands: tuple[Band, ...]

    @property
    def finest_step(self) -> Decimal:
        return min(band.step for band in self.bands)

    def band_for(self, price: Decimal) -> Band:
        for band in self.bands:
            if band.contains(price):
                return band
        raise GridError(f"price {price} falls outside every published band of {self.structure!r}")

    def is_valid(self, price: Decimal) -> bool:
        """True when the exchange would accept this price as written."""
        try:
            band = self.band_for(price)
        except GridError:
            return False
        offset = price - band.start
        return offset == (offset / band.step).to_integral_value() * band.step

    def snap(self, price: Decimal, direction: Direction) -> Decimal:
        """Move a price onto the grid, never in the direction that flatters us.

        A ``buy`` snaps UP: to cross a resting offer you must be willing to pay
        the next valid price, and assuming the cheaper one manufactures edge
        that will not fill. A ``sell`` snaps DOWN, for the mirror reason. The
        result is always executable and never better than the truth.
        """
        band = self.band_for(price)
        offset = price - band.start
        rounding = ROUND_CEILING if direction == "buy" else ROUND_FLOOR
        steps = (offset / band.step).quantize(Decimal(1), rounding=rounding)
        snapped = band.start + steps * band.step
        if snapped < band.start:
            return band.start
        if snapped > band.end:
            return band.end
        return snapped


def parse_price_ranges(raw: Sequence[dict] | None, structure: str | None) -> PriceGrid:
    """Build a grid from a Market object's ``price_ranges``.

    Raises rather than defaulting to a penny grid. A penny default would be
    right for most markets today and wrong for exactly the sub-penny ones where
    the engine's decisions are tightest — a fallback that produces a confident
    answer is worse than an error.
    """
    if not raw:
        raise GridError("market published no price_ranges; its valid prices are unknown")
    bands: list[Band] = []
    for row in raw:
        try:
            start = parse_dollars(row["start"])
            end = parse_dollars(row["end"])
            step = parse_dollars(row["step"])
        except (KeyError, TypeError, MoneyError) as exc:
            raise GridError(f"price_ranges row {row!r} is not {{start, end, step}}: {exc}") from exc
        if step <= 0:
            raise GridError(f"price_ranges row {row!r} has a non-positive step")
        if end < start:
            raise GridError(f"price_ranges row {row!r} ends before it starts")
        bands.append(Band(start=start, end=end, step=step))
    bands.sort(key=lambda band: band.start)
    return PriceGrid(structure=structure or "unnamed", bands=tuple(bands))
