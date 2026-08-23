"""Lesson: two probabilities do not determine the probability of both.

They leave a band, and the band is a pair of trades rather than a pair of
inequalities. So the assertions here are about portfolios: what the cover
portfolio costs, what it is guaranteed to pay, and which contract each leg of it
buys. The payoff is worked through in the test rather than taken from the
module, because a bound nobody can check by hand is a number, not a proof.

The side of a leg is load-bearing and it is the thing a rewrite loses. A parlay
leg is routinely the NO side of its market, the negation of a NO leg is a YES
purchase, and an order plan that composed "not " onto a label would send the
opposite trade on exactly the legs where it matters.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.frechet import Combo, ComboLeg, assess, rows_for_combo, side_label

DEEP = 50_000
PARLAY = "KXMVE-PARLAY"


def book(ticker: str, yes_bid: str | None = None, no_bid: str | None = None) -> Book:
    return Book(
        ticker=ticker,
        yes_bids=((Level(price=Decimal(yes_bid), size_hundredths=DEEP),) if yes_bid is not None else ()),
        no_bids=((Level(price=Decimal(no_bid), size_hundredths=DEEP),) if no_bid is not None else ()),
    )


def two_sided(ticker: str, mid: str) -> Book:
    """A book whose YES mid is exactly ``mid``, quoted a cent either side."""
    value = Decimal(mid)
    return book(ticker, str(value - Decimal("0.01")), str(Decimal(1) - value - Decimal("0.01")))


def offered(ticker: str, ask: str) -> Book:
    """A parlay as the exchange lists them: an offer and no bid at all."""
    return book(ticker, None, str(Decimal(1) - Decimal(ask)))


def combo_of(*sides: str, ticker: str = PARLAY) -> Combo:
    return Combo(
        ticker=ticker,
        collection_ticker="KXMVE-R",
        exchange_index=1,
        legs=tuple(
            ComboLeg(ticker=f"LEG-{index}", event_ticker=f"EV-{index}", side=side,
                     label=f"match {index}", exchange_index=1)
            for index, side in enumerate(sides, start=1)
        ),
        label="the parlay",
    )


def yes_legs(mids: list[str]) -> tuple[Combo, dict[str, Book]]:
    combo = combo_of(*["yes"] * len(mids))
    books = {f"LEG-{index}": two_sided(f"LEG-{index}", mid) for index, mid in enumerate(mids, start=1)}
    return combo, books


class TestTheBandTheLegsLeave:
    """``max(0, Σp − (n−1)) <= P(all) <= min p``, as Fréchet wrote it in 1935."""

    @pytest.mark.parametrize(
        "mids,lower,upper",
        [
            (["0.60", "0.70"], "0.30", "0.60"),
            (["0.50", "0.50", "0.50"], "0", "0.50"),
            (["0.90", "0.90", "0.90", "0.90"], "0.60", "0.90"),
            (["0.20", "0.30"], "0", "0.20"),
        ],
    )
    def test_the_bounds_are_the_least_likely_leg_and_the_union_bound(self, mids, lower, upper):
        combo, books = yes_legs(mids)
        books[PARLAY] = offered(PARLAY, "0.10")
        reading = assess(combo, books)
        assert reading.upper_bound == Decimal(upper)
        assert reading.lower_bound == Decimal(lower)

    def test_the_band_is_what_the_price_can_move_without_a_leg_moving(self):
        combo, books = yes_legs(["0.60", "0.70"])
        books[PARLAY] = offered(PARLAY, "0.40")
        reading = assess(combo, books)
        assert reading.band_width == Decimal("0.30")
        assert reading.inside_band is True
        assert "band 0.30 wide" in reading.detail

    def test_one_leg_leaves_no_band_at_all(self):
        """A one-leg parlay is its own leg, so the bounds meet and there is no
        position inside a band of nothing."""
        combo, books = yes_legs(["0.40"])
        books[PARLAY] = offered(PARLAY, "0.40")
        reading = assess(combo, books)
        assert reading.lower_bound == reading.upper_bound == Decimal("0.40")
        assert reading.band_width == 0
        assert reading.band_position is None

    def test_independence_is_reported_and_never_called_the_answer(self):
        """The product is a guess about dependence, not a fair value: two legs
        of the same wet Saturday are not independent."""
        combo, books = yes_legs(["0.60", "0.70"])
        books[PARLAY] = offered(PARLAY, "0.50")
        reading = assess(combo, books)
        assert reading.independence == Decimal("0.42")
        assert reading.dependence == "positive"
        assert reading.inside_band is True, "above independence is not a mispricing"


class TestAPriceBelowTheLowerBoundIsADutchBook:
    """The cover, costed by hand: buy the parlay and the opposite of every leg.

    Two legs quoted at a YES mid of 0.60 and 0.30 — the second is needed on its
    NO side, so the conjunction's second probability is 0.70 — put the lower
    bound at 0.60 + 0.70 − 1 = 0.30. The parlay is offered at 0.21, below it.

    The opposites cost 0.41 and 0.32, so the set costs 0.21 + 0.41 + 0.32 =
    0.94. If both legs land the parlay pays a dollar and neither opposite does;
    if one misses, exactly one opposite pays a dollar; if both miss, two do. The
    portfolio therefore pays at least a dollar in every future and cost 94
    cents, which is six cents of certain profit before fees.
    """

    @pytest.fixture
    def books(self) -> dict[str, Book]:
        return {
            "LEG-1": book("LEG-1", "0.59", "0.39"),
            "LEG-2": book("LEG-2", "0.28", "0.68"),
            PARLAY: offered(PARLAY, "0.21"),
        }

    @pytest.fixture
    def combo(self) -> Combo:
        return combo_of("yes", "no")

    @pytest.fixture
    def cover(self, combo, books):
        return rows_for_combo(combo, books)[-1]

    def test_the_needed_side_of_each_leg_is_the_probability_read(self, combo, books):
        reading = assess(combo, books)
        assert [leg.probability for leg in reading.legs] == [Decimal("0.60"), Decimal("0.70")]
        assert reading.lower_bound == Decimal("0.30")

    def test_the_price_sits_below_the_band_rather_than_inside_it(self, combo, books):
        reading = assess(combo, books)
        assert reading.price == Decimal("0.21")
        assert reading.inside_band is False

    def test_the_cover_costs_ninety_four_cents(self, cover):
        assert cover.cost == Decimal("0.94")
        assert cover.cost < Decimal(1)

    def test_and_is_therefore_violated_by_six_cents(self, cover):
        assert cover.bound == Decimal(1)
        assert cover.slack == Decimal("-0.06")
        assert cover.violated

    def test_the_row_says_what_the_portfolio_pays_in_every_future(self, cover):
        assert "one dollar per missed leg" in cover.because

    def test_it_is_sized_to_its_thinnest_leg(self, cover):
        """A portfolio sized to its deepest leg is not the portfolio priced."""
        assert cover.executable_size_hundredths == DEEP

    def test_a_price_inside_the_band_leaves_the_cover_alone(self, combo, books):
        books[PARLAY] = offered(PARLAY, "0.40")
        cover = rows_for_combo(combo, books)[-1]
        assert cover.cost == Decimal("1.13")
        assert not cover.violated


class TestTheSideSurvivesIntoTheOrder:
    @pytest.fixture
    def cover(self):
        books = {
            "LEG-1": book("LEG-1", "0.59", "0.39"),
            "LEG-2": book("LEG-2", "0.28", "0.68"),
            PARLAY: offered(PARLAY, "0.21"),
        }
        return rows_for_combo(combo_of("yes", "no"), books)[-1]

    def test_the_opposite_of_a_no_leg_is_a_yes_purchase(self, cover):
        """Not "not NO". The contract bought is the YES one, at the YES ask."""
        leg = next(item for item in cover.legs if item.ticker == "LEG-2")
        assert (leg.side, leg.direction) == ("yes", "buy")
        assert leg.price == Decimal("0.32"), "the YES ask, read off the NO bid"

    def test_the_opposite_of_a_yes_leg_is_a_no_purchase(self, cover):
        leg = next(item for item in cover.legs if item.ticker == "LEG-1")
        assert (leg.side, leg.direction) == ("no", "buy")
        assert leg.price == Decimal("0.41")

    def test_every_label_names_the_contract_it_settles_on(self, cover):
        """A mislabelled side sends the opposite trade, and the label is what a
        person reads before pressing anything."""
        labels = {leg.ticker: leg.label for leg in cover.legs}
        assert labels["LEG-1"] == "match 1 settling no"
        assert labels["LEG-2"] == "match 2 settling yes"

    def test_the_upper_bound_row_buys_the_leg_on_the_side_the_parlay_needs(self):
        books = {
            "LEG-1": book("LEG-1", "0.59", "0.39"),
            "LEG-2": book("LEG-2", "0.28", "0.68"),
            PARLAY: offered(PARLAY, "0.21"),
        }
        rows = rows_for_combo(combo_of("yes", "no"), books)
        second = next(row for row in rows[:-1] if row.legs[0].ticker == "LEG-2")
        assert second.legs[0].side == "no"
        assert second.legs[0].price == Decimal("0.72"), "the NO ask, which is what that leg costs"
        assert side_label("match 2", "no") in second.because


class TestReadingAMarketNobodyBidsFor:
    def test_the_basis_falls_back_to_the_offer_and_the_reading_says_so(self):
        """Across a thousand listed parlays not one carries a bid, so a reading
        that demanded a mid would report nothing about the whole family."""
        combo, books = yes_legs(["0.60", "0.70"])
        books[PARLAY] = offered(PARLAY, "0.21")
        reading = assess(combo, books)
        assert reading.combo_bid is None
        assert reading.combo_mid is None
        assert reading.price_basis == "ask"
        assert "carries the maker's margin" in reading.detail

    def test_a_two_sided_parlay_is_read_at_its_mid_instead(self):
        combo, books = yes_legs(["0.60", "0.70"])
        books[PARLAY] = two_sided(PARLAY, "0.40")
        reading = assess(combo, books)
        assert reading.price_basis == "mid"
        assert reading.price == Decimal("0.40")
        assert "maker's margin" not in reading.detail

    def test_the_upper_bound_rows_are_untestable_without_a_bid_rather_than_satisfied(self):
        """Selling a parlay nobody bids for is not a trade, and reporting the
        row as coherent would claim a test that never ran."""
        combo, books = yes_legs(["0.60", "0.70"])
        books[PARLAY] = offered(PARLAY, "0.21")
        upper = rows_for_combo(combo, books)[:-1]
        assert len(upper) == 2
        assert not any(row.testable for row in upper)
        assert all(PARLAY in (row.untestable_reason or "") for row in upper)

    def test_an_unquoted_parlay_has_a_band_and_no_position_in_it(self):
        """The legs still bound it. That is a fact worth showing on its own."""
        combo, books = yes_legs(["0.60", "0.70"])
        books[PARLAY] = book(PARLAY)
        reading = assess(combo, books)
        assert reading.price is None
        assert reading.price_basis == "unavailable"
        assert reading.lower_bound == Decimal("0.30")
        assert reading.dependence == "unavailable"
        assert reading.inside_band is None


class TestWhenALegCannotBeRead:
    def test_there_is_no_band_and_the_missing_leg_is_named(self):
        combo, books = yes_legs(["0.60", "0.70"])
        books["LEG-2"] = book("LEG-2")
        books[PARLAY] = offered(PARLAY, "0.21")
        reading = assess(combo, books)
        assert reading.lower_bound is None and reading.upper_bound is None
        assert reading.dependence == "unavailable"
        assert "LEG-2" in reading.detail

    def test_the_combo_price_is_still_reported_beside_the_absent_band(self):
        combo, books = yes_legs(["0.60", "0.70"])
        books["LEG-2"] = book("LEG-2")
        books[PARLAY] = offered(PARLAY, "0.21")
        reading = assess(combo, books)
        assert reading.price == Decimal("0.21")
        assert reading.price_basis == "ask"


class TestWhereTheLegsLive:
    def test_a_parlay_whose_legs_share_a_shard_is_same_shard(self):
        assert combo_of("yes", "no").scope == "same-shard"

    def test_a_leg_of_unknown_shard_is_treated_as_the_expensive_case(self):
        """Assuming co-location understates the legging risk, and understating
        it is the error that costs money."""
        combo = Combo(
            ticker=PARLAY,
            collection_ticker="KXMVE-R",
            exchange_index=1,
            legs=(
                ComboLeg(ticker="LEG-1", event_ticker="EV-1", side="yes", label="match 1", exchange_index=1),
                ComboLeg(ticker="LEG-2", event_ticker="EV-2", side="yes", label="match 2"),
            ),
            label="the parlay",
        )
        assert combo.scope == "cross-shard"
