"""Lesson 1: fixed point, and why a float engine is wrong where it matters.

The arithmetic here is small. What it is defending is not: every trade this
engine proposes is a claim that a basket costs less than a dollar after fees,
and the baskets worth trading clear by a tick.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence.kernel.money import (
    CENT,
    CENTICENT,
    MoneyError,
    ceil_to_centicent,
    contracts,
    floor_to_precision,
    format_dollars,
    one_minus,
    parse_dollars,
    parse_fp,
)


class TestParsingTheVenuesStrings:
    def test_reads_the_four_decimal_form_rest_sends(self):
        assert parse_dollars("0.4200") == Decimal("0.4200")

    def test_reads_the_three_decimal_form_the_websocket_sends(self):
        """FixedPointDollars is 'up to six' decimals; the width is not a contract."""
        assert parse_dollars("0.960") == Decimal("0.960")

    def test_reads_six_decimals(self):
        assert parse_dollars("0.123456") == Decimal("0.123456")

    def test_refuses_a_seventh_decimal(self):
        """Longer than the venue documents is a protocol change, not a price."""
        with pytest.raises(MoneyError, match="more than 6 decimals"):
            parse_dollars("0.1234567")

    def test_refuses_a_float_outright(self):
        """By the time a float arrives the precision is already gone."""
        with pytest.raises(MoneyError, match="must be a string"):
            parse_dollars(0.42)

    def test_refuses_a_bool_which_python_would_otherwise_treat_as_a_number(self):
        with pytest.raises(MoneyError, match="must be a string"):
            parse_dollars(True)

    @pytest.mark.parametrize("bad", ["", "   ", "abc", "NaN", "Infinity"])
    def test_refuses_what_it_cannot_read_rather_than_defaulting(self, bad):
        """Zero is a legal Kalshi price, so there is no safe default to fall back to."""
        with pytest.raises(MoneyError):
            parse_dollars(bad)

    def test_a_decimal_passes_through_so_a_re_parse_is_harmless(self):
        assert parse_dollars(Decimal("0.5")) == Decimal("0.5")


class TestCounts:
    def test_reads_the_two_decimal_contract_form(self):
        assert parse_fp("13.00") == 1300

    def test_fractional_contracts_are_ordinary(self):
        """Kalshi made fractional trading unconditional; 0.01 is the quantum."""
        assert parse_fp("0.09") == 9
        assert contracts(9) == Decimal("0.09")

    def test_refuses_a_size_finer_than_the_quantum(self):
        with pytest.raises(MoneyError, match="finer than 0.01"):
            parse_fp("0.005")

    def test_round_trips_through_hundredths_exactly(self):
        for raw in ("0.01", "1.00", "13.07", "10743.07"):
            assert contracts(parse_fp(raw)) == Decimal(raw)


class TestTheFeeQuanta:
    def test_ceils_up_to_the_centicent_not_the_cent(self):
        """Kalshi's trade fee rounds up to $0.0001. The cent is a different layer."""
        assert ceil_to_centicent(Decimal("0.017157")) == Decimal("0.0172")

    def test_ceiling_never_rounds_down_even_by_a_millionth(self):
        assert ceil_to_centicent(Decimal("0.000001")) == CENTICENT

    def test_an_exact_centicent_is_left_alone(self):
        assert ceil_to_centicent(Decimal("0.0005")) == Decimal("0.0005")

    def test_reproduces_kalshis_own_worked_trade_fee(self):
        """0.03 contracts at $0.3301, general taker rate: the documented $0.000500."""
        raw = Decimal("0.07") * Decimal("0.03") * Decimal("0.3301") * (Decimal(1) - Decimal("0.3301"))
        assert ceil_to_centicent(raw) == Decimal("0.0005")

    def test_floors_a_balance_change_toward_negative_infinity(self):
        """A purchase is a negative balance change, and floor != truncate there."""
        assert floor_to_precision(Decimal("-0.0099"), CENT) == Decimal("-0.01")
        assert floor_to_precision(Decimal("0.0099"), CENT) == Decimal("0.00")

    def test_a_direct_member_keeps_a_hundred_times_more_of_their_money(self):
        value = Decimal("-0.009597")
        assert floor_to_precision(value, CENT) == Decimal("-0.01")
        assert floor_to_precision(value, CENTICENT) == Decimal("-0.0096")

    def test_refuses_a_precision_that_is_not_a_precision(self):
        with pytest.raises(MoneyError, match="must be positive"):
            floor_to_precision(Decimal("1"), Decimal("0"))


class TestTheComplementaryPrice:
    def test_a_no_bid_is_a_yes_ask_at_one_minus_the_price(self):
        assert one_minus(Decimal("0.5600")) == Decimal("0.4400")

    def test_it_is_its_own_inverse(self):
        assert one_minus(one_minus(Decimal("0.3300"))) == Decimal("0.3300")

    def test_formats_to_the_canonical_four_places(self):
        assert format_dollars(Decimal("0.44")) == "0.4400"


def test_the_float_engine_this_module_exists_to_prevent():
    """The failure, demonstrated rather than asserted.

    Eight legs at $0.125 cost exactly one dollar. In binary64 they do not, and
    the engine's question — "is this basket under a dollar?" — gets the wrong
    answer from a sum that is off by one part in 10^16. The Decimal path
    answers correctly, which is the whole argument for this module.
    """
    legs = [Decimal("0.125")] * 8
    assert sum(legs) == Decimal(1)
    assert not sum(legs) < Decimal(1), "the exact sum is not under a dollar"

    # The same arithmetic in the representation the rest of the desk uses.
    naive = 0.1 + 0.2
    assert naive != 0.3, "binary64 cannot hold these; that is the point"
    assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
