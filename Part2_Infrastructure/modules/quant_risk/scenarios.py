"""Named shocks, beta propagation, and what they do to a book."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from modules.quant_risk._common import (
    _mean,
)

# --------------------------------------------------------------------------- #
# Scenario stress testing
#
# Ported from web/lib/portfolio-risk.ts so the Telegram companion and the web
# tab cannot disagree about what a shock does to the book. The propagation rule
# is the important part: an instrument with no explicit shock moves by
# `beta × reference shock`, and only when a beta could actually be measured.
# Defaulting an unmeasurable beta to 1.0 is the quiet way a stress test starts
# inventing exposure and reporting it as a measurement.
# --------------------------------------------------------------------------- #

@dataclass
class ScenarioLeg:
    symbol: str
    signed_notional: float
    applied_move: float
    via_beta: bool
    beta: float | None
    pnl: float
    #: How the move was decided — "explicit", "beta", "wildcard" or "unsupported".
    #: A wildcard leg is an *assumption* about an instrument whose co-movement
    #: could not be measured, and a reader must be able to tell it apart from a
    #: shock that was named directly.
    basis: str = "explicit"


@dataclass
class ScenarioResult:
    scenario_id: str
    label: str
    total_pnl: float
    total_return: float
    projected_equity: float
    legs: list[ScenarioLeg]
    used_beta: bool


SCENARIOS: dict[str, dict[str, Any]] = {
    "crypto_cascade": {
        "label": "Crypto liquidation cascade",
        "description": "A leveraged unwind: majors gap down together and correlation goes to one.",
        "shocks": {"BTCUSDT": -0.20, "*": -0.25},
    },
    "risk_off": {
        "label": "Broad risk-off",
        "description": "Macro shock. Everything correlated to the reference falls with it.",
        "shocks": {"BTCUSDT": -0.08},
    },
    "melt_up": {
        "label": "Melt-up",
        "description": "The upside case — worth running, because a short book fails here.",
        "shocks": {"BTCUSDT": 0.15},
    },
    "flat": {
        "label": "No shock",
        "description": "Baseline. Any non-zero P&L here would be a bug in the propagation.",
        "shocks": {"*": 0.0},
    },
}


def beta(symbol: str, reference: str, returns_by_symbol: Mapping[str, Sequence[float]]) -> float | None:
    """Beta of *symbol* against *reference*, measured from returns.

    Returns ``None`` rather than 1.0 when it cannot be estimated — see the
    module comment above for why that distinction matters.
    """
    a = list(returns_by_symbol.get(symbol, ()))
    b = list(returns_by_symbol.get(reference, ()))
    if not a or not b:
        return None
    n = min(len(a), len(b))
    if n < 20:
        return None
    x, y = b[-n:], a[-n:]
    mean_x, mean_y = _mean(x), _mean(y)
    var_x = sum((v - mean_x) ** 2 for v in x) / (n - 1)
    if var_x <= 0:
        return None
    cov_xy = sum((y[i] - mean_y) * (x[i] - mean_x) for i in range(n)) / (n - 1)
    return cov_xy / var_x


def apply_scenario(
    positions: Sequence[Mapping[str, Any]],
    equity: float,
    shocks: Mapping[str, float],
    returns_by_symbol: Mapping[str, Sequence[float]],
    reference_symbol: str = "BTCUSDT",
    scenario_id: str = "custom",
    label: str = "Custom shock",
) -> ScenarioResult:
    explicit = {s: m for s, m in shocks.items() if s != "*"}
    wildcard = shocks.get("*")
    reference = explicit.get(reference_symbol, wildcard if wildcard is not None else 0.0)

    used_beta = False
    legs: list[ScenarioLeg] = []
    for p in positions:
        symbol = str(p.get("symbol"))
        direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
        signed = direction * abs(float(p.get("notional") or 0.0))

        if symbol in explicit:
            move, measured, via, basis = explicit[symbol], None, False, "explicit"
        else:
            measured = beta(symbol, reference_symbol, returns_by_symbol) if reference != 0 else None
            if measured is not None:
                used_beta = True
                move, via, basis = measured * reference, True, "beta"
            elif wildcard is not None:
                # A scenario that names a blanket move applies it — that is what
                # "everything falls 25%" means. But it is an assumption about an
                # instrument whose co-movement could not be measured, and a
                # stronger one than beta=1 would have been, so the leg says so.
                move, via, basis = wildcard, False, "wildcard"
            else:
                # No measured beta and no blanket move: left flat rather than
                # assumed to move with the market. Reported as unsupported, so
                # the total is understated rather than invented.
                move, via, basis = 0.0, False, "unsupported"

        legs.append(ScenarioLeg(
            symbol=symbol, signed_notional=signed, applied_move=move,
            via_beta=via, beta=measured, pnl=signed * move, basis=basis,
        ))

    total = sum(leg.pnl for leg in legs)
    return ScenarioResult(
        scenario_id=scenario_id,
        label=label,
        total_pnl=total,
        total_return=(total / equity) if equity > 0 else 0.0,
        projected_equity=equity + total,
        legs=legs,
        used_beta=used_beta,
    )


def run_scenarios(
    positions: Sequence[Mapping[str, Any]],
    equity: float,
    returns_by_symbol: Mapping[str, Sequence[float]],
    reference_symbol: str = "BTCUSDT",
) -> list[ScenarioResult]:
    """Every named scenario against the current book, worst first."""
    results = [
        apply_scenario(
            positions, equity, spec["shocks"], returns_by_symbol,
            reference_symbol, scenario_id=scenario_id, label=str(spec["label"]),
        )
        for scenario_id, spec in SCENARIOS.items()
    ]
    return sorted(results, key=lambda r: r.total_pnl)
