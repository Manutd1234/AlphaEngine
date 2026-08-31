"""The always-available coherence engine: check each family directly.

Every constraint row is already a statement about a portfolio's cost, so
checking one is arithmetic rather than optimisation. This engine walks the rows,
prices the worst violation at executable size, subtracts every fee component,
and hands back a certificate.

It finds strictly less than the linear programme does — it can only see
violations that fall inside a single constraint row, while the LP can combine
rows into portfolios nobody wrote down. That is exactly why it exists: it needs
no solver, so it runs on the deployment image where SciPy is absent, and a
result that says which engine answered lets a reader tell "coherent" from
"coherent as far as the weaker engine can see".

This is also Lesson 4 — Dutch books by hand, on three markets — and the code is
meant to be read as the worked version of it.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Sequence

from modules.coherence.kernel.certificate import (
    Certificate,
    CertificateLeg,
    ProofConstraintLeg,
    ProofConstraintRow,
    ProofConstraints,
    ProofEvidence,
    ProofObservation,
    ProofSolver,
)
from modules.coherence.kernel.constraints import Row
from modules.coherence.kernel.costs import FeeSchedule, Fill, OrderFees
from modules.coherence.kernel.lattice import Component
from modules.coherence.kernel.money import contracts

# How many pieces a leg is assumed to fill in when pricing the rounding
# component. One is the optimistic reading and the engine does not take it:
# a resting order gets picked apart, and each piece pays its own rounding.
ASSUMED_FILLS_PER_LEG = 3


def _proof_row(row: Row) -> ProofConstraintRow:
    """Preserve the inputs and outputs of one check for wire consumers."""
    return ProofConstraintRow(
        family=row.family,
        scope=row.scope,
        because=row.because,
        bound=row.bound,
        cost=row.cost,
        slack=row.slack,
        testable=row.testable,
        violated=row.violated if row.testable else None,
        untestable_reason=row.untestable_reason,
        executable_size_hundredths=row.executable_size_hundredths if row.testable else None,
        legs=tuple(
            ProofConstraintLeg(
                ticker=leg.ticker,
                label=leg.label,
                direction=leg.direction,
                side=leg.side,
                price=leg.price,
                size_hundredths=leg.size_hundredths,
            )
            for leg in row.legs
        ),
    )


def price_row(row: Row, schedule: FeeSchedule, size_hundredths: int | None = None) -> tuple[Decimal, Decimal, tuple[CertificateLeg, ...]]:
    """Cost this row's portfolio at a tradable size. Returns (gross, fees, legs).

    Size defaults to what the books can actually absorb across every leg, since
    a portfolio sized past its thinnest leg is not the portfolio that was
    priced.
    """
    size = size_hundredths if size_hundredths is not None else row.executable_size_hundredths
    size = max(0, size)
    legs: list[CertificateLeg] = []
    total_fees = Decimal(0)
    for leg in row.legs:
        price = leg.price
        if price is None:
            continue
        order = OrderFees(schedule=schedule)
        per_piece = max(1, size // ASSUMED_FILLS_PER_LEG)
        remaining = size
        while remaining > 0:
            piece = min(per_piece, remaining)
            order.add(Fill(price=price, size_hundredths=piece, selling=leg.direction == "sell"))
            remaining -= piece
        fees = order.total
        total_fees += fees.net
        legs.append(
            CertificateLeg(
                ticker=leg.ticker,
                label=leg.label,
                direction=leg.direction,
                price=price,
                size_hundredths=size,
                fees=fees,
            )
        )
    # The row is violated by `-slack` per contract; at `size` contracts that is
    # the gross edge the portfolio captures.
    slack = row.slack or Decimal(0)
    gross = -slack * contracts(size)
    return gross, total_fees, tuple(legs)


def solve(
    component: Component,
    rows: Sequence[Row],
    schedule: FeeSchedule,
    max_size_hundredths: int | None = None,
) -> Certificate:
    """Test every row and return the best violation, or a coherent verdict."""
    testable = [row for row in rows if row.testable]
    untestable = [row for row in rows if not row.testable]
    slacks = [row.slack for row in testable if row.slack is not None]
    evidence = ProofEvidence(
        # The kernel can count the outcomes it received, but only the syscall
        # still has the containing Event and Observation. Those fields are
        # filled there rather than guessed here.
        observation=ProofObservation(
            markets_observed=None,
            markets_in_event=None,
            outcomes_in_component=len(component.nodes),
            executable_buy_sides=None,
            executable_sell_sides=None,
        ),
        solver=ProofSolver(
            engine="closed_form",
            variables=None,
            state_rows=None,
            optimum=min(slacks) if slacks else None,
            optimum_kind="minimum_constraint_slack",
            decision_boundary=Decimal(0),
            verdict="coherent",
        ),
        constraints=ProofConstraints(
            tested=len(testable),
            untestable=len(untestable),
            rows=tuple(_proof_row(row) for row in rows),
        ),
    )

    base = Certificate(
        verdict="coherent",
        engine="closed_form",
        component_id=component.component_id,
        series_ticker=component.series_ticker,
        exchange_index=component.exchange_index,
        rows_tested=len(testable),
        rows_untestable=len(untestable),
        notes=list(component.notes),
        proof_evidence=evidence,
    )

    if not testable:
        base.verdict = "untestable"
        evidence.solver.verdict = "untestable"
        base.notes.extend(row.untestable_reason or "" for row in untestable[:3])
        if not rows:
            base.notes.append("this event's structure supports no constraint the engine can test")
        return base

    violations = [row for row in testable if row.violated]
    if not violations:
        return base

    # The best violation by NET edge, not gross. Ranking on gross picks the
    # widest-looking row, which on this exchange is routinely the one whose
    # legs sit nearest fifty cents — where the fee parabola peaks.
    best_row: Row | None = None
    best: tuple[Decimal, Decimal, tuple[CertificateLeg, ...]] | None = None
    for row in violations:
        size = row.executable_size_hundredths
        if max_size_hundredths is not None:
            size = min(size, max_size_hundredths)
        priced = price_row(row, schedule, size)
        net = priced[0] - priced[1]
        if best is None or net > (best[0] - best[1]):
            best_row, best = row, priced

    assert best_row is not None and best is not None
    gross, fees, legs = best
    base.verdict = "incoherent"
    evidence.solver.verdict = "incoherent"
    base.family = best_row.family
    base.because = best_row.because
    base.scope = best_row.scope
    base.legs = legs
    base.gross_edge = gross
    base.worst_case_payoff = gross
    base.total_fees = fees
    base.net_edge = gross - fees
    if len(violations) > 1:
        base.notes.append(f"{len(violations)} constraints are violated; this is the best by net edge")
    if untestable:
        base.notes.append(f"{len(untestable)} more could not be tested: a leg was unquoted")
    return base
