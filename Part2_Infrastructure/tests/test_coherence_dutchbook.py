"""Lesson 5: the certificate of infeasibility is the trade.

Two engines answer the same question and this suite holds them to each other.
The linear programme finds strictly more — it can assemble portfolios out of
constraints nobody wrote down — so the interesting assertions are that it never
finds LESS, and that both price the same portfolio the same way.

The LP cases are marked ``linprog_required``: SciPy is in the tested venv and in
CI but not on the deployment image, and a suite that silently skipped them there
would report a green run for an engine that never ran.
"""

from __future__ import annotations

from decimal import Decimal
from importlib.util import find_spec

import pytest

from modules.coherence.kernel import closedform, dutchbook
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.constraints import rows_for
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import Component, Node

linprog_required = pytest.mark.skipif(
    find_spec("scipy") is None,
    reason="scipy is not installed (pip install -r requirements-coherence.txt)",
)

SCHEDULE = FeeSchedule()


def book(ticker: str, yes_bid: str, no_bid: str, size: int = 50_000) -> Book:
    return Book(
        ticker=ticker,
        yes_bids=(Level(price=Decimal(yes_bid), size_hundredths=size),),
        no_bids=(Level(price=Decimal(no_bid), size_hundredths=size),),
    )


def family(count: int = 3) -> Component:
    nodes = [
        Node(
            ticker=f"X-{i}", event_ticker="X", series_ticker="X", exchange_index=0,
            strike_kind="custom", floor_strike=None, cap_strike=None,
            settlement_sources=("S",), label=f"Outcome {i}",
        )
        for i in range(1, count + 1)
    ]
    return Component(
        component_id="X", event_ticker="X", series_ticker="X",
        exchange_index=0, mutually_exclusive=True, nodes=nodes,
    )


# Asks are 1 - no_bid. A no_bid of 0.70 offers the outcome at 0.30, so three of
# them buy a guaranteed dollar for ninety cents.
DUTCH = {f"X-{i}": book(f"X-{i}", "0.28", "0.70") for i in (1, 2, 3)}
COHERENT = {f"X-{i}": book(f"X-{i}", "0.33", "0.65") for i in (1, 2, 3)}


class TestTheClosedFormEngine:
    def test_finds_the_basket_that_buys_a_dollar_for_ninety_cents(self):
        certificate = closedform.solve(family(), rows_for(family(), DUTCH), SCHEDULE)
        assert certificate.verdict == "incoherent"
        assert certificate.family == "additive"
        assert certificate.worth_doing

    def test_prices_the_portfolio_it_proposes(self):
        certificate = closedform.solve(family(), rows_for(family(), DUTCH), SCHEDULE)
        # 500 contracts of each outcome at $0.30 pays $500 and costs $450.
        assert certificate.gross_edge == Decimal("50.0000")
        # Trade fee is 0.07 x 500 x 0.30 x 0.70 = $7.35 a leg.
        assert certificate.total_fees is not None and certificate.total_fees > Decimal("22")
        assert certificate.net_edge is not None and certificate.net_edge > Decimal("27")

    def test_says_coherent_when_the_basket_costs_more_than_a_dollar(self):
        certificate = closedform.solve(family(), rows_for(family(), COHERENT), SCHEDULE)
        assert certificate.verdict == "coherent"
        assert certificate.rows_tested > 0

    def test_reports_the_healthy_case_rather_than_returning_nothing(self):
        """"No opportunity" and "the feed is down" must not read the same."""
        certificate = closedform.solve(family(), rows_for(family(), COHERENT), SCHEDULE)
        assert certificate.render_text().startswith("COHERENT")

    def test_an_unquoted_leg_makes_a_row_untestable_not_satisfied(self):
        books = dict(COHERENT)
        books["X-2"] = Book(ticker="X-2", yes_bids=(), no_bids=())
        certificate = closedform.solve(family(), rows_for(family(), books), SCHEDULE)
        assert certificate.rows_untestable > 0


@linprog_required
class TestTheLinearProgramme:
    def test_finds_the_same_dutch_book(self):
        certificate = dutchbook.solve(family(), DUTCH, SCHEDULE)
        assert certificate is not None
        assert certificate.verdict == "incoherent"
        assert certificate.engine == "highs"

    def test_agrees_with_the_closed_form_on_what_it_is_worth(self):
        """Within the fill-count assumption, which is the only thing separating them."""
        lp = dutchbook.solve(family(), DUTCH, SCHEDULE)
        closed = closedform.solve(family(), rows_for(family(), DUTCH), SCHEDULE)
        assert lp is not None and lp.net_edge is not None and closed.net_edge is not None
        assert abs(lp.net_edge - closed.net_edge) < Decimal("0.10")

    def test_does_not_charge_the_trade_fee_twice(self):
        """The bug this test exists for.

        `_leg_prices` folds a per-contract trade fee into the prices the solver
        sees, so `t*` is already net of it. Subtracting the exact fees from
        `t*` as well charged every leg twice and turned a correct $27.92 into
        $5.90 — an error that reads as a more conservative engine rather than a
        wrong one. The gross is rebuilt from raw quotes for exactly this reason.
        """
        certificate = dutchbook.solve(family(), DUTCH, SCHEDULE)
        assert certificate is not None
        assert certificate.gross_edge == Decimal("50.0000")

    def test_says_coherent_when_no_portfolio_wins_in_every_state(self):
        certificate = dutchbook.solve(family(), COHERENT, SCHEDULE)
        assert certificate is not None
        assert certificate.verdict == "coherent"
        assert "probability measure consistent with all of them exists" in certificate.because

    def test_never_finds_less_than_the_closed_form(self):
        """The LP is the stronger engine; it may find more, never fewer."""
        for books in (DUTCH, COHERENT):
            lp = dutchbook.solve(family(), books, SCHEDULE)
            closed = closedform.solve(family(), rows_for(family(), books), SCHEDULE)
            assert lp is not None
            if closed.verdict == "incoherent":
                assert lp.verdict == "incoherent", "the LP missed what the closed form found"

    def test_is_bounded_by_the_resting_size(self):
        """An unbounded LP proposes an infinite portfolio nobody can fill."""
        thin = {ticker: book(ticker, "0.28", "0.70", size=100) for ticker in DUTCH}
        certificate = dutchbook.solve(family(), thin, SCHEDULE)
        assert certificate is not None
        assert all(leg.size_hundredths <= 100 for leg in certificate.legs)

    def test_a_family_with_no_derivable_states_is_untestable_not_coherent(self):
        component = family()
        component.mutually_exclusive = False
        certificate = dutchbook.solve(component, COHERENT, SCHEDULE)
        assert certificate is not None
        assert certificate.verdict == "untestable"


def test_the_seam_reports_absence_rather_than_pretending():
    module, error = dutchbook.import_linprog()
    if module is None:
        assert error, "an unavailable solver must say why"
    else:
        assert error is None
        assert dutchbook.linprog_available()
