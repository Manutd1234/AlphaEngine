"""The seam where two engines disagree, and what the certificate carries out of it.

``certify`` runs the closed-form checks and the linear programme over the same
observation and reconciles them. One reconciliation is not a fault and is the
whole point of the cost model: the closed-form family checks ask whether these
prices admit a probability measure, the programme asks whether a portfolio can
be assembled that survives three fee components, and a family quoted at $0.99
for a dollar of payoff fails the first and passes the second. That is the
``priced_out`` certificate.

Until 2026-08-25 nothing in either suite touched this path, and it carried a
defect exactly the shape an untested branch carries: it copied two of the four
money figures off the closed-form answer and left the other two ``None``, so
the verdict panel drew two reported rows beside two "not reported" ones out of
a single measurement that had all four.

The books here are built to sit on that seam deliberately — three outcomes
offered at $0.33 against resting depth too thin for the programme to assemble
anything — because a fixture that merely happens to land there today would stop
testing this the first time a threshold moved.
"""

from __future__ import annotations

from decimal import Decimal
from importlib.util import find_spec

import pytest

from modules.coherence.drivers.kalshi_parse import Event, Market
from modules.coherence.kernel import dutchbook
from modules.coherence.kernel.book import Book, Level
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.grid import Band, PriceGrid
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.observe import MarketObservation, Observation
from modules.schemas_coherence import CoherenceCertificate as CoherenceCertificateSchema

linprog_required = pytest.mark.skipif(
    find_spec("scipy") is None,
    reason="scipy is not installed (pip install -r requirements-coherence.txt)",
)

SCHEDULE = FeeSchedule()
GRID = PriceGrid(
    structure="linear_cent",
    bands=(Band(start=Decimal("0.01"), end=Decimal("0.99"), step=Decimal("0.01")),),
)


def observation(no_bid: str = "0.67", size: int = 100) -> Observation:
    """Three outcomes offered at 1 - no_bid, on depth of ``size`` hundredths."""
    markets, observed = [], []
    for i in (1, 2, 3):
        book = Book(
            ticker=f"X-{i}",
            yes_bids=(Level(price=Decimal("0.01"), size_hundredths=size),),
            no_bids=(Level(price=Decimal(no_bid), size_hundredths=size),),
        )
        market = Market(
            ticker=f"X-{i}", event_ticker="X", series_ticker="X", status="active",
            strike_kind="custom", floor_strike=None, cap_strike=None, grid=GRID,
            exchange_index=0, yes_sub_title=f"Outcome {i}", top=book,
        )
        markets.append(market)
        observed.append(MarketObservation(market=market, book=book))
    event = Event(
        event_ticker="X", series_ticker="X", title="X", mutually_exclusive=True,
        exchange_index=0, settlement_sources=("S",), markets=tuple(markets),
    )
    return Observation(ts_ns=0, event=event, markets=observed)


@linprog_required
class TestTheIncoherentButPricedOutCertificate:
    def test_the_fixture_still_lands_on_the_seam_it_was_built_for(self):
        """Guards every assertion below: off the seam they would all pass vacuously."""
        certificate = certify(observation(), SCHEDULE)
        assert certificate.priced_out is True, "the fixture no longer reaches the priced-out branch"

    def test_the_verdict_stays_coherent_and_says_so_separately(self):
        """`priced_out` is carried beside the verdict, never folded into it."""
        certificate = certify(observation(), SCHEDULE)
        assert certificate.verdict == "coherent"
        assert certificate.engine == "highs"

    def test_all_four_money_figures_are_reported_together(self):
        """The defect this file was written for: two copied, two left as None."""
        certificate = certify(observation(), SCHEDULE)
        missing = [
            name
            for name in ("gross_edge", "worst_case_payoff", "total_fees", "net_edge")
            if getattr(certificate, name) is None
        ]
        assert missing == [], f"the closed-form answer had these and they were dropped: {missing}"

    def test_the_four_are_one_arithmetic_and_not_four_readings(self):
        certificate = certify(observation(), SCHEDULE)
        assert certificate.gross_edge == certificate.worst_case_payoff
        assert certificate.net_edge == certificate.gross_edge - certificate.total_fees

    def test_it_is_priced_out_because_the_fees_exceed_the_gross(self):
        certificate = certify(observation(), SCHEDULE)
        assert certificate.net_edge <= 0
        assert not certificate.worth_doing

    def test_the_wire_carries_all_four_rather_than_nulling_half_of_them(self):
        wire = certify(observation(), SCHEDULE).to_dict()
        for name in ("gross_edge", "worst_case_payoff", "total_fees", "net_edge"):
            assert wire[name] is not None, f"{name} reached the browser as null"

    def test_the_margin_agrees_with_the_verdict_rather_than_with_the_gross(self):
        """The programme found no portfolio, so its optimum is at or below zero.

        This is the pair that would otherwise read as a contradiction: a
        positive `gross_edge` copied from the closed-form checks sitting beside
        a margin at zero. They describe different questions, and the panel has
        to be able to draw both without one looking like an error in the other.
        """
        certificate = certify(observation(), SCHEDULE)
        assert certificate.margin is not None
        assert certificate.margin <= Decimal("0.0001")
        assert certificate.gross_edge > 0

    def test_a_family_that_is_plainly_coherent_reaches_none_of_this(self):
        """Asks summing above a dollar: no violation, no copy, no priced-out flag."""
        certificate = certify(observation(no_bid="0.60"), SCHEDULE)
        assert certificate.verdict == "coherent"
        assert certificate.priced_out is False
        assert certificate.gross_edge is None
        assert certificate.margin is not None


@linprog_required
class TestStructuredProofEvidenceAtTheSyscallBoundary:
    def test_separates_observation_solver_and_constraint_counts(self):
        certificate = certify(observation(), SCHEDULE)
        evidence = certificate.proof_evidence
        assert evidence is not None
        assert evidence.observation.markets_observed == 3
        assert evidence.observation.markets_in_event == 3
        assert evidence.observation.outcomes_in_component == 3
        assert evidence.observation.executable_buy_sides == 3
        assert evidence.observation.executable_sell_sides == 3

        # Six quote-side variables and three logical states are the LP matrix;
        # the two additive rows are a different, named explainer calculation.
        assert evidence.solver.variables == 6
        assert evidence.solver.state_rows == 3
        assert evidence.solver.optimum == certificate.margin
        assert evidence.solver.decision_boundary == Decimal("0.0001")
        assert evidence.solver.verdict == certificate.verdict
        assert evidence.constraints.tested == 2
        assert evidence.constraints.untestable == 0
        assert len(evidence.constraints.rows) == 2

    def test_the_constraint_values_change_with_the_observed_quotes(self):
        priced_out = certify(observation(no_bid="0.67"), SCHEDULE)
        coherent = certify(observation(no_bid="0.60"), SCHEDULE)
        assert priced_out.proof_evidence is not None
        assert coherent.proof_evidence is not None
        priced_out_row = priced_out.proof_evidence.constraints.rows[0]
        coherent_row = coherent.proof_evidence.constraints.rows[0]
        assert priced_out_row.cost == Decimal("0.99")
        assert priced_out_row.slack == Decimal("-0.01")
        assert priced_out_row.violated is True
        assert coherent_row.cost == Decimal("1.20")
        assert coherent_row.slack == Decimal("0.20")
        assert coherent_row.violated is False

    def test_the_api_schema_serialises_fixed_point_evidence_without_dropping_rows(self):
        certificate = certify(observation(), SCHEDULE)
        payload = certificate.to_dict()
        payload["proof"] = certificate.render_text()
        wire = CoherenceCertificateSchema(**payload).model_dump()
        evidence = wire["proof_evidence"]
        assert evidence is not None
        assert evidence["observation"] == {
            "markets_observed": 3,
            "markets_in_event": 3,
            "outcomes_in_component": 3,
            "executable_buy_sides": 3,
            "executable_sell_sides": 3,
        }
        assert evidence["solver"]["optimum"] == wire["margin"]
        assert evidence["solver"]["decision_boundary"] == "0.000100"
        assert evidence["constraints"]["rows"][0]["cost"] == "0.990000"
        assert evidence["constraints"]["rows"][0]["slack"] == "-0.010000"
        assert evidence["constraints"]["rows"][0]["legs"][0]["price"] == "0.330000"


def test_the_closed_form_fallback_keeps_actual_observation_counts_and_rows(monkeypatch):
    monkeypatch.setattr(dutchbook, "import_linprog", lambda: (None, "not installed for this test"))
    certificate = certify(observation(), SCHEDULE)
    evidence = certificate.proof_evidence
    assert certificate.engine == "closed_form"
    assert evidence is not None
    assert evidence.observation.markets_observed == 3
    assert evidence.observation.markets_in_event == 3
    assert evidence.observation.executable_buy_sides == 3
    assert evidence.observation.executable_sell_sides == 3
    assert evidence.solver.engine == "closed_form"
    assert evidence.solver.variables is None
    assert evidence.solver.state_rows is None
    assert evidence.solver.optimum == Decimal("-0.01")
    assert evidence.solver.verdict == certificate.verdict
    assert evidence.constraints.tested == 2
    assert len(evidence.constraints.rows) == 2


@linprog_required
def test_a_live_family_without_joint_structure_still_tests_each_executable_book():
    observed = observation(no_bid="0.60")
    observed.event = Event(
        event_ticker=observed.event.event_ticker,
        series_ticker=observed.event.series_ticker,
        title=observed.event.title,
        mutually_exclusive=False,
        exchange_index=observed.event.exchange_index,
        settlement_sources=observed.event.settlement_sources,
        markets=observed.event.markets,
    )

    certificate = certify(observed, SCHEDULE)

    assert certificate.verdict == "coherent"
    assert certificate.engine == "closed_form"
    assert certificate.rows_tested == 9
    assert certificate.proof_evidence is not None
    assert {row.family for row in certificate.proof_evidence.constraints.rows} == {"book"}
    assert "no state-space relation" in certificate.notes[-1]
