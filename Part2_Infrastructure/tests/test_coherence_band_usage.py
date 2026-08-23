"""The §8.4 measurement: maker disagreement set against the band the legs leave.

The band and the dispersion are both in dollars of probability, which is what
makes the ratio meaningful — and what makes it easy to report a ratio where one
of the two was never measured. Every refusal below is a case where returning
zero would have read as a finding.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.kernel.band_usage import band_usage
from modules.coherence.kernel.frechet import FrechetReading


def reading(width: Decimal | None, lower: Decimal | None = None, upper: Decimal | None = None) -> FrechetReading:
    return FrechetReading(
        combo_ticker="KXCOMBO",
        legs=(),
        combo_bid=None,
        combo_ask=Decimal("0.14"),
        combo_mid=None,
        price=Decimal("0.14"),
        price_basis="ask",
        lower_bound=lower,
        upper_bound=upper,
        independence=Decimal("0.12"),
        band_width=width,
        band_position=None,
        dependence="positive",
        detail="",
    )


class TestTheRatioIsOnlyReportedWhenBothSidesWereMeasured:
    def test_a_panel_and_a_band_give_the_share_of_the_room_that_is_used(self):
        used = band_usage(reading(Decimal("0.50")), Decimal("0.06"), makers=4)
        assert used is not None
        assert used.fraction == Decimal("0.12")
        assert used.band_width == Decimal("0.50")
        assert used.spread == Decimal("0.06")
        assert "use 0.12 of the room the legs leave" in used.detail

    def test_one_maker_is_not_a_disagreement(self):
        """A spread needs two independent views. One is an anecdote with a price."""
        assert band_usage(reading(Decimal("0.50")), Decimal("0.06"), makers=1) is None

    def test_a_family_with_no_band_cannot_be_a_denominator(self):
        assert band_usage(reading(None), Decimal("0.06"), makers=4) is None

    def test_a_band_of_no_width_is_refused_rather_than_divided_by(self):
        """Legs that pin the parlay exactly leave no room, and no ratio."""
        assert band_usage(reading(Decimal(0)), Decimal("0.06"), makers=4) is None

    def test_an_unmeasured_spread_is_not_a_spread_of_zero(self):
        """Zero would say the makers agree exactly. None says nobody asked."""
        assert band_usage(reading(Decimal("0.50")), None, makers=4) is None

    def test_makers_who_agree_exactly_use_none_of_the_room(self):
        """A real zero IS a finding, and is reported as one."""
        used = band_usage(reading(Decimal("0.50")), Decimal(0), makers=5)
        assert used is not None
        assert used.fraction == Decimal(0)

    def test_a_disagreement_wider_than_the_band_is_reported_as_it_is(self):
        """Over one is not clipped: it means the makers disagree about more
        than the legs allow, which is a fault worth seeing rather than hiding
        behind a cap."""
        used = band_usage(reading(Decimal("0.10")), Decimal("0.25"), makers=3)
        assert used is not None
        assert used.fraction > Decimal(1)
