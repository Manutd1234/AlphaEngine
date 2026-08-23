"""``replay`` — run the engine over the tape, with parts of it switched off.

The ablation harness. Its question is not "how much would this have made" — a
backtest of an arbitrage engine over its own recorded quotes is close to
worthless as a P&L estimate, because the quotes are what it would have traded
against and it cannot have traded against all of them.

Its question is **which parts of the model change the answer**. Run the same
tape with the rounding fee off, or with the trade fee off, or with a constraint
family excluded, and count how many violations each configuration reports. The
gap between "arbitrages found with no fee model" and "arbitrages found with the
real one" is the number this whole project exists to produce: it is how many
opportunities the naive test invents.

Most sophistication in this space has never been ablated. The parts that survive
one are a shorter list than the parts that get written.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Sequence

from modules.coherence.fs.replay import TapeRow, observations_from, tape_span
from modules.coherence.kernel import closedform
from modules.coherence.kernel.constraints import Family, rows_for
from modules.coherence.kernel.costs import CENT, FeeSchedule
from modules.coherence.kernel.lattice import build_component
from modules.coherence.kernel.money import CENTICENT

# The configurations worth comparing. Each one is a claim about the model that
# the tape can settle.
ABLATIONS: dict[str, str] = {
    "full": "every fee component and every constraint family",
    "no_fees": "no fees at all — the naive `sum of asks under a dollar` test",
    "no_rounding": "trade fee only, the component everybody models",
    "direct_member": "full model at a direct member's balance precision",
}


@dataclass(slots=True)
class AblationResult:
    """What one configuration found over the whole tape."""

    name: str
    description: str
    observations: int = 0
    violations: int = 0
    worth_doing: int = 0
    gross_total: Decimal = Decimal(0)
    net_total: Decimal = Decimal(0)
    untestable: int = 0
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "observations": self.observations,
            "violations": self.violations,
            "worth_doing": self.worth_doing,
            "gross_total": str(self.gross_total),
            "net_total": str(self.net_total),
            "untestable": self.untestable,
            "notes": list(self.notes),
        }


def _schedule_for(name: str, base: FeeSchedule) -> FeeSchedule:
    """The fee model each ablation runs under."""
    if name == "no_fees":
        # Not a discount — the absence of a model. This is the configuration
        # every bot in this space ships with, written down so the difference is
        # measurable rather than argued.
        return FeeSchedule(multiplier=Decimal(0), taker_rate=Decimal(0), balance_precision=base.balance_precision)
    if name == "no_rounding":
        # A precision fine enough that the rounding component rounds to nothing,
        # leaving the trade fee alone. This is what "modelling the fee" usually
        # means, and the gap to `full` is the component nobody models.
        return FeeSchedule(
            multiplier=base.multiplier,
            taker_rate=base.taker_rate,
            maker_ratio=base.maker_ratio,
            balance_precision=Decimal("0.00000001"),
        )
    if name == "direct_member":
        return FeeSchedule(
            multiplier=base.multiplier,
            taker_rate=base.taker_rate,
            maker_ratio=base.maker_ratio,
            balance_precision=CENTICENT,
        )
    return base


def run(
    rows: Sequence[TapeRow],
    base: FeeSchedule | None = None,
    families: Sequence[Family] | None = None,
    ablations: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Replay the tape under each configuration and compare what they found."""
    schedule = base or FeeSchedule(balance_precision=CENT)
    wanted = list(ablations or ABLATIONS)
    results: dict[str, AblationResult] = {
        name: AblationResult(name=name, description=ABLATIONS.get(name, name)) for name in wanted
    }

    # Materialised once and replayed against every configuration, so the
    # comparison is between models rather than between two reads of the tape.
    observations = list(observations_from(rows))

    for name in wanted:
        result = results[name]
        ablated = _schedule_for(name, schedule)
        for observation in observations:
            component = build_component(observation.event, [item.market for item in observation.markets])
            books = {item.ticker: item.book for item in observation.markets}
            certificate = closedform.solve(component, rows_for(component, books, families), ablated)
            result.observations += 1
            if certificate.verdict == "untestable":
                result.untestable += 1
                continue
            if certificate.verdict != "incoherent":
                continue
            result.violations += 1
            result.gross_total += certificate.gross_edge or Decimal(0)
            result.net_total += certificate.net_edge or Decimal(0)
            if certificate.worth_doing:
                result.worth_doing += 1

    first, last, seconds = tape_span(rows)
    invented = results.get("no_fees", AblationResult("", "")).worth_doing - results.get(
        "full", AblationResult("", "")
    ).worth_doing

    return {
        "state": "ok" if rows else "empty",
        "rows": len(rows),
        "observations": len(observations),
        "first_ts_ns": first,
        "last_ts_ns": last,
        "span_seconds": str(seconds),
        "ablations": [results[name].to_dict() for name in wanted],
        "headline": (
            f"the naive test reports {invented} more tradable arbitrage(s) than the fee-aware one"
            if invented > 0
            else "the naive and fee-aware tests agree on this tape"
        ),
        "notes": [
            "replayed from recorded quotes: this counts what each model would have SEEN, not what it "
            "would have earned — the engine cannot have traded against every quote it recorded",
        ],
    }
