"""``certify`` — test one family for coherence and return the proof.

Runs both engines and prefers the linear programme, because it finds strictly
more: the closed-form checks see violations that fall inside a single constraint
row, while the LP can assemble a portfolio out of rows nobody wrote down. When
SciPy is absent — as it is on the deployment image — the closed-form result
stands on its own and the certificate says so.

Both are run even when both are available. They should agree on whether a family
is coherent, and a disagreement is worth surfacing rather than hiding behind
whichever answered last: it means one of them is wrong about a real market, and
that is a finding.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.kernel import closedform, dutchbook
from modules.coherence.kernel.certificate import Certificate
from modules.coherence.kernel.constraints import rows_for
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import build_component
from modules.coherence.syscalls.observe import Observation


def certify(observation: Observation, schedule: FeeSchedule, max_contracts: Decimal | None = None) -> Certificate:
    """One observation to one certificate."""
    component = build_component(observation.event, [item.market for item in observation.markets])
    books = {item.ticker: item.book for item in observation.markets}

    closed = closedform.solve(component, rows_for(component, books), schedule)
    programme = dutchbook.solve(component, books, schedule, max_contracts=max_contracts)

    if programme is None:
        closed.notes.append(
            "the linear programme was not run: SciPy is not installed here, so this is the "
            "closed-form answer and a violation it cannot express would not appear"
        )
        return _with_observation_notes(closed, observation)

    if programme.verdict != closed.verdict and "untestable" not in (programme.verdict, closed.verdict):
        # Not every disagreement is a fault, and calling one is how this engine
        # would report its own thesis as a bug. The two engines answer
        # different questions: the closed-form family checks ask whether these
        # prices admit a probability measure, and the linear programme asks
        # whether a portfolio can be assembled that makes money after the three
        # fee components. A family quoted at $0.98 for a dollar of payoff fails
        # the first and passes the second, because the $0.06 gross is $0.12
        # short once fees are charged — which is the whole point of the cost
        # model rather than a contradiction in it.
        gross_only = (
            closed.verdict == "incoherent"
            and programme.verdict == "coherent"
            and closed.net_edge is not None
            and closed.net_edge <= 0
        )
        if gross_only:
            programme.priced_out = True
            programme.gross_edge = closed.gross_edge
            programme.net_edge = closed.net_edge
            programme.notes.append(
                f"the prices here are incoherent and not tradable: the closed-form checks found a "
                f"violation worth {closed.gross_edge} gross, which the fee model turns into "
                f"{closed.net_edge} net, so the programme found no portfolio worth putting on. "
                "Both engines are right about their own question"
            )
        else:
            programme.notes.append(
                f"the closed-form checks said {closed.verdict} and the linear programme said "
                f"{programme.verdict}, and the fee model does not account for the gap; "
                "one of them is wrong about this market"
            )
    elif closed.verdict == "incoherent" and programme.verdict == "incoherent":
        programme.notes.append(
            f"the closed-form checks found the same violation directly, worth "
            f"{closed.net_edge} net against this portfolio's {programme.net_edge}"
        )

    return _with_observation_notes(programme, observation)


def _with_observation_notes(certificate: Certificate, observation: Observation) -> Certificate:
    """Carry forward what the READ could not do, not just what the solve found.

    A certificate computed from a top-of-book fallback is a weaker claim than
    one computed from full ladders, and the difference belongs on the proof
    rather than in a log.
    """
    if observation.depth != "full":
        certificate.notes.append(
            "computed from top-of-book quotes only: the sizes here are what one level holds, "
            "not what the book would absorb"
        )
    certificate.notes.extend(observation.notes)
    return certificate
