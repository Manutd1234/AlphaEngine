"""The Coherence Index: two families, and the null that made it useless.

The first version measured only mutually exclusive baskets from mid prices, and
against the live exchange that returned ``None`` for almost everything — crypto
ladders are not marked mutually exclusive, and any family with an unquoted tail
has no mid-price vector. A recorder writing a column of nulls is not a
measurement, so both gaps are closed here and pinned.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.coherence_index import _isotonic_l1_distance, measure
from modules.coherence.kernel.lattice import Component, Node

DEEP = 50_000


def book(ticker: str, yes_bid: str | None, no_bid: str | None) -> Book:
    return Book(
        ticker=ticker,
        yes_bids=((Level(price=Decimal(yes_bid), size_hundredths=DEEP),) if yes_bid else ()),
        no_bids=((Level(price=Decimal(no_bid), size_hundredths=DEEP),) if no_bid else ()),
    )


def basket(count: int) -> Component:
    nodes = [
        Node(ticker=f"X-{i}", event_ticker="X", series_ticker="X", exchange_index=0,
             strike_kind="custom", floor_strike=None, cap_strike=None,
             settlement_sources=("S",), label=f"Outcome {i}")
        for i in range(1, count + 1)
    ]
    return Component(component_id="X", event_ticker="X", series_ticker="X",
                     exchange_index=0, mutually_exclusive=True, nodes=nodes)


def ladder(strikes: list[str]) -> Component:
    nodes = [
        Node(ticker=f"L-{k}", event_ticker="L", series_ticker="L", exchange_index=0,
             strike_kind="greater", floor_strike=Decimal(k), cap_strike=None,
             settlement_sources=("S",), label=f"above {k}")
        for k in strikes
    ]
    return Component(component_id="L", event_ticker="L", series_ticker="L",
                     exchange_index=0, mutually_exclusive=False, nodes=nodes)


class TestTheIsotonicDistance:
    def test_a_monotone_curve_is_already_coherent(self):
        assert _isotonic_l1_distance([Decimal("0.9"), Decimal("0.6"), Decimal("0.3")]) == 0

    def test_a_flat_curve_is_coherent(self):
        """Equal is non-increasing. A strict test would call every flat rung a
        violation, and flat rungs are what an untraded ladder looks like."""
        assert _isotonic_l1_distance([Decimal("0.4")] * 3) == 0

    def test_one_inversion_costs_the_move_that_repairs_it(self):
        """0.5 then 0.6 must both become 0.55, which is 0.05 each."""
        assert _isotonic_l1_distance([Decimal("0.5"), Decimal("0.6")]) == Decimal("0.10")

    def test_a_fully_inverted_curve_costs_the_most(self):
        assert _isotonic_l1_distance([Decimal("0.1"), Decimal("0.5"), Decimal("0.9")]) == Decimal("0.8")

    def test_a_single_point_cannot_violate_anything(self):
        assert _isotonic_l1_distance([Decimal("0.4")]) == 0


class TestAThresholdLadder:
    def test_is_measurable_even_though_it_is_not_mutually_exclusive(self):
        """The gap that made crypto unmeasurable. `KXBTCD` carries no exclusivity
        flag, so before this the whole complex reported None on every poll."""
        component = ladder(["100", "200", "300"])
        books = {
            "L-100": book("L-100", "0.79", "0.19"),
            "L-200": book("L-200", "0.49", "0.49"),
            "L-300": book("L-300", "0.19", "0.79"),
        }
        reading = measure(component, books)
        assert reading.measurable
        assert reading.engine == "isotonic"

    def test_a_falling_curve_measures_zero(self):
        component = ladder(["100", "200", "300"])
        books = {
            "L-100": book("L-100", "0.79", "0.19"),
            "L-200": book("L-200", "0.49", "0.49"),
            "L-300": book("L-300", "0.19", "0.79"),
        }
        assert measure(component, books).ci == 0

    def test_a_rising_rung_is_the_violation_it_reports(self):
        """A higher strike quoted above a lower one cannot both be true."""
        component = ladder(["100", "200", "300"])
        books = {
            "L-100": book("L-100", "0.19", "0.79"),
            "L-200": book("L-200", "0.49", "0.49"),
            "L-300": book("L-300", "0.79", "0.19"),
        }
        reading = measure(component, books)
        assert reading.ci is not None and reading.ci > 0

    def test_too_few_two_sided_rungs_is_reported_rather_than_fitted(self):
        """Two points can always be made monotone; a curve needs three to mean
        anything, and fitting fewer would report zero for an unread ladder."""
        component = ladder(["100", "200", "300"])
        books = {
            "L-100": book("L-100", "0.79", "0.19"),
            "L-200": book("L-200", None, "0.49"),
            "L-300": book("L-300", None, "0.79"),
        }
        reading = measure(component, books)
        assert not reading.measurable
        assert "at least three" in reading.detail


class TestAMutuallyExclusiveBasket:
    def test_measures_the_distance_from_a_dollar(self):
        # bid 0.30 and a NO bid of 0.68 imply a YES ask of 0.32, so the mid is
        # 0.31 and three of them sum to 0.93 — seven cents short of the dollar
        # the family pays.
        books = {f"X-{i}": book(f"X-{i}", "0.30", "0.68") for i in (1, 2, 3)}
        reading = measure(basket(3), books)
        assert reading.engine == "mid_sum"
        assert reading.ci == Decimal("0.07")

    def test_falls_back_to_the_ask_side_when_a_tail_has_no_bid(self):
        """The ordinary case, not a fault: nobody bids for what will not happen.

        Refusing to measure whenever one exists returned None for almost every
        real family — a worse answer than the one available.
        """
        books = {
            "X-1": book("X-1", "0.60", "0.38"),
            "X-2": book("X-2", "0.30", "0.68"),
            "X-3": book("X-3", None, "0.97"),
        }
        reading = measure(basket(3), books)
        assert reading.measurable
        assert reading.engine == "ask_side"

    def test_the_two_engines_are_never_mixed_silently(self):
        """A series must never be two measurements in one column."""
        both = measure(basket(3), {f"X-{i}": book(f"X-{i}", "0.30", "0.68") for i in (1, 2, 3)})
        one_sided = measure(basket(3), {
            "X-1": book("X-1", "0.60", "0.38"),
            "X-2": book("X-2", "0.30", "0.68"),
            "X-3": book("X-3", None, "0.97"),
        })
        assert both.engine != one_sided.engine

    def test_an_unofferred_leg_leaves_nothing_to_measure(self):
        books = {
            "X-1": book("X-1", "0.60", "0.38"),
            "X-2": book("X-2", "0.30", "0.68"),
            "X-3": book("X-3", None, None),
        }
        reading = measure(basket(3), books)
        assert not reading.measurable
        assert reading.ci is None


def test_a_family_that_is_neither_says_so_rather_than_reporting_zero():
    """Zero would read as perfectly coherent — the most misleading value here."""
    nodes = [
        Node(ticker=f"N-{i}", event_ticker="N", series_ticker="N", exchange_index=0,
             strike_kind="custom", floor_strike=None, cap_strike=None,
             settlement_sources=("S",), label=f"N{i}")
        for i in (1, 2)
    ]
    component = Component(component_id="N", event_ticker="N", series_ticker="N",
                          exchange_index=0, mutually_exclusive=False, nodes=nodes)
    reading = measure(component, {n.ticker: book(n.ticker, "0.4", "0.5") for n in nodes})
    assert reading.ci is None
    assert "neither mutually exclusive nor a threshold ladder" in reading.detail
