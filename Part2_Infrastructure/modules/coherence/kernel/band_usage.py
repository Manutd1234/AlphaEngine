"""How much of the room the legs leave do the makers actually use?

The §8.4 measurement, and the reason the RFQ channel is worth reading at all.
It sits apart from ``frechet.py`` because it is a different question about the
same object: that module derives the band a parlay's legs impose, and this one
sets an observed disagreement against it.

The Frechet band says how far a parlay's price could move with NO leg price
moving — the room the legs leave for dependence, which is often half a dollar
wide. The dispersion between makers' private quotes says how much of that room
the people who price it for a living actually disagree over. The public book
says nothing at all: no parlay on this exchange carries a bid.

Neither a small fraction nor a large one is a mispricing. They locate where the
information is — whether the dependence is something professionals agree on
despite the legs not pinning it down, or something nobody has a view on beyond
what the legs force.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from modules.coherence.kernel.frechet import FrechetReading


@dataclass(frozen=True, slots=True)
class BandUsage:
    """How much of the room the legs leave is actually used by the makers.

    This is the §8.4 measurement and the reason the RFQ channel is worth
    reading at all. The Fréchet band says how far a parlay's price could move
    with no leg price moving — the room the legs leave for dependence. The
    dispersion between makers' private quotes says how much of that room the
    people who price it for a living actually disagree over.

    A small fraction means the professionals agree about the dependence even
    where the legs do not pin it down. A fraction near one means the legs are
    the only constraint anyone has. Neither is a mispricing; both say where the
    information is.
    """

    market_ticker: str
    band_width: Decimal
    spread: Decimal
    fraction: Decimal
    makers: int

    @property
    def detail(self) -> str:
        return (
            f"{self.makers} maker(s) disagree by {self.spread} across a band {self.band_width} wide, "
            f"so they use {self.fraction} of the room the legs leave"
        )


def band_usage(reading: FrechetReading, spread: Decimal | None, makers: int) -> BandUsage | None:
    """The dispersion against the band, or None when either side is missing.

    Refuses rather than reporting zero: a band of no width and a panel of no
    disagreement are different findings, and a ratio would flatten both into
    the same number.
    """
    width = reading.band_width
    if width is None or width <= 0 or spread is None or makers < 2:
        return None
    return BandUsage(
        market_ticker=reading.combo_ticker,
        band_width=width,
        spread=spread,
        fraction=spread / width,
        makers=makers,
    )
