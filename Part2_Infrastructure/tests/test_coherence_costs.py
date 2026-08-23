"""Lesson 2: the fee has three components, and the second one is the story.

Every number here is checked against Kalshi's own fee-rounding documentation
rather than against our arithmetic. The worked example is theirs: 0.09 contracts
at $0.3301 bought in three lots by a non-direct member.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence.kernel.costs import (
    DEFAULT_TAKER_RATE,
    FeeSchedule,
    Fill,
    OrderFees,
    minimum_clip_hundredths,
    net_fee,
    no_arbitrage_bound,
    trade_fee,
)
from modules.coherence.kernel.money import CENT, CENTICENT

DIRECT = FeeSchedule(balance_precision=CENTICENT)
ORDINARY = FeeSchedule(balance_precision=CENT)


class TestKalshisOwnWorkedExample:
    """0.09 contracts at $0.3301, three lots, non-direct member."""

    @pytest.fixture
    def order(self) -> OrderFees:
        book = OrderFees(schedule=ORDINARY)
        for _ in range(3):
            book.add(Fill(price=Decimal("0.3301"), size_hundredths=3))
        return book

    def test_the_trade_fee_on_the_first_fill_is_the_documented_five_hundredths_of_a_cent(self, order):
        assert order.fills[0].trade_fee == Decimal("0.0005")

    def test_the_rounding_fee_is_nineteen_times_the_trade_fee(self, order):
        """The component nobody models, larger than the one everybody does."""
        first = order.fills[0]
        assert first.rounding_fee == Decimal("0.009597")
        assert first.rounding_fee > first.trade_fee * 19

    def test_the_first_fill_costs_more_in_fees_than_it_traded_in_notional(self, order):
        """$0.010097 of fees on $0.009903 of notional. Over 100%."""
        first = order.fills[0]
        assert first.net == Decimal("0.010097")
        assert first.net > first.notional

    def test_the_rebate_returns_a_whole_cent_once_the_accumulator_passes_one(self, order):
        assert order.fills[0].rebate == Decimal(0)
        assert order.fills[1].rebate == CENT
        assert order.fills[2].rebate == CENT

    def test_the_accumulator_makes_this_order_cost_the_same_however_it_filled(self, order):
        """The measured behaviour, against the folklore.

        The received wisdom is that fragmentation is a per-fill tax. It is not:
        the rounding component grows exactly as the rebate grows and they
        cancel, which is what a per-order accumulator is for. What survives is
        a residual bounded by one cent per order — see the sweep below.
        """
        fragmented = order.total.net
        whole = net_fee(Decimal("0.3301"), 9, ORDINARY, fills=1).net
        assert fragmented == whole == Decimal("0.010291")


class TestTheTradeFeeItself:
    def test_is_the_published_quadratic(self):
        fill = Fill(price=Decimal("0.5000"), size_hundredths=10_000)
        expected = DEFAULT_TAKER_RATE * Decimal(100) * Decimal("0.5") * Decimal("0.5")
        assert trade_fee(fill, ORDINARY) == expected

    def test_peaks_at_fifty_cents_and_collapses_toward_the_tails(self):
        """Bernoulli variance. This is why `sum(ask) < 1` is the wrong test."""
        middle = trade_fee(Fill(price=Decimal("0.50"), size_hundredths=10_000), ORDINARY)
        edge = trade_fee(Fill(price=Decimal("0.02"), size_hundredths=10_000), ORDINARY)
        assert middle > edge * 10

    def test_rounds_up_to_the_centicent_never_down(self):
        fee = trade_fee(Fill(price=Decimal("0.3301"), size_hundredths=3), ORDINARY)
        assert fee == Decimal("0.0005")
        assert fee % CENTICENT == 0

    def test_the_multiplier_multiplies_the_rate_rather_than_replacing_it(self):
        """Live it is 1 on almost every series; read as a rate it is 7c/$ wrong."""
        half = FeeSchedule(multiplier=Decimal("0.5"))
        full = FeeSchedule(multiplier=Decimal(1))
        fill = Fill(price=Decimal("0.4"), size_hundredths=10_000)
        assert trade_fee(fill, half) == trade_fee(fill, full) / 2

    def test_a_maker_pays_a_quarter(self):
        maker = Fill(price=Decimal("0.4"), size_hundredths=10_000, maker=True)
        taker = Fill(price=Decimal("0.4"), size_hundredths=10_000, maker=False)
        assert trade_fee(maker, ORDINARY) == trade_fee(taker, ORDINARY) / 4


class TestWhoYouAreChangesWhatYouPay:
    def test_a_direct_member_pays_a_hundredth_of_the_rounding(self):
        """$0.01 precision against $0.0001: the single largest fee lever there is."""
        ordinary = net_fee(Decimal("0.3301"), 9, ORDINARY, fills=3)
        direct = net_fee(Decimal("0.3301"), 9, DIRECT, fills=3)
        assert direct.rounding_fee < ordinary.rounding_fee / 50
        assert direct.net < ordinary.net


class TestWhatFragmentationActuallyCosts:
    """Measured, because the folklore here is wrong in a checkable way."""

    def test_both_components_grow_with_fill_count(self):
        """The trade fee too: it is ceiled per FILL, not per order."""
        whole = net_fee(Decimal("0.45"), 2_000, ORDINARY, fills=1)
        split = net_fee(Decimal("0.45"), 2_000, ORDINARY, fills=100)
        assert split.trade_fee > whole.trade_fee
        assert split.rounding_fee > whole.rounding_fee

    def test_and_the_rebate_gives_all_of_it_back(self):
        """Which is the whole purpose of a per-order accumulator."""
        whole = net_fee(Decimal("0.45"), 2_000, ORDINARY, fills=1)
        split = net_fee(Decimal("0.45"), 2_000, ORDINARY, fills=100)
        assert split.net == whole.net == Decimal("0.3500")

    def test_the_residual_is_bounded_by_one_cent_per_order(self):
        """The accumulator refunds whole cents, so sub-cent remainders stay paid.

        Swept rather than argued: across seven prices and eight sizes, the net
        fee is invariant to fill count almost everywhere and never more than a
        cent worse. That bound is what the minimum clip size rests on.
        """
        worst = Decimal(0)
        for price in ("0.07", "0.1234", "0.3301", "0.45", "0.5", "0.9", "0.03"):
            for size in (2, 3, 5, 7, 11, 50, 101, 997):
                base = net_fee(Decimal(price), size, ORDINARY, fills=1).net
                for fills in (2, 3, 4, 7):
                    worst = max(worst, net_fee(Decimal(price), size, ORDINARY, fills=fills).net - base)
        assert worst <= CENT, f"fragmentation cost {worst}, more than the accumulator's one-cent residual"
        assert worst > 0, "the residual vanished entirely; the accumulator is refunding more than it should"


class TestTheThresholdThatMatters:
    def test_the_fee_aware_bound_is_below_a_dollar_and_not_by_a_little(self):
        """`sum(ask) < 1` is not a conservative approximation of this."""
        bound = no_arbitrage_bound([Decimal("0.5"), Decimal("0.5")], ORDINARY, 10_000)
        assert bound < Decimal(1)
        assert Decimal(1) - bound > Decimal("0.03")

    def test_the_bound_depends_on_where_the_legs_sit(self):
        """The fee is a parabola, so a basket in the tails is cheaper to hold."""
        middle = no_arbitrage_bound([Decimal("0.5"), Decimal("0.5")], ORDINARY, 10_000)
        tails = no_arbitrage_bound([Decimal("0.02"), Decimal("0.98")], ORDINARY, 10_000)
        assert tails > middle

    def test_a_minimum_clip_exists_and_is_found(self):
        clip = minimum_clip_hundredths(Decimal("0.5"), Decimal("0.02"), ORDINARY, expected_fills=1)
        assert clip is not None and clip > 0

    def test_no_clip_survives_an_edge_smaller_than_the_fee_at_that_price(self):
        """Reported as None, never as a very large number that would 'work'."""
        assert minimum_clip_hundredths(Decimal("0.5"), Decimal("0.001"), ORDINARY, expected_fills=10) is None

    def test_a_negative_edge_has_no_clip_at_all(self):
        assert minimum_clip_hundredths(Decimal("0.5"), Decimal("-0.01"), ORDINARY) is None
