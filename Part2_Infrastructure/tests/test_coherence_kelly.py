"""Growth-optimal is not riskless, and this file exists to keep the two apart.

Sizing a family of mutually exclusive contracts is not the scalar Kelly formula
repeated. Exactly one outcome resolves YES, so a dollar on one is partly a hedge
for the dollar on another, and the joint problem has an exact solution with a
cash rate in it.

The assertion that matters is the one about the arbitrage. A basket costing
under a dollar is a certain profit, and Kelly does NOT take it: it stakes the
measure instead, which grows faster in log terms and can lose a third of the
bankroll on a single settlement. Both numbers are pinned below, because a plan
that reported only its growth rate would read as free money.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence.kernel.kelly import DEFAULT_SHRINKAGE, Candidate, solve, unsizeable
from modules.coherence.kernel.money import DOLLAR

FULL = Decimal(1)


def candidate(ticker: str, probability: str, price: str) -> Candidate:
    return Candidate(ticker=ticker, label=f"outcome {ticker}", probability=Decimal(probability), price=Decimal(price))


def family(pairs: list[tuple[str, str]]) -> list[Candidate]:
    return [candidate(chr(65 + index), q, a) for index, (q, a) in enumerate(pairs)]


def staked(plan, ticker: str) -> Decimal:
    return next(stake.full_fraction for stake in plan.stakes if stake.ticker == ticker)


class TestTheTextbookCase:
    """Two outcomes at even money. ``f = (bp − q)/b`` with net odds of one."""

    @pytest.fixture
    def plan(self):
        return solve(family([("0.6", "0.50"), ("0.4", "0.50")]), FULL)

    def test_the_favourite_takes_a_fifth_of_the_bankroll_exactly(self, plan):
        """0.6 − 0.4 = 0.2. Decimal-exact, not near enough."""
        assert staked(plan, "A") == Decimal("0.20")

    def test_and_the_other_side_takes_nothing(self, plan):
        """Backing both sides of a two-outcome family at even money buys a
        dollar for a dollar, whichever way it settles."""
        assert staked(plan, "B") == 0
        assert not next(stake for stake in plan.stakes if stake.ticker == "B").admitted

    def test_the_cash_rate_is_the_probability_left_over_the_money_left(self, plan):
        assert plan.reserve_rate == Decimal("0.8")
        assert plan.cash_fraction == Decimal("0.80")

    def test_the_plan_cannot_lose_more_than_it_staked(self, plan):
        assert plan.worst_case_wealth == Decimal("0.80")
        assert plan.growth_rate is not None and plan.growth_rate > 0


class TestNoEdgeStakesNothing:
    @pytest.fixture
    def plan(self):
        """The measure handed back the prices. This is what feeding Kelly the
        market's own mids does, and it is the correct answer, not a fault."""
        return solve(family([("0.5", "0.50"), ("0.5", "0.50")]), FULL)

    def test_every_fraction_is_zero(self, plan):
        assert all(stake.full_fraction == 0 for stake in plan.stakes)
        assert plan.cash_fraction == FULL

    def test_the_growth_rate_is_nothing_rather_than_missing(self, plan):
        """Holding cash grows the bankroll by exactly nothing, which is a
        measurement. None would say the plan could not be scored."""
        assert plan.growth_rate == 0
        assert plan.worst_case_wealth == FULL

    def test_the_engine_says_why_rather_than_returning_an_empty_plan(self, plan):
        assert plan.engine == "exclusive"
        assert "no outcome in this family is priced below what the measure says it is worth" in plan.detail

    def test_the_stake_follows_the_edge_rather_than_the_order_supplied(self):
        """The outcomes are admitted best-first by payoff per dollar, so the
        answer cannot depend on which one the caller listed first."""
        plan = solve(family([("0.4", "0.50"), ("0.6", "0.50")]), FULL)
        assert staked(plan, "B") == Decimal("0.20")
        assert staked(plan, "A") == 0


class TestAnArbitrageIsNotThePlan:
    """Σa = 0.94 against q = (0.50, 0.30, 0.20). Both numbers, side by side."""

    @pytest.fixture
    def plan(self):
        return solve(family([("0.5", "0.30"), ("0.3", "0.32"), ("0.2", "0.32")]), FULL)

    def test_the_basket_costs_under_a_dollar_so_an_arbitrage_exists(self, plan):
        assert plan.basket_cost == Decimal("0.94")
        assert plan.arbitrage_available is True

    def test_the_riskless_alternative_is_priced_beside_it(self, plan):
        """ln(1/0.94): what equal numbers of every contract return with certainty."""
        assert plan.riskless_growth is not None
        assert plan.riskless_growth.quantize(Decimal("0.0001")) == Decimal("0.0619")

    def test_the_kelly_plan_grows_more_than_twice_as_fast(self, plan):
        assert plan.growth_rate is not None
        assert plan.growth_rate.quantize(Decimal("0.0001")) == Decimal("0.1421")
        assert plan.growth_rate > plan.riskless_growth * 2

    def test_and_can_lose_more_than_a_third_of_the_bankroll(self, plan):
        """0.20 staked on an outcome costing 0.32 returns 0.625 when it lands
        and the cash was spent. The arbitrage basket cannot do that, which is
        the entire distinction this class exists to hold."""
        assert plan.worst_case_wealth == Decimal("0.625")
        assert plan.worst_case_wealth < FULL

    def test_the_measure_is_staked_whole_with_no_cash_held(self, plan):
        """The cash rate collapses to zero, so Kelly holds nothing back."""
        assert plan.reserve_rate == 0
        assert [staked(plan, key) for key in ("A", "B", "C")] == [Decimal("0.50"), Decimal("0.30"), Decimal("0.20")]
        assert plan.cash_fraction == 0

    def test_the_detail_names_both_and_says_which_one_can_lose(self, plan):
        assert "riskless" in plan.detail
        assert "grows faster and can lose" in plan.detail


class TestFairOddsAreNotAnArbitrage:
    """Σa = 1 exactly. Buying every outcome buys a dollar for a dollar."""

    @pytest.mark.parametrize(
        "prices",
        [
            ["0.50", "0.50"],
            ["0.30", "0.32", "0.38"],
            ["0.25", "0.25", "0.25", "0.25"],
        ],
    )
    def test_a_basket_costing_exactly_a_dollar_is_never_called_one(self, prices):
        share = Decimal(1) / Decimal(len(prices))
        plan = solve([candidate(chr(65 + index), str(share), price) for index, price in enumerate(prices)], FULL)
        assert plan.basket_cost == Decimal(1)
        assert plan.arbitrage_available is False
        assert plan.riskless_growth is None

    def test_an_edge_at_fair_odds_is_still_sized_without_the_arbitrage_claim(self):
        plan = solve(family([("0.6", "0.50"), ("0.4", "0.50")]), FULL)
        assert plan.basket_cost == Decimal(1)
        assert plan.arbitrage_available is False
        assert staked(plan, "A") == Decimal("0.20")

    def test_a_basket_over_a_dollar_is_not_one_either(self):
        plan = solve(family([("0.5", "0.55"), ("0.5", "0.55")]), FULL)
        assert plan.basket_cost == Decimal("1.10")
        assert plan.arbitrage_available is False


class TestShrinkage:
    """Half Kelly gives up a quarter of the growth for half the variance."""

    @pytest.mark.parametrize("shrinkage", ["1", "0.5", "0.25", "0.1"])
    def test_every_fraction_is_the_full_one_scaled(self, shrinkage):
        fraction = Decimal(shrinkage)
        plan = solve(family([("0.5", "0.30"), ("0.3", "0.32"), ("0.2", "0.32")]), fraction)
        assert all(stake.fraction == stake.full_fraction * fraction for stake in plan.stakes)
        assert plan.shrinkage == fraction

    def test_a_shrunk_plan_grows_more_slowly_than_the_full_one(self):
        plan = solve(family([("0.6", "0.50"), ("0.4", "0.50")]), Decimal("0.25"))
        assert plan.growth_rate is not None and plan.full_growth_rate is not None
        assert plan.growth_rate < plan.full_growth_rate

    def test_and_holds_more_cash_for_it(self):
        plan = solve(family([("0.6", "0.50"), ("0.4", "0.50")]), Decimal("0.25"))
        assert plan.cash_fraction == Decimal("0.95")
        assert plan.staked_fraction == Decimal("0.05")

    def test_the_default_is_a_quarter_rather_than_a_half(self):
        """``q`` here is read off a moving book, and the estimation error is not
        in the model."""
        assert DEFAULT_SHRINKAGE == Decimal("0.25")
        assert solve(family([("0.6", "0.50"), ("0.4", "0.50")])).shrinkage == DEFAULT_SHRINKAGE

    def test_a_shrinkage_outside_the_interval_is_refused_rather_than_clamped(self):
        for value in ("0", "-0.5", "1.5"):
            plan = solve(family([("0.6", "0.50"), ("0.4", "0.50")]), Decimal(value))
            assert plan.engine == "unavailable"
            assert "must sit in (0, 1]" in plan.detail


class TestWhatItRefusesToSize:
    def test_a_family_of_one_offered_outcome_has_no_joint_distribution(self):
        plan = solve([candidate("A", "0.6", "0.50"), candidate("B", "0.4", "0")], FULL)
        assert plan.engine == "unavailable"
        assert "fewer than two outcomes" in plan.detail
        assert plan.growth_rate is None and plan.cash_fraction is None

    def test_a_negative_probability_is_named_rather_than_clipped(self):
        plan = solve(family([("0.6", "0.50"), ("-0.1", "0.50")]), FULL)
        assert plan.engine == "unavailable"
        assert "negative probability" in plan.detail

    def test_a_measure_with_no_mass_on_the_family_cannot_size_it(self):
        plan = solve(family([("0", "0.50"), ("0", "0.50")]), FULL)
        assert plan.engine == "unavailable"
        assert "no mass" in plan.detail

    def test_a_measure_that_does_not_sum_to_one_is_normalised_and_says_so(self):
        """A partial family is a different problem, and silently sizing against
        an unnormalised measure would inflate every stake."""
        plan = solve(family([("0.3", "0.50"), ("0.2", "0.50")]), FULL)
        assert plan.engine == "exclusive"
        assert staked(plan, "A") == Decimal("0.20"), "the same plan as q = (0.6, 0.4)"
        assert "was normalised to one" in plan.detail


class TestThePlanInMoney:
    def test_only_admitted_outcomes_are_handed_a_ticket(self):
        plan = solve(family([("0.6", "0.50"), ("0.4", "0.50")]), FULL)
        assert plan.dollars(Decimal(10_000)) == (("A", Decimal("2000.0")),)

    def test_the_edge_is_the_measure_minus_the_price(self):
        plan = solve(family([("0.6", "0.50"), ("0.4", "0.50")]), FULL)
        assert [stake.edge for stake in plan.stakes] == [Decimal("0.1"), Decimal("-0.1")]


class TestTheThingsThatMakeAPlanSafeToRead:
    """Two refusals and a haircut, each of which was a real defect first."""

    def test_a_family_with_an_unbuyable_outcome_is_refused_rather_than_sized(self):
        """An exhaustive family missing a leg is UNSIZEABLE, not smaller.

        Dropping the unquoted outcome and sizing the rest let a partial basket
        cost under a dollar, which set ``arbitrage_available`` and reported a
        worst case above one — "cannot lose" — while the outcome that was
        dropped still carried a quarter of the mass and would take the lot.
        """
        plan = unsizeable("one outcome of this family is not offered at any price")
        assert plan.engine == "unavailable"
        assert plan.arbitrage_available is False
        assert plan.basket_cost is None
        assert plan.worst_case_wealth is None
        assert "not offered" in plan.detail

    def test_the_arbitrage_threshold_is_the_callers_not_a_hardcoded_dollar(self):
        """A basket under a dollar is not a profit if the fees come to more.

        ``costs.no_arbitrage_bound`` is the real threshold; this only has to
        accept it. At a bound below the basket cost the riskless claim goes
        away entirely, which is the fee model doing its job.
        """
        family = [
            Candidate("A", "a", Decimal("0.5"), Decimal("0.30")),
            Candidate("B", "b", Decimal("0.3"), Decimal("0.32")),
            Candidate("C", "c", Decimal("0.2"), Decimal("0.32")),
        ]
        gross = solve(family, Decimal(1))
        assert gross.arbitrage_available is True
        assert gross.basket_cost == Decimal("0.94")

        after_fees = solve(family, Decimal(1), arbitrage_bound=Decimal("0.93"))
        assert after_fees.arbitrage_available is False
        assert after_fees.riskless_growth is None

    def test_the_estimation_haircut_shrinks_every_stake_and_never_raises_one(self):
        """``q`` read off a mid is an estimate with the spread's width on it.

        The haircut must move the plan toward the market, monotonically. The
        obvious construction — take the width off each ``q`` and renormalise —
        does the opposite on a symmetric family: it redistributes mass toward
        whichever leg had most, and the favourite's stake goes UP. Measured
        here rather than argued, because that version passed review reading
        plausibly and was wrong.
        """
        sharp = [
            Candidate("A", "a", Decimal("0.60"), Decimal("0.50")),
            Candidate("B", "b", Decimal("0.40"), Decimal("0.50")),
        ]
        wide = [
            Candidate("A", "a", Decimal("0.60"), Decimal("0.50"), uncertainty=Decimal("0.02")),
            Candidate("B", "b", Decimal("0.40"), Decimal("0.50"), uncertainty=Decimal("0.02")),
        ]
        base = solve(sharp, Decimal(1))
        cut = solve(wide, Decimal(1))
        assert cut.stakes[0].full_fraction < base.stakes[0].full_fraction
        assert cut.staked_fraction < base.staked_fraction

    def test_spreads_as_wide_as_the_edge_leave_nothing_to_bet_on(self):
        """At λ = 1 the measure IS the market, so there is no edge to size.

        This is the honest reading of an apparent edge on a barely-quoted
        market: it is the quoting, and the plan holds cash.
        """
        swallowed = [
            Candidate("A", "a", Decimal("0.60"), Decimal("0.50"), uncertainty=Decimal("0.30")),
            Candidate("B", "b", Decimal("0.40"), Decimal("0.50"), uncertainty=Decimal("0.30")),
        ]
        plan = solve(swallowed, Decimal(1))
        assert plan.cash_fraction == DOLLAR
        assert not any(stake.admitted for stake in plan.stakes)
        assert "toward the market's own" in plan.detail
