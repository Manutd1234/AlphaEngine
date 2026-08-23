"""The distribution the prices imply, and the four ways reading it goes wrong.

A ladder is read by subtraction, so every property worth pinning here is a
property of that subtraction: the differences telescope to exactly one dollar,
a rising rung comes out below the axis rather than clipped to nothing, an
unquoted strike is a gap rather than a zero, and the moments describe only the
part of the axis the exchange actually closed.

The fifth is a precedence rule rather than arithmetic, and it is the one that
was wrong against the live exchange: the NYC daily-high family carries both
buckets and thresholds, and reading its thresholds first differenced two
strikes into three bins and discarded six exhaustive outcomes. That case is
pinned against the recorded payload it came from rather than a hand-built
stand-in.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from coherence_fixtures import body, markets

from modules.coherence.drivers.kalshi_parse import parse_event, parse_orderbooks
from modules.coherence.kernel import moments
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.distribution import build_surface
from modules.coherence.kernel.lattice import Component, Node, build_component

DEEP = 50_000
EVENT = "KXHIGHNY-26AUG23"


def book(ticker: str, yes_bid: str | None = None, no_bid: str | None = None) -> Book:
    return Book(
        ticker=ticker,
        yes_bids=((Level(price=Decimal(yes_bid), size_hundredths=DEEP),) if yes_bid is not None else ()),
        no_bids=((Level(price=Decimal(no_bid), size_hundredths=DEEP),) if no_bid is not None else ()),
    )


def quoted(ticker: str, survival: str) -> Book:
    """A two-sided book whose mid is exactly ``survival``, a cent either side."""
    value = Decimal(survival)
    return book(ticker, str(value - Decimal("0.01")), str(Decimal(1) - value - Decimal("0.01")))


def rung(strike: str) -> Node:
    return Node(
        ticker=f"L-{strike}", event_ticker="L", series_ticker="L", exchange_index=0,
        strike_kind="greater", floor_strike=Decimal(strike), cap_strike=None,
        settlement_sources=("S",), label=f"above {strike}",
    )


def ladder(strikes: list[str], mutually_exclusive: bool = False) -> Component:
    return Component(component_id="L", event_ticker="L", series_ticker="L", exchange_index=0,
                     mutually_exclusive=mutually_exclusive, nodes=[rung(strike) for strike in strikes])


def named(count: int) -> Component:
    nodes = [
        Node(ticker=f"N-{index}", event_ticker="N", series_ticker="N", exchange_index=0,
             strike_kind="custom", floor_strike=None, cap_strike=None,
             settlement_sources=("S",), label=f"cut {index} bp")
        for index in range(1, count + 1)
    ]
    return Component(component_id="N", event_ticker="N", series_ticker="N", exchange_index=0,
                     mutually_exclusive=True, nodes=nodes)


def rungs(strikes: list[str], survivals: list[str]) -> dict[str, Book]:
    return {f"L-{k}": quoted(f"L-{k}", s) for k, s in zip(strikes, survivals, strict=True)}


def nyc_family():
    """The recorded six-market NYC daily-high event, whole.

    Composed from two recorded payloads the way ``test_coherence_observe`` does:
    both halves are real and neither is written into the fixture directory at
    test time.
    """
    payload = {
        "event": {
            "event_ticker": EVENT,
            "series_ticker": "KXHIGHNY",
            "title": "Highest temperature in NYC today",
            "mutually_exclusive": True,
            "exchange_index": 0,
            "settlement_sources": [{"name": "The Weather Company"}],
            "markets": markets("markets_ladder"),
        },
        "markets": [],
    }
    return build_component(parse_event(payload)), parse_orderbooks(body("orderbook_bulk"))


class TestTheDifferencesTelescope:
    """Every bin is a difference of two neighbours, so the sum is a dollar."""

    @pytest.mark.parametrize(
        "strikes,survivals",
        [
            (["100", "200", "300"], ["0.90", "0.50", "0.10"]),
            (["100", "200", "300", "400"], ["0.99", "0.75", "0.25", "0.01"]),
            (["1", "2"], ["0.50", "0.50"]),
            (["10", "20", "30", "40", "50"], ["0.88", "0.71", "0.44", "0.29", "0.02"]),
        ],
    )
    def test_the_bin_masses_sum_to_exactly_one(self, strikes, survivals):
        """Decimal-exact, not approximate. The whole reason this engine is not
        carrying floats: the answer here is a comparison at the fourth place."""
        surface = build_surface(ladder(strikes), rungs(strikes, survivals))
        assert surface.engine == "ladder"
        assert surface.total_mass == Decimal(1)

    def test_a_ladder_of_n_strikes_yields_n_plus_one_bins(self):
        """Both wings included: below the lowest strike and above the highest."""
        strikes = ["100", "200", "300"]
        surface = build_surface(ladder(strikes), rungs(strikes, ["0.90", "0.50", "0.10"]))
        assert len(surface.bins) == len(strikes) + 1
        assert surface.negative_bins == ()


class TestARisingRungIsShownRatherThanClipped:
    """A survival that climbs with the strike is a Dutch book. It is drawn."""

    @pytest.fixture
    def surface(self):
        strikes = ["100", "200", "300"]
        return build_surface(ladder(strikes), rungs(strikes, ["0.30", "0.42", "0.20"]))

    def test_the_offending_interval_carries_negative_mass(self, surface):
        """P(X > 200) quoted above P(X > 100), when the second set contains the
        first. Clipping it to zero would hide the only fault on the chart."""
        offending = next(item for item in surface.bins if item.label == "100 to 200")
        assert offending.mass == Decimal("-0.12")
        assert offending.is_negative

    def test_negative_bins_names_it(self, surface):
        assert surface.negative_bins == ("100 to 200",)

    def test_and_the_masses_still_sum_to_a_dollar(self, surface):
        """Telescoping is arithmetic, not a coherence claim, so it survives the
        violation — which is what makes the negative bar the honest signal."""
        assert surface.total_mass == Decimal(1)


class TestTheExclusivityFlagBeatsTheStrikes:
    """The precedence that was wrong, pinned against the family that found it."""

    def test_the_nyc_family_is_read_as_six_exhaustive_outcomes(self):
        """It lists four buckets, a ceiling and a threshold. Two of those are a
        ladder to a reader that looks at strikes first, and differencing them
        threw the other four markets away."""
        component, books = nyc_family()
        surface = build_surface(component, books)
        assert surface.engine == "bucket"
        assert len(surface.bins) == 6

    def test_no_market_in_it_is_differenced_away(self):
        component, books = nyc_family()
        surface = build_surface(component, books)
        assert surface.probes == (), "a bucket family samples no survival curve"
        assert {item.label for item in surface.bins} == {node.label for node in component.nodes}

    def test_the_same_markets_without_the_flag_are_a_ladder_of_three_bins(self):
        """The bug, reproduced: strikes-first reading on the same six markets.

        Asserted so the precedence is a choice this suite can see rather than
        an invariant of the data.
        """
        component, books = nyc_family()
        component.mutually_exclusive = False
        surface = build_surface(component, books)
        assert surface.engine == "ladder"
        assert len(surface.bins) == 3


class TestAnUnquotedMarketIsAGapNotAZero:
    def test_a_five_strike_ladder_with_two_dead_wings_still_yields_a_surface(self):
        """Nobody offers on a strike far out of the money. Demanding every rung
        be priced refused families with forty live strikes in them."""
        strikes = ["10", "20", "30", "40", "50"]
        books = rungs(strikes[1:4], ["0.80", "0.50", "0.20"])
        books["L-10"] = book("L-10")
        books["L-50"] = book("L-50")
        surface = build_surface(ladder(strikes), books)
        assert surface.engine == "ladder"
        assert len(surface.probes) == 3

    def test_and_the_detail_says_how_many_were_skipped(self):
        strikes = ["10", "20", "30", "40", "50"]
        books = rungs(strikes[1:4], ["0.80", "0.50", "0.20"])
        books["L-10"] = book("L-10")
        books["L-50"] = book("L-50")
        surface = build_surface(ladder(strikes), books)
        assert "2 listed market(s) are unquoted on every side" in surface.detail
        assert "not a probability of zero" in surface.detail

    def test_one_priced_market_is_not_a_curve(self):
        """Differencing needs two adjacent quoted strikes. One is a point."""
        strikes = ["10", "20"]
        books = {"L-10": quoted("L-10", "0.40"), "L-20": book("L-20")}
        surface = build_surface(ladder(strikes), books)
        assert surface.engine == "unavailable"
        assert "not two points to difference" in surface.detail


class TestTheMomentsSayWhatTheyAreConditionalOn:
    @pytest.fixture
    def surface(self):
        strikes = ["100", "200", "300"]
        return build_surface(ladder(strikes), rungs(strikes, ["0.90", "0.50", "0.10"]))

    def test_the_mean_is_taken_over_the_bounded_interior_only(self, surface):
        """Two bins of 0.4 at 150 and 250, renormalised onto themselves. The
        wings hold 0.1 each and have no width, so they are left out."""
        assert surface.mean == Decimal(200)
        assert surface.variance == Decimal(2500)
        assert surface.skewness == 0

    def test_the_wings_are_reported_beside_the_moments_rather_than_absorbed(self, surface):
        assert surface.tail_mass_low == Decimal("0.1")
        assert surface.tail_mass_high == Decimal("0.1")
        assert "which is 0.80 of the 1.00 these quotes carry" in surface.moments_note
        assert "unbounded wings" in surface.moments_note

    def test_a_thin_wing_does_not_earn_the_warning(self):
        """Half a cent of probability is the finest the exchange quotes; below
        that the statement is conditional on almost nothing."""
        strikes = ["100", "200", "300"]
        surface = build_surface(ladder(strikes), rungs(strikes, ["0.998", "0.50", "0.002"]))
        assert "unbounded wings" not in surface.moments_note
        assert "conditional on the outcome landing" in surface.moments_note

    def test_named_outcomes_have_no_mean_at_all(self):
        """A Fed-decision family has a perfectly good pmf and no mean: 'cut
        25bp' does not sit anywhere on a line."""
        books = {f"N-{index}": quoted(f"N-{index}", "0.25") for index in (1, 2, 3, 4)}
        surface = build_surface(named(4), books)
        assert surface.engine == "named"
        assert surface.mean is None
        assert "names rather than numbers" in surface.moments_note


class TestWhichSideOfTheBookIsRead:
    STRIKES = ["100", "200", "300"]

    def test_mid_wins_where_the_markets_are_two_sided(self):
        surface = build_surface(ladder(self.STRIKES), rungs(self.STRIKES, ["0.90", "0.50", "0.10"]))
        assert surface.basis == "mid"

    def test_the_ask_carries_a_family_nobody_bids_for(self):
        """A NO bid implies a YES offer, so an ask survives where a mid cannot."""
        books = {f"L-{k}": book(f"L-{k}", None, no) for k, no in zip(self.STRIKES, ("0.10", "0.50", "0.90"), strict=True)}
        surface = build_surface(ladder(self.STRIKES), books)
        assert surface.basis == "ask"

    def test_the_bid_is_the_last_resort_and_still_a_reading(self):
        books = {f"L-{k}": book(f"L-{k}", yes, None) for k, yes in zip(self.STRIKES, ("0.89", "0.49", "0.09"), strict=True)}
        surface = build_surface(ladder(self.STRIKES), books)
        assert surface.basis == "bid"

    def test_the_basis_with_the_wider_coverage_wins_rather_than_the_nicer_one(self):
        """One two-sided rung against three offered ones: mid reads less of the
        family than ask does, so ask is the honest choice."""
        books = {
            "L-100": quoted("L-100", "0.90"),
            "L-200": book("L-200", None, "0.50"),
            "L-300": book("L-300", None, "0.90"),
        }
        surface = build_surface(ladder(self.STRIKES), books)
        assert surface.basis == "ask"

    def test_an_unquoted_family_is_refused_with_its_count(self):
        books = {f"L-{k}": book(f"L-{k}") for k in self.STRIKES}
        surface = build_surface(ladder(self.STRIKES), books)
        assert surface.engine == "unavailable"
        assert surface.basis is None
        assert "only 0 market(s)" in surface.detail


class TestTheMomentsThemselves:
    """``moments.central`` knows nothing about strikes, so it is checkable by hand."""

    def test_two_symmetric_points_give_the_mean_between_them(self):
        mean, variance, skewness, excess, _note = moments.central(
            [(Decimal(1), Decimal("0.5")), (Decimal(3), Decimal("0.5"))]
        )
        assert (mean, variance, skewness) == (Decimal(2), Decimal(1), Decimal(0))
        assert excess == Decimal(-2), "two equal atoms are as flat as a distribution gets"

    def test_the_weights_are_renormalised_onto_the_points_supplied(self):
        """Which is what makes the answer conditional on them, as the caller says."""
        half = moments.central([(Decimal(1), Decimal("0.25")), (Decimal(3), Decimal("0.25"))])
        whole = moments.central([(Decimal(1), Decimal("0.5")), (Decimal(3), Decimal("0.5"))])
        assert half == whole

    def test_a_negative_weight_is_dropped_rather_than_averaged_in(self):
        """A negative bin is a certified violation; a log-shaped statistic
        computed over one is arithmetic on a fault."""
        mean, _v, _s, _e, note = moments.central(
            [(Decimal(1), Decimal("0.5")), (Decimal(2), Decimal("-0.1")), (Decimal(3), Decimal("0.5"))]
        )
        assert mean == Decimal(2)
        assert "2 priced bin(s)" in note

    def test_one_point_is_not_a_distribution(self):
        assert moments.central([(Decimal(1), Decimal("1"))]) == (None, None, None, None,
                                                                 "fewer than two priced bins sit on a numeric axis")

    def test_all_the_mass_in_one_place_has_a_mean_and_no_shape(self):
        mean, variance, skewness, excess, note = moments.central(
            [(Decimal(5), Decimal("0.5")), (Decimal(5), Decimal("0.5"))]
        )
        assert (mean, variance) == (Decimal(5), Decimal(0))
        assert skewness is None and excess is None
        assert "single bin" in note
